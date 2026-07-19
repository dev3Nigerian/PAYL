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

  it("registers and provisions an isolated merchant workspace", async () => {
    const registration = await request(app).post("/api/auth/register/merchant").send({
      businessName: "Second Signal Studio",
      adminName: "Ada Merchant",
      email: "ada@secondsignal.test",
      password: "SecondSignal!2026",
    }).expect(201);
    const merchantId = registration.body.merchant.merchantId as string;
    const token = registration.body.sessionToken as string;
    expect(merchantId).toMatch(/^merchant_[a-f0-9]{32}$/);
    expect(registration.body.merchant.mcpUrl).toBe(`http://localhost:4100/mcp/merchants/${merchantId}`);

    const dashboard = await request(app).get("/api/merchant/dashboard").set("authorization", `Bearer ${token}`).expect(200);
    expect(dashboard.body.merchant).toMatchObject({
      merchantId,
      name: "Second Signal Studio",
      currency: "NGN",
      mcpUrl: `http://localhost:4100/mcp/merchants/${merchantId}`,
    });
    expect(dashboard.body.offers).toEqual([]);

    const product = await request(app).post("/api/merchant/offers").set("authorization", `Bearer ${token}`).send({
      name: "Competitor Quote Pack",
      description: "A comparison-ready merchant quote for sandbox testing.",
      priceMinor: "180000",
      fulfillmentMethod: "digital_service",
    }).expect(201);
    expect(product.body).toMatchObject({ merchantId, priceMinor: "180000", active: true });

    await request(app).post("/api/auth/register/merchant").send({
      businessName: "Duplicate Email Shop",
      adminName: "Another Admin",
      email: "ada@secondsignal.test",
      password: "AnotherMerchant!2026",
    }).expect(409);
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
    const networkMerchant = await identity.registerMerchant({
      businessName: "Network Merchant Two",
      adminName: "Network Admin",
      email: "network@merchant.test",
      password: "NetworkMerchant!2026",
    });
    const networkOffer = await service.createMerchantOffer({
      merchantId: networkMerchant.merchant.merchantId,
      name: "Network Comparison Service",
      description: "A service discovered without adding another MCP connection.",
      priceMinor: "175000",
      fulfillmentMethod: "digital_service",
    });
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

    const directory = await request(app).post("/mcp/commerce")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "commerce.list_merchants", arguments: {} } })
      .expect(200);
    expect(JSON.stringify(directory.body)).toContain("Network Merchant Two");

    const marketplaceSearch = await request(app).post("/mcp/commerce")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "commerce.search_offers", arguments: { query: "comparison" } } })
      .expect(200);
    expect(JSON.stringify(marketplaceSearch.body)).toContain("Network Comparison Service");

    const networkQuote = await request(app).post("/mcp/commerce")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "commerce.create_quote",
          arguments: { merchantId: networkMerchant.merchant.merchantId, offerId: networkOffer.offerId, quantity: 1 },
        },
      })
      .expect(200);
    expect(JSON.stringify(networkQuote.body)).toContain(networkMerchant.merchant.merchantId);

    await request(app).delete("/api/oauth/grants").set("authorization", `Bearer ${sessionToken}`).send({ clientId, resource }).expect(204);
    await request(app).post("/mcp/wallet")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wallet.get_summary", arguments: {} } })
      .expect(401);
  });
});
