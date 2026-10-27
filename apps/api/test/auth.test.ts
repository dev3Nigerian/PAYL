import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  PAYL_DEPLOYMENT_PROFILE: "local_sandbox",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  APPROVAL_WEB_URL: "http://localhost:3000",
  MERCHANT_WEB_URL: "http://localhost:3001",
  PUBLIC_BASE_URL: "http://localhost:4100",
  PAYL_ISSUER: "https://sandbox.payl.local",
  PAYL_DEV_KEYS: "true",
  OPENAI_API_KEY: "test-api-key",
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
       auth_browser_handoffs, consumer_chat_messages, consumer_chat_conversations,
       reconciliation_reports, outbox_events, merchant_webhook_endpoints, payout_batches,
       paypal_webhook_events, wallet_topups,
       merchant_settlement_configs, order_cancellations, payment_cancellations,
       audit_events, refunds, orders, payment_mandates, approval_challenges, payment_intents, quotes,
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

  it("exchanges a single-use browser handoff for an API-origin OAuth session", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const handoff = await request(app)
      .post("/api/auth/handoff")
      .set("authorization", `Bearer ${login.body.sessionToken as string}`)
      .expect(200);
    const handoffUrl = new URL(handoff.body.handoffUrl as string);
    const returnTo = "http://localhost:4100/authorize?client_id=hosted-demo";
    handoffUrl.searchParams.set("returnTo", returnTo);

    const exchanged = await request(app).get(`${handoffUrl.pathname}${handoffUrl.search}`).expect(303);
    expect(exchanged.headers.location).toBe(returnTo);
    const cookies = exchanged.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("payl_consumer_session=");
    await request(app).get("/api/auth/session").set("Cookie", cookies).expect(200);
    await request(app).get(`${handoffUrl.pathname}${handoffUrl.search}`).expect(401);
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
      currency: "USD",
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

  it("lets only the authenticated purchasing consumer use the refund REST endpoint", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 1000000 WHERE consumer_id = $1", [config.sandboxConsumerId]);
    const quote = await service.createQuote(config.sandboxMerchantId, "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: config.sandboxConsumerId,
      agentClientId: "agent_refund_api",
      signedQuote: quote,
      idempotencyKey: "prepare-refund-api-001",
    });
    if (prepared.status !== "reserved") throw new Error("Expected refund API payment to reserve");
    const order = await service.commitOrder({
      merchantId: config.sandboxMerchantId,
      signedQuote: quote,
      mandate: prepared.mandate,
      idempotencyKey: "commit-refund-api-001",
    });
    const consumerLogin = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const refund = await request(app).post(`/api/orders/${order.orderId}/refund`)
      .set("authorization", `Bearer ${consumerLogin.body.sessionToken as string}`)
      .send({ idempotencyKey: "refund-api-001", reason: "Consumer API test" })
      .expect(201);
    expect(refund.body.payload).toMatchObject({ orderId: order.orderId, status: "refunded", retainedFeeMinor: "150" });

    const merchantLogin = await request(app).post("/api/auth/login").send({
      email: config.sandboxMerchantEmail,
      password: config.sandboxMerchantPassword,
      role: "merchant_admin",
    }).expect(200);
    await request(app).post(`/api/orders/${order.orderId}/refund`)
      .set("authorization", `Bearer ${merchantLogin.body.sessionToken as string}`)
      .send({ idempotencyKey: "refund-api-merchant-001" })
      .expect(403);
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
      priceMinor: "17500",
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
    await request(app).post("/mcp/wallet")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "payment.cancel", arguments: { paymentId: "payment_missing", idempotencyKey: "cancel-scope-test" } } })
      .expect(200);
    await request(app).post("/mcp/wallet")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "payment.request_refund", arguments: { orderId: "order_missing", idempotencyKey: "refund-scope-test" } },
      })
      .expect(403);

    const directory = await request(app).post("/mcp/commerce")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "commerce.list_merchants", arguments: {} } })
      .expect(200);
    expect(JSON.stringify(directory.body)).toContain("Network Merchant Two");
    const unifiedWallet = await request(app).post("/mcp")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "wallet.get_summary", arguments: {} } })
      .expect(200);
    expect(JSON.stringify(unifiedWallet.body)).toContain("consumer_demo");
    const unifiedCommerce = await request(app).post("/mcp")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "commerce.list_merchants", arguments: {} } })
      .expect(200);
    expect(JSON.stringify(unifiedCommerce.body)).toContain("Network Merchant Two");
    await request(app).post("/mcp")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "payment.request_refund", arguments: { orderId: "order_missing", idempotencyKey: "refund-unified-scope-test" } } })
      .expect(403);
    await request(app).post("/mcp/commerce")
      .set("authorization", `Bearer ${accessToken}`)
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "commerce.cancel_order", arguments: { orderId: "order_missing", idempotencyKey: "order-cancel-scope-test" } } })
      .expect(200);

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

  it("accepts Cursor desktop OAuth callbacks while rejecting arbitrary custom schemes", async () => {
    const cursorRegistration = await request(app).post("/register").send({
      client_name: "Cursor desktop",
      redirect_uris: [
        "cursor://anysphere.cursor-mcp/oauth/callback",
        "https://www.cursor.com/agents/mcp/oauth/callback",
        "http://localhost:8787/callback",
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }).expect(201);
    expect(cursorRegistration.body.client_id).toBeTruthy();

    await request(app).post("/register").send({
      client_name: "Unknown custom client",
      redirect_uris: ["payl://unexpected/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }).expect(400);
  });

  it("grounds in-app chat in matching live offers and isolates conversation history", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const token = login.body.sessionToken as string;
    const modelCall = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "The Market Research Pack is $75." }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const sent = await request(app).post("/api/consumer/chat")
        .set("authorization", `Bearer ${token}`)
        .send({ message: "Show research offers under $80" }).expect(200);
      expect(sent.body.message).toMatchObject({ role: "assistant", content: "The Market Research Pack is $75." });
      expect(sent.body.offers).toHaveLength(1);
      expect(sent.body.offers[0]).toMatchObject({ offerId: "offer_research_pack", priceMinor: "7500" });
      const modelRequest = JSON.parse(String(modelCall.mock.calls[0]?.[1]?.body));
      expect(modelRequest).toMatchObject({ model: "gpt-6-luna", store: false });
      expect(modelRequest.input).toContain("offer_research_pack");
      expect(modelRequest.input).not.toContain("signedQuote");

      const history = await request(app).get("/api/consumer/chat")
        .query({ conversationId: sent.body.conversationId })
        .set("authorization", `Bearer ${token}`).expect(200);
      expect(history.body.messages).toHaveLength(2);
      expect(history.body.messages[1].offers).toEqual(sent.body.offers);
      const followUp = await request(app).post("/api/consumer/chat")
        .set("authorization", `Bearer ${token}`)
        .send({ conversationId: sent.body.conversationId, message: "Can that one be refunded?" }).expect(200);
      expect(followUp.body.offers).toHaveLength(1);
      expect(followUp.body.offers[0].offerId).toBe("offer_research_pack");
      const noMatch = await request(app).post("/api/consumer/chat")
        .set("authorization", `Bearer ${token}`)
        .send({ conversationId: sent.body.conversationId, message: "Show research offers under $20" }).expect(200);
      expect(noMatch.body.offers).toEqual([]);
      await expect(service.chat.getConversation("another_consumer", sent.body.conversationId))
        .rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
      await request(app).get("/api/consumer/chat")
        .query({ conversationId: sent.body.conversationId }).expect(401);
    } finally {
      modelCall.mockRestore();
    }
  });

  it("requires explicit checkout confirmation and recovers a captured retry", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const token = login.body.sessionToken as string;
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const quote = await request(app).post("/api/consumer/checkout/quote")
      .set("authorization", `Bearer ${token}`)
      .send({ merchantId: "merchant_demo", offerId: "offer_research_pack", quantity: 1 }).expect(200);
    expect(quote.body.offer).toMatchObject({ merchantName: "Atlas Digital Market", priceMinor: "7500" });
    await request(app).post("/api/consumer/checkout/quote")
      .set("cookie", `payl_consumer_session=${token}`)
      .send({ merchantId: "merchant_demo", offerId: "offer_research_pack", quantity: 1 }).expect(403);
    const confirmInput = { signedQuote: quote.body.signedQuote, idempotencyKey: "in-app-checkout-001" };
    const first = await request(app).post("/api/consumer/checkout/confirm")
      .set("authorization", `Bearer ${token}`).send(confirmInput).expect(200);
    expect(first.body.status).toBe("confirmed");
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date(quote.body.signedQuote.payload.expiresAt).getTime() + 1000);
    let retry;
    try {
      retry = await request(app).post("/api/consumer/checkout/confirm")
        .set("authorization", `Bearer ${token}`).send(confirmInput).expect(200);
    } finally {
      clock.mockRestore();
    }
    expect(retry.body.order.orderId).toBe(first.body.order.orderId);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(1);
    await pool.query("UPDATE merchants SET status = 'suspended' WHERE id = 'merchant_demo'");
    await request(app).post("/api/consumer/checkout/quote")
      .set("authorization", `Bearer ${token}`)
      .send({ merchantId: "merchant_demo", offerId: "offer_research_pack", quantity: 1 }).expect(404);
  });

  it("completes an in-app checkout only after human approval", async () => {
    const login = await request(app).post("/api/auth/login").send({
      email: config.sandboxConsumerEmail,
      password: config.sandboxConsumerPassword,
      role: "consumer",
    }).expect(200);
    const token = login.body.sessionToken as string;
    const quote = await request(app).post("/api/consumer/checkout/quote")
      .set("authorization", `Bearer ${token}`)
      .send({ merchantId: "merchant_demo", offerId: "offer_research_pack", quantity: 1 }).expect(200);
    const input = { signedQuote: quote.body.signedQuote, idempotencyKey: "in-app-checkout-approval-001" };
    const pending = await request(app).post("/api/consumer/checkout/confirm")
      .set("authorization", `Bearer ${token}`).send(input).expect(200);
    expect(pending.body).toMatchObject({ status: "pending_approval", paymentId: expect.any(String), approvalUrl: expect.any(String) });
    const completion = { ...input, paymentId: pending.body.paymentId };
    const beforeApproval = await request(app).post("/api/consumer/checkout/complete")
      .set("authorization", `Bearer ${token}`).send(completion).expect(200);
    expect(beforeApproval.body.status).toBe("pending_approval");
    const approval = await pool.query<{ id: string }>("SELECT id FROM approval_challenges WHERE payment_id = $1", [pending.body.paymentId]);
    await request(app).post(`/api/approvals/${approval.rows[0]?.id}/decision`)
      .set("authorization", `Bearer ${token}`)
      .send({ decision: "approve", mfaCode: totpCode(config.sandboxConsumerTotpSecret) }).expect(200);
    const afterApproval = await request(app).post("/api/consumer/checkout/complete")
      .set("authorization", `Bearer ${token}`).send(completion).expect(200);
    expect(afterApproval.body.status).toBe("confirmed");
    expect(afterApproval.body.order.paymentId).toBe(pending.body.paymentId);
  });
});
