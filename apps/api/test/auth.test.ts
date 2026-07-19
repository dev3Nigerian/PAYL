import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";
import { IdentityService, totpCode } from "../src/identity.js";
import { PaylOAuthProvider } from "../src/oauth.js";
import { createApp } from "../src/app.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  APPROVAL_WEB_URL: "http://localhost:3000",
  MERCHANT_WEB_URL: "http://localhost:3001",
  PUBLIC_BASE_URL: "http://localhost:4100",
  PAYL_ISSUER: "https://sandbox.payl.local",
  PAYL_DEV_KEYS: "true",
});
const pool = createPool(config);
const service = new PaylService(pool, config);
const identity = new IdentityService(pool, config);
const oauth = new PaylOAuthProvider(pool, config);
const app = createApp(service, identity, oauth, config);

beforeAll(async () => {
  await migrate(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE
       oauth_revoked_access_tokens, oauth_refresh_tokens, oauth_grants, oauth_authorization_codes,
       oauth_consent_requests, oauth_clients, auth_sessions, auth_users,
       audit_events, orders, payment_mandates, approval_challenges, payment_intents, quotes,
       journal_lines, journal_entries, ledger_accounts, spending_policies, offers, consumers, merchants
     RESTART IDENTITY CASCADE`,
  );
  await service.seedSandbox();
  await identity.seedSandboxUsers();
});

afterAll(async () => {
  await pool.end();
});

describe("PAYL identity and MCP authorization", () => {
  it("reports database-backed readiness", async () => {
    const health = await request(app).get("/healthz").expect(200);
    expect(health.body).toMatchObject({ status: "ok", database: "ready" });
  });

  it("isolates consumer and merchant workspaces by authenticated role", async () => {
    const consumerLogin = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const consumerToken = consumerLogin.body.sessionToken as string;
    await request(app).get("/api/consumer/dashboard").set("authorization", `Bearer ${consumerToken}`).expect(200);
    await request(app).get("/api/merchant/dashboard").set("authorization", `Bearer ${consumerToken}`).expect(403);

    const merchantLogin = await request(app).post("/api/auth/login").send({
      email: config.sandboxMerchantEmail,
      password: config.sandboxMerchantPassword,
      role: "merchant_admin",
    }).expect(200);
    const merchantToken = merchantLogin.body.sessionToken as string;
    await request(app).get("/api/merchant/dashboard").set("authorization", `Bearer ${merchantToken}`).expect(200);
    await request(app).get("/api/consumer/dashboard").set("authorization", `Bearer ${merchantToken}`).expect(403);
  });

  it("requires a valid TOTP code for human payment approval", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const token = login.body.sessionToken as string;
    const quote = await service.createQuote(config.sandboxMerchantId, "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: config.sandboxConsumerId,
      agentClientId: "agent_mfa_test",
      signedQuote: quote,
      idempotencyKey: "prepare-mfa-test",
    });
    if (prepared.status !== "pending_approval") throw new Error("Expected pending approval");
    await request(app).post(`/api/approvals/${prepared.approvalId}/decision`).set("authorization", `Bearer ${token}`).send({ decision: "approve", mfaCode: "000000" }).expect(403);
    await request(app).post(`/api/approvals/${prepared.approvalId}/decision`).set("authorization", `Bearer ${token}`).send({ decision: "approve", mfaCode: totpCode(config.sandboxConsumerTotpSecret) }).expect(200);
  });

  it("completes PKCE authorization, calls a scoped MCP tool, and revokes the grant", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const sessionToken = login.body.sessionToken as string;

    const registration = await request(app).post("/register").send({
      client_name: "PAYL test client",
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }).expect(201);
    const clientId = registration.body.client_id as string;
    const verifier = "payl-test-verifier-with-more-than-forty-three-characters-2026";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const resource = "http://localhost:4100/mcp";
    const scope = "wallet:read wallet:pay commerce:read commerce:quote commerce:order";
    const authorize = await request(app).get("/authorize").set("Cookie", `payl_consumer_session=${sessionToken}`).query({
      client_id: clientId,
      redirect_uri: "http://127.0.0.1/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      scope,
      state: "test-state",
    }).expect(200);
    const requestId = /name="request_id" value="([^"]+)"/.exec(authorize.text)?.[1];
    expect(requestId).toBeTruthy();
    const consent = await request(app).post("/oauth/consent").set("Cookie", `payl_consumer_session=${sessionToken}`).type("form").send({ request_id: requestId, decision: "allow" }).expect(302);
    const callback = new URL(consent.headers.location as string);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokens = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1/callback",
      resource,
    }).expect(200);
    const accessToken = tokens.body.access_token as string;
    await request(app).post("/mcp/wallet")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wallet.get_summary", arguments: {} } })
      .expect(200);

    await request(app).delete("/api/oauth/grants").set("authorization", `Bearer ${sessionToken}`).send({ clientId, resource }).expect(204);
    await request(app).post("/mcp/wallet")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wallet.get_summary", arguments: {} } })
      .expect(401);
  });
});
