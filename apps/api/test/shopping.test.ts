import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";
import { seedLegacyCatalogFixture } from "./legacy-catalog-fixture.js";
import { IdentityService } from "../src/identity.js";
import { PaylOAuthProvider } from "../src/oauth.js";
import { createApp } from "../src/app.js";

const config = loadConfig({ ...process.env, NODE_ENV: "test", PAYL_DEPLOYMENT_PROFILE: "local_sandbox", PAYL_DEV_KEYS: "true",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test", DEEPSEEK_API_KEY: "test-api-key" });
const pool = createPool(config);
const service = new PaylService(pool, config);
const identity = new IdentityService(pool, config);
const app = createApp(service, identity, new PaylOAuthProvider(pool, config), config);
let token = "";
let merchantToken = "";

const tool = (name: string, args: unknown) => ({ type: "function_call", call_id: randomUUID(), name, arguments: JSON.stringify(args) });
const answer = (text = "Here are the verified results.") => ({ type: "message", content: [{ type: "output_text", text }] });
const modelResponse = (...output: unknown[]) => new Response(JSON.stringify({ output }), { status: 200, headers: { "content-type": "application/json" } });
function modelSequence(...outputs: unknown[][]) {
  let next = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => modelResponse(...(outputs[next++] ?? [answer()])));
}
function chat(message: string, extra: Record<string, unknown> = {}) {
  return request(app).post("/api/consumer/chat").set("authorization", `Bearer ${token}`).send({ message, requestId: randomUUID(), ...extra });
}
async function buy(offerId = "offer_research_pack", message = "Buy Market Research Pack under $80") {
  const spy = modelSequence([tool("prepare_purchase", { offerId, intent: "buy" })]);
  try { return (await chat(message).expect(200)).body; }
  finally { spy.mockRestore(); }
}
async function fund(amount: string) {
  const id = `test-funding:${randomUUID()}`;
  await pool.query("INSERT INTO journal_entries(id, event_type, idempotency_key, reference_type, reference_id) VALUES ($1, 'test_funding', $1, 'consumer', $2)", [id, config.sandboxConsumerId]);
  await pool.query("INSERT INTO journal_lines(entry_id, account_id, amount_minor) VALUES ($1, 'acct_consumer_available', $2::bigint), ($1, 'acct_platform_clearing', -$2::bigint)", [id, amount]);
}
async function balanced() {
  const result = await pool.query("SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(amount_minor) <> 0");
  expect(result.rowCount).toBe(0);
}

beforeAll(async () => { await migrate(pool); });
beforeEach(async () => {
  await pool.query(`TRUNCATE oauth_revoked_access_tokens, oauth_refresh_tokens, oauth_grants, oauth_authorization_codes,
    oauth_consent_requests, oauth_clients, auth_sessions, auth_users, auth_browser_handoffs,
    consumer_chat_messages, consumer_chat_conversations, reconciliation_reports, outbox_events,
    merchant_webhook_endpoints, payout_batches, paypal_webhook_events, wallet_topups, merchant_settlement_configs,
    order_cancellations, payment_cancellations, audit_events, refunds, orders, payment_mandates, approval_challenges,
    payment_intents, quotes, journal_lines, journal_entries, ledger_accounts, spending_policies, offers, delivery_assets,
    consumers, merchants RESTART IDENTITY CASCADE`);
  await service.seedSandbox();
  await seedLegacyCatalogFixture(pool, config.sandboxMerchantId);
  await identity.seedSandboxUsers();
  await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 200000, per_transaction_limit_minor = 200000, daily_limit_minor = 400000");
  token = (await identity.login(config.sandboxConsumerEmail, config.sandboxConsumerPassword, "consumer")).token;
  merchantToken = (await identity.login(config.sandboxMerchantEmail, config.sandboxMerchantPassword, "merchant_admin")).token;
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

describe("complete shopping conversations", () => {
  it("keeps requirements beyond the recent transcript and permits an explicit reset", async () => {
    const spy = modelSequence(
      [tool("remember_requirements", { query: "research", preferences: ["Beginner friendly"], source: "research for beginners" })],
      [tool("search_offers", { query: "research" })], [answer()], [answer()],
    );
    const first = await chat("Find refundable research for beginners under $80").expect(200);
    expect(first.body.brief).toMatchObject({ query: "research", maxBudgetMinor: "8000", refundableOnly: true, preferences: ["Beginner friendly"] });
    expect(first.body.offers.map((o: { offerId: string }) => o.offerId)).toEqual(["offer_research_pack"]);
    for (let n = 0; n < 12; n++) await pool.query("INSERT INTO consumer_chat_messages(id, conversation_id, role, content) VALUES ($1, $2, 'user', 'Thanks')", [`chatmsg_${randomUUID()}`, first.body.conversationId]);
    await chat("Show alternatives", { conversationId: first.body.conversationId }).expect(200);
    const lastPayload = JSON.parse(String(spy.mock.calls.at(-1)?.[1]?.body));
    expect(JSON.parse(lastPayload.input).shoppingBrief).toMatchObject({ maxBudgetMinor: "8000", refundableOnly: true, query: "research" });
    const reset = await chat("Clear shopping brief", { conversationId: first.body.conversationId }).expect(200);
    expect(reset.body.brief).toMatchObject({ query: "", maxBudgetMinor: null, refundableOnly: false, preferences: [] });
  });

  it("requires confirmation for conditional or withheld purchase consent", async () => {
    const started = await buy("offer_research_pack", "Buy Market Research Pack under $80 but don't purchase yet");
    expect(started.message.action.status).toBe("ready");
    expect(started.brief.confirmBeforePurchase).toBe(true);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(0);
    await chat("Confirm purchase", { conversationId: started.conversationId, purchaseId: started.message.action.purchaseId, quoteHash: started.message.action.signedQuote.hash }).expect(200);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(1);
    await balanced();
  });

  it("does not let a model selection bypass a saved refund or budget requirement", async () => {
    modelSequence([answer()], [tool("prepare_purchase", { offerId: "offer_research_pack", intent: "buy" })]);
    const first = await chat("Find refundable research under $80").expect(200);
    await pool.query("UPDATE offers SET refundable = false, refund_window_minutes = NULL WHERE id = 'offer_research_pack'");
    await chat("Buy it", { conversationId: first.body.conversationId }).expect(200);
    expect((await pool.query("SELECT id FROM payment_intents")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(0);
  });

  it("reads wallet information through bounded tools and returns real progress events", async () => {
    const spy = modelSequence([tool("get_wallet", {})], [answer("Your available balance is $1,000.")]);
    const response = await chat("How much can I spend?").set("accept", "application/x-ndjson").expect(200);
    const events = response.text.trim().split("\n").map((line: string) => JSON.parse(line));
    expect(events.some((e: { type: string; message: string }) => e.type === "progress" && e.message.includes("wallet"))).toBe(true);
    const result = events.at(-1).reply;
    expect(result.message.details.wallet.balances.available).toBe("100000");
    expect(result.message.details.policy.perTransactionLimitMinor).toBe("200000");
    expect(result.message.offers).toEqual([]);
    const secondInput = JSON.parse(String(spy.mock.calls[1]?.[1]?.body)).input;
    expect(secondInput.some((item: { type: string }) => item.type === "function_call_output")).toBe(true);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(0);
  });

  it("resumes a funded purchase with a fresh quote exactly once", async () => {
    await pool.query("UPDATE offers SET price_minor = 150000 WHERE id = 'offer_research_pack'");
    const started = await buy("offer_research_pack", "Buy Market Research Pack under $2000");
    expect(started.message.action.status).toBe("needs_funding");
    await fund("100000");
    const resume = { conversationId: started.conversationId, purchaseId: started.message.action.purchaseId, requestId: randomUUID() };
    const completed = await chat("I added funds", resume).expect(200);
    const repeated = await chat("I added funds", resume).expect(200);
    expect(repeated.body.message.id).toBe(completed.body.message.id);
    const history = await service.chat.getConversation(config.sandboxConsumerId, started.conversationId);
    const action = history.messages[1]!.action;
    expect(action).toMatchObject({ status: "confirmed", purchaseId: started.message.action.purchaseId, generation: 1 });
    if (action?.kind === "purchase") expect(action.signedQuote.hash).not.toBe(started.message.action.signedQuote.hash);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(1);
    expect((await service.walletSummary(config.sandboxConsumerId)).balances).toMatchObject({ available: "50000" });
    await balanced();
  });

  it("shows changed terms after funding and rejects a stale quote confirmation", async () => {
    await pool.query("UPDATE offers SET price_minor = 150000 WHERE id = 'offer_research_pack'");
    const started = await buy("offer_research_pack", "Buy Market Research Pack under $2000");
    await fund("100000");
    await pool.query("UPDATE offers SET price_minor = 160000 WHERE id = 'offer_research_pack'");
    await chat("Resume purchase", { conversationId: started.conversationId, purchaseId: started.message.action.purchaseId }).expect(200);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(0);
    const history = await service.chat.getConversation(config.sandboxConsumerId, started.conversationId);
    const action = history.messages[1]!.action;
    expect(action).toMatchObject({ status: "ready", signedQuote: { payload: { totalMinor: "160000" } } });
    await chat("Confirm purchase", { conversationId: started.conversationId, purchaseId: started.message.action.purchaseId, quoteHash: started.message.action.signedQuote.hash }).expect(409);
    if (action?.kind !== "purchase") throw new Error("Expected purchase");
    await chat("Confirm purchase", { conversationId: started.conversationId, purchaseId: action.purchaseId, quoteHash: action.signedQuote.hash }).expect(200);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(1);
    await balanced();
  });

  it("confirms a refund in chat once and revokes the authenticated download", async () => {
    const bought = await buy();
    const orderId = bought.message.action.orderId as string;
    expect(bought.message.details.orders[0].delivery.fileName).toBe("market-research-sample.txt");
    await request(app).get(`/api/consumer/orders/${orderId}/download`).set("authorization", `Bearer ${token}`).expect(200);
    await request(app).get(`/api/consumer/orders/${orderId}/download`).expect(401);
    modelSequence([tool("request_order_action", { operation: "refund", orderId })]);
    const proposed = await chat(`Refund order ${orderId}`, { conversationId: bought.conversationId }).expect(200);
    expect(proposed.body.message.action.status).toBe("ready");
    expect((await pool.query("SELECT id FROM refunds")).rowCount).toBe(0);
    const confirmation = { conversationId: bought.conversationId, actionId: proposed.body.message.action.actionId, requestId: randomUUID() };
    await chat("Confirm action", confirmation).expect(200);
    await chat("Confirm action", confirmation).expect(200);
    await chat("Confirm action", { ...confirmation, requestId: randomUUID() }).expect(200);
    expect((await pool.query("SELECT id FROM refunds")).rowCount).toBe(1);
    expect((await service.walletSummary(config.sandboxConsumerId)).balances).toMatchObject({ available: "100000" });
    await request(app).get(`/api/consumer/orders/${orderId}/download`).set("authorization", `Bearer ${token}`).expect(404);
    await balanced();
  });

  it("cancels a pending service through chat and restores the captured amount", async () => {
    const bought = await buy("offer_brand_review", "Buy AI Brand Review under $150");
    const orderId = bought.message.action.orderId;
    modelSequence([tool("request_order_action", { operation: "cancel", orderId })]);
    const proposed = await chat(`Cancel order ${orderId}`, { conversationId: bought.conversationId }).expect(200);
    await chat("Confirm action", { conversationId: bought.conversationId, actionId: proposed.body.message.action.actionId }).expect(200);
    expect((await service.delivery.orders(config.sandboxConsumerId, orderId))[0]?.status).toBe("cancelled");
    expect((await service.walletSummary(config.sandboxConsumerId)).balances).toMatchObject({ available: "100000" });
    await balanced();
  });

  it("collects service requirements and delivers a real file with tenant checks", async () => {
    await service.delivery.setIntakePrompt(config.sandboxMerchantId, "offer_brand_review", "Your brand URL and target audience?");
    const bought = await buy("offer_brand_review", "Buy AI Brand Review under $150");
    const orderId = bought.message.action.orderId;
    const fulfillment = { merchantId: config.sandboxMerchantId, orderId, fulfillmentReference: "review_delivered", idempotencyKey: "fulfillment-test-001" };
    await expect(service.fulfillOrder(fulfillment)).rejects.toMatchObject({ code: "DELIVERY_REQUIRED" });
    await request(app).post(`/api/merchant/orders/${orderId}/delivery?fileName=brand-review.txt`).set("authorization", `Bearer ${merchantToken}`)
      .set("content-type", "application/octet-stream").send(Buffer.from("A completed brand review result")).expect(200);
    await expect(service.fulfillOrder(fulfillment)).rejects.toMatchObject({ code: "SERVICE_DETAILS_REQUIRED" });
    await expect(service.delivery.submitDetails("someone_else", orderId, "example.com for founders")).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await request(app).post(`/api/consumer/orders/${orderId}/details`).set("authorization", `Bearer ${token}`).send({ details: "https://example.com; early-stage founders" }).expect(200);
    await expect(service.delivery.submitDetails(config.sandboxConsumerId, orderId, "Different requirements")).rejects.toMatchObject({ code: "SERVICE_DETAILS_LOCKED" });
    const dashboard = await service.merchantDashboard(config.sandboxMerchantId) as { orders: Array<{ service_details: string; delivery_file_name: string }> };
    expect(dashboard.orders[0]).toMatchObject({ service_details: "https://example.com; early-stage founders", delivery_file_name: "brand-review.txt" });
    await service.fulfillOrder(fulfillment);
    const download = await request(app).get(`/api/consumer/orders/${orderId}/download`).set("authorization", `Bearer ${token}`).expect(200);
    expect(download.body.toString()).toBe("A completed brand review result");
    await expect(service.delivery.download("someone_else", orderId)).rejects.toMatchObject({ code: "DELIVERY_NOT_AVAILABLE" });
    await expect(service.delivery.upload(config.sandboxMerchantId, { orderId }, "replacement.txt", Buffer.from("Changed"))).rejects.toMatchObject({ code: "ORDER_DELIVERY_LOCKED" });
    await balanced();
  });

  it("keeps the quoted download version when a merchant replaces its catalog asset", async () => {
    await service.delivery.upload(config.sandboxMerchantId, { offerId: "offer_research_pack" }, "version-one.txt", Buffer.from("Version one"));
    const quote = await service.createQuote(config.sandboxMerchantId, "offer_research_pack", 1);
    await service.delivery.upload(config.sandboxMerchantId, { offerId: "offer_research_pack" }, "version-two.txt", Buffer.from("Version two"));
    const payment = await service.preparePayment({ consumerId: config.sandboxConsumerId, agentClientId: "test", signedQuote: quote, idempotencyKey: "version-purchase-001" });
    if (payment.status !== "reserved") throw new Error("Expected reserved payment");
    const order = await service.commitOrder({ merchantId: config.sandboxMerchantId, signedQuote: quote, mandate: payment.mandate, idempotencyKey: "version-commit-001" });
    const file = await service.delivery.download(config.sandboxConsumerId, order.orderId);
    expect(file.file_name).toBe("version-one.txt");
    expect(file.contents.toString()).toBe("Version one");
    await expect(service.delivery.upload("other_merchant", { offerId: "offer_research_pack" }, "bad.txt", Buffer.from("Bad"))).rejects.toMatchObject({ code: "DELIVERY_TARGET_NOT_FOUND" });
  });

  it("serializes overlapping turns and recovers the same request without a second purchase", async () => {
    let release!: () => void;
    let called!: () => void;
    const started = new Promise<void>((resolve) => { called = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { called(); await barrier; return modelResponse(tool("prepare_purchase", { offerId: "offer_research_pack", intent: "buy" })); });
    const input = { message: "Buy Market Research Pack under $80", requestId: randomUUID() };
    const first = service.chat.reply(config.sandboxConsumerId, input);
    await started;
    try { await expect(service.chat.reply(config.sandboxConsumerId, input)).rejects.toMatchObject({ code: "CHAT_BUSY" }); }
    finally { release(); }
    const result = await first;
    const retry = await service.chat.reply(config.sandboxConsumerId, input);
    expect(retry.message.action).toMatchObject({ status: "confirmed" });
    expect(retry.message.id).toBe(result.message.id);
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(1);
    await balanced();
  });

  it("releases an expired reservation before resuming even when the worker has slept", async () => {
    const spy = modelSequence([tool("prepare_purchase", { offerId: "offer_research_pack", intent: "review" })]);
    const started = (await chat("Review Market Research Pack under $80").expect(200)).body;
    spy.mockRestore();
    const action = started.message.action;
    const payment = await service.preparePayment({ consumerId: config.sandboxConsumerId, agentClientId: "payl_in_app_chat",
      signedQuote: action.signedQuote, idempotencyKey: `chat:${action.purchaseId}` });
    expect(payment.status).toBe("reserved");
    // Simulate a response lost after reservation, followed by expiry while the worker is asleep.
    await pool.query("UPDATE payment_intents SET expires_at = now() - interval '1 minute' WHERE id = $1", [payment.paymentId]);
    await pool.query("UPDATE consumer_chat_messages SET action = action || '{\"status\":\"expired\",\"autoRequested\":true}'::jsonb WHERE id = $1", [action.purchaseId]);
    await chat("Resume purchase", { conversationId: started.conversationId, purchaseId: action.purchaseId }).expect(200);
    expect((await service.walletSummary(config.sandboxConsumerId)).balances).toMatchObject({ available: "92500", reserved: "0" });
    expect((await pool.query("SELECT id FROM orders")).rowCount).toBe(1);
    expect((await pool.query("SELECT status FROM payment_intents WHERE id = $1", [payment.paymentId])).rows[0].status).toBe("cancelled");
    await balanced();
  });

  it("does not exhaust the connection pool while different consumers wait for the model", async () => {
    const ids = [config.sandboxConsumerId, "consumer_concurrent_2", "consumer_concurrent_3", "consumer_concurrent_4"];
    for (const id of ids.slice(1)) await pool.query("INSERT INTO consumers(id, display_name, status) VALUES ($1, 'Concurrent test', 'active')", [id]);
    let release!: () => void;
    let arrived!: () => void;
    let calls = 0;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const allArrived = new Promise<void>((resolve) => { arrived = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (++calls === ids.length) arrived();
      await barrier;
      return modelResponse(answer());
    });
    const pending = ids.map((id) => service.chat.reply(id, { message: "Show the catalog", requestId: randomUUID() }));
    try {
      await allArrived;
      expect((await pool.query("SELECT 1 AS ready")).rows[0].ready).toBe(1);
    } finally { release(); }
    expect(await Promise.all(pending)).toHaveLength(4);
    expect((await pool.query("SELECT consumer_id FROM consumer_chat_turn_leases")).rowCount).toBe(0);
  });
});
