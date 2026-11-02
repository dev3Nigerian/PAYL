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
  ...process.env, NODE_ENV: "test", PAYL_DEPLOYMENT_PROFILE: "local_sandbox", PAYL_DEV_KEYS: "true",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  APPROVAL_WEB_URL: "http://localhost:3000", MERCHANT_WEB_URL: "http://localhost:3001", PUBLIC_BASE_URL: "http://localhost:4100",
});
const pool = createPool(config);
const service = new PaylService(pool, config);
const identity = new IdentityService(pool, config);
let app: ReturnType<typeof createApp>;
const input = { displayName: "New Shopper", email: "shopper@example.test", password: "SandboxShopper!2026" };

beforeAll(async () => { await migrate(pool); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE consumers, merchants, ledger_accounts, journal_entries, audit_events,
    outbox_events, reconciliation_reports RESTART IDENTITY CASCADE`);
  await service.seedSandbox();
  await identity.seedSandboxUsers();
  app = createApp(service, identity, new PaylOAuthProvider(pool, config), config);
});
afterAll(async () => { await pool.end(); });

async function register(email = input.email) {
  return (await request(app).post("/api/auth/register/consumer").send({ ...input, email }).expect(201)).body as {
    consumerId: string; userId: string; sessionToken: string; welcomeCredit: { amountMinor: string; currency: string; sandbox: boolean };
  };
}

describe("consumer sandbox registration", () => {
  it("creates an isolated wallet, policy, and session with exactly $100 virtual USD", async () => {
    const response = await request(app).post("/api/auth/register/consumer").send({
      ...input, email: "  SHOPPER@example.test  ", amountMinor: "99999999", role: "merchant_admin", consumerId: "consumer_demo",
    }).expect(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ email: input.email, role: "consumer", welcomeCredit: { amountMinor: "10000", currency: "USD", sandbox: true } });
    expect(response.body.consumerId).not.toBe(config.sandboxConsumerId);
    expect(response.body).not.toHaveProperty("password_hash");
    expect(response.body).not.toHaveProperty("mfa_secret");
    const token = response.body.sessionToken as string;
    const dashboard = await request(app).get("/api/consumer/dashboard").set("authorization", `Bearer ${token}`).expect(200);
    expect(dashboard.body.wallet).toMatchObject({ displayName: input.displayName, currency: "USD", balances: { available: "10000", reserved: "0" } });
    expect(dashboard.body.policy).toMatchObject({ autoApproveLimitMinor: "5000", perTransactionLimitMinor: "50000", dailyLimitMinor: "100000" });
    expect(dashboard.body.orders).toEqual([]);
    await request(app).get("/api/merchant/dashboard").set("authorization", `Bearer ${token}`).expect(403);
    const journal = await pool.query(`SELECT e.event_type, sum(l.amount_minor)::text AS balance, count(*)::int AS lines
      FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.reference_id = $1 GROUP BY e.id`, [response.body.consumerId]);
    expect(journal.rows).toEqual([{ event_type: "sandbox_signup_credit", balance: "0", lines: 2 }]);
    expect(await service.walletSummary(config.sandboxConsumerId)).toMatchObject({ balances: { available: "100000" } });
  });

  it("does not grant extra credit for concurrent duplicate registration, retries, or sign-in", async () => {
    const results = await Promise.all([
      request(app).post("/api/auth/register/consumer").send(input),
      request(app).post("/api/auth/register/consumer").send({ ...input, email: input.email.toUpperCase() }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    await request(app).post("/api/auth/register/consumer").send(input).expect(409);
    const login = await request(app).post("/api/auth/login").send({ email: input.email, password: input.password, role: "consumer" }).expect(200);
    expect(await service.walletSummary(login.body.consumerId as string)).toMatchObject({ balances: { available: "10000" } });
    expect((await pool.query("SELECT id FROM consumers")).rowCount).toBe(2);
    expect((await pool.query("SELECT id FROM journal_entries WHERE event_type = 'sandbox_signup_credit'")).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM ledger_accounts WHERE owner_id = $1", [login.body.consumerId])).rowCount).toBe(2);
  });

  it("rolls back the wallet and grant if session creation fails", async () => {
    await pool.query("ALTER TABLE auth_sessions ADD CONSTRAINT registration_test_rejection CHECK (false) NOT VALID");
    try { await request(app).post("/api/auth/register/consumer").send(input).expect(500); }
    finally { await pool.query("ALTER TABLE auth_sessions DROP CONSTRAINT registration_test_rejection"); }
    expect((await pool.query("SELECT id FROM auth_users WHERE email = $1", [input.email])).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM consumers")).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM journal_entries WHERE event_type = 'sandbox_signup_credit'")).rowCount).toBe(0);
    const result = await register();
    expect(await service.walletSummary(result.consumerId)).toMatchObject({ balances: { available: "10000" } });
  });

  it.each([
    { displayName: " " }, { displayName: "A" }, { email: "invalid" }, { password: "short" }, { password: "x".repeat(129) },
  ])("rejects invalid registration without creating funds: %j", async (invalid) => {
    await request(app).post("/api/auth/register/consumer").send({ ...input, ...invalid }).expect(400);
    expect((await pool.query("SELECT id FROM journal_entries WHERE event_type = 'sandbox_signup_credit'")).rowCount).toBe(0);
  });

  it("respects existing merchant identities and never grants them a consumer bonus", async () => {
    await request(app).post("/api/auth/register/consumer").send({ ...input, email: config.sandboxMerchantEmail }).expect(409);
    expect((await pool.query("SELECT id FROM journal_entries WHERE event_type = 'sandbox_signup_credit'")).rowCount).toBe(0);
  });

  it("provisions a wallet even when no demo bootstrap accounts exist", async () => {
    await pool.query("TRUNCATE TABLE consumers, merchants, ledger_accounts, journal_entries RESTART IDENTITY CASCADE");
    const result = await register();
    expect(await service.walletSummary(result.consumerId)).toMatchObject({ balances: { available: "10000" } });
    expect((await pool.query("SELECT id FROM ledger_accounts WHERE owner_type = 'platform'")).rowCount).toBe(3);
  });

  it("enrolls a private authenticator and spends the welcome credit through an approved PAYL purchase", async () => {
    const result = await register();
    const auth = `Bearer ${result.sessionToken}`;
    const status = await request(app).get("/api/consumer/mfa").set("authorization", auth).expect(200);
    expect(status.body).toEqual({ configured: false });
    const setup = await request(app).post("/api/consumer/mfa").set("authorization", auth).send({ action: "start" }).expect(200);
    const secret = setup.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const resumed = await request(app).post("/api/consumer/mfa").set("authorization", auth).send({ action: "start" }).expect(200);
    expect(resumed.body.secret).toBe(secret);
    await expect(identity.verifyApprovalMfa(result.userId, totpCode(secret))).rejects.toMatchObject({ code: "MFA_NOT_CONFIGURED" });
    await request(app).post("/api/consumer/mfa").set("authorization", auth).send({ action: "confirm", mfaCode: "123" }).expect(403);
    await request(app).post("/api/consumer/mfa").set("authorization", auth).send({ action: "confirm", mfaCode: totpCode(secret) }).expect(200);
    await request(app).post("/api/consumer/mfa").set("authorization", auth).send({ action: "start" }).expect(409);
    const verified = await request(app).get("/api/consumer/mfa").set("authorization", auth).expect(200);
    expect(verified.body).toEqual({ configured: true });
    const user = (await pool.query("SELECT mfa_pending_secret FROM auth_users WHERE id = $1", [result.userId])).rows[0];
    expect(user.mfa_pending_secret).toBeNull();

    const quote = await request(app).post("/api/consumer/checkout/quote").set("authorization", auth).send({ merchantId: config.sandboxMerchantId, offerId: "offer_research_pack", quantity: 1 }).expect(200);
    const checkout = { signedQuote: quote.body.signedQuote, idempotencyKey: "new-consumer-purchase-001" };
    const pending = await request(app).post("/api/consumer/checkout/confirm").set("authorization", auth).send(checkout).expect(200);
    expect(pending.body.status).toBe("pending_approval");
    const approval = (await pool.query("SELECT id FROM approval_challenges WHERE payment_id = $1", [pending.body.paymentId])).rows[0];
    await request(app).post(`/api/approvals/${approval.id}/decision`).set("authorization", auth).send({ decision: "approve", mfaCode: totpCode(secret) }).expect(200);
    await request(app).post("/api/consumer/checkout/complete").set("authorization", auth).send({ ...checkout, paymentId: pending.body.paymentId }).expect(200);
    expect(await service.walletSummary(result.consumerId)).toMatchObject({ balances: { available: "2500", reserved: "0" } });
  });

  it("isolates MFA setup by authenticated consumer and rejects cross-origin cookie writes", async () => {
    await request(app).get("/api/consumer/mfa").expect(401);
    const first = await register();
    const second = await register("second@example.test");
    const setup = await request(app).post("/api/consumer/mfa").set("authorization", `Bearer ${first.sessionToken}`).send({ action: "start", userId: second.userId }).expect(200);
    const other = await request(app).post("/api/consumer/mfa").set("authorization", `Bearer ${second.sessionToken}`).send({ action: "start" }).expect(200);
    expect(setup.body.secret).not.toBe(other.body.secret);
    await request(app).post("/api/consumer/mfa").set("cookie", `payl_consumer_session=${first.sessionToken}`).set("origin", "https://other.example").send({ action: "confirm", mfaCode: totpCode(setup.body.secret as string) }).expect(403);
    const merchant = await identity.login(config.sandboxMerchantEmail, config.sandboxMerchantPassword, "merchant_admin");
    await request(app).post("/api/consumer/mfa").set("authorization", `Bearer ${merchant.token}`).send({ action: "start" }).expect(403);
  });
});
