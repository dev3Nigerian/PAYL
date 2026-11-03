import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { IdentityService, totpCode } from "../src/identity.js";
import { PaylService } from "../src/service.js";
import { PaylOAuthProvider } from "../src/oauth.js";
import { BackroomService } from "../src/backroom.js";
import { createApp } from "../src/app.js";
import { FakePayPalGateway } from "./fake-paypal.js";

// Fixed credentials only for the isolated local/CI test database.
const owner = { email: "owner@example.test", password: "LocalOwnerTestOnly!2026", totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" };
const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  PAYL_BACKROOM_EMAIL: owner.email, PAYL_BACKROOM_PASSWORD: owner.password, PAYL_BACKROOM_TOTP_SECRET: owner.totpSecret,
  PAYPAL_SANDBOX_CLIENT_ID: "test", PAYPAL_SANDBOX_CLIENT_SECRET: "test", PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-business-id", PAYPAL_SANDBOX_WEBHOOK_ID: "test", DEEPSEEK_API_KEY: "test" });
const pool = createPool(config);
const service = new PaylService(pool, config, new FakePayPalGateway());
const identity = new IdentityService(pool, config);
const backroom = new BackroomService(pool, config);
let app: ReturnType<typeof createApp>;

beforeAll(async () => { await migrate(pool); });
beforeEach(async () => {
  await pool.query("TRUNCATE TABLE consumers, merchants, auth_users, ledger_accounts, journal_entries, audit_events, outbox_events, reconciliation_reports, paypal_webhook_events, operations_heartbeats RESTART IDENTITY CASCADE");
  await service.seedSandbox();
  await identity.seedSandboxUsers();
  await identity.seedBackroomOwner();
  app = createApp(service, identity, new PaylOAuthProvider(pool, config), config, backroom);
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });
async function login() { return identity.login(owner.email, owner.password, "platform_admin", totpCode(owner.totpSecret)); }

describe("owner authentication", () => {
  it("requires all three credentials and has no default owner", () => {
    expect(loadConfig({}).backroom).toBeNull();
    expect(() => loadConfig({ PAYL_BACKROOM_EMAIL: owner.email })).toThrow("together");
    expect(() => loadConfig({ PAYL_BACKROOM_EMAIL: owner.email, PAYL_BACKROOM_PASSWORD: "short", PAYL_BACKROOM_TOTP_SECRET: owner.totpSecret })).toThrow();
  });

  it("cannot promote an existing public account or create an owner through signup", async () => {
    const colliding = new IdentityService(pool, { ...config, backroom: { ...owner, email: config.sandboxConsumerEmail } });
    await expect(colliding.seedBackroomOwner()).rejects.toThrow("separate");
    const registered = await request(app).post("/api/auth/register/consumer").send({ displayName: "Public Shopper", email: "public@example.test", password: "PublicTestOnly!2026", role: "platform_admin" }).expect(201);
    expect(registered.body.role).toBe("consumer");
    await request(app).get("/api/backroom/overview").set("authorization", `Bearer ${registered.body.sessionToken}`).expect(403);
    await request(app).post("/api/auth/login").send({ email: owner.email, password: owner.password, role: "platform_admin" }).expect(400);
  });

  it("requires password and MFA, prevents simultaneous TOTP reuse, and uses one-hour sessions", async () => {
    await request(app).post("/api/backroom/login").send({ email: owner.email, password: "WrongPassword!2026", mfaCode: totpCode(owner.totpSecret) }).expect(401);
    await request(app).post("/api/backroom/login").send({ email: owner.email, password: owner.password }).expect(403);
    const wrongCode = totpCode(owner.totpSecret, Date.now() - 300_000);
    await expect(identity.login(owner.email, owner.password, "platform_admin", wrongCode)).rejects.toMatchObject({ code: "MFA_INVALID" });
    const attempts = await Promise.allSettled([login(), login()]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "MFA_REPLAYED" } });
    const success = attempts.find((item) => item.status === "fulfilled")!;
    if (success.status !== "fulfilled") throw new Error("Expected successful owner login");
    expect(new Date(success.value.session.expiresAt).valueOf() - Date.now()).toBe(3_600_000);
    await identity.seedBackroomOwner();
    await expect(login()).rejects.toMatchObject({ code: "MFA_REPLAYED" });
    const audit = await pool.query("SELECT event_type FROM audit_events WHERE actor_id='user_backroom_owner'");
    expect(audit.rows).toContainEqual({ event_type: "backroom.signed_in" });
  });

  it("denies unauthenticated and consumer/merchant access to every reporting route", async () => {
    const consumer = await identity.login(config.sandboxConsumerEmail, config.sandboxConsumerPassword, "consumer");
    const merchant = await identity.login(config.sandboxMerchantEmail, config.sandboxMerchantPassword, "merchant_admin");
    for (const path of ["/api/backroom/overview", "/api/backroom/records?kind=consumers", "/api/backroom/records?kind=ledger"]) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set("authorization", "Bearer unrelated-mcp-token").expect(401);
      for (const token of [consumer.token, merchant.token]) await request(app).get(path).set("authorization", `Bearer ${token}`).expect(403);
    }
    const session = await login();
    await request(app).get("/api/consumer/dashboard").set("authorization", `Bearer ${session.token}`).expect(403);
    await request(app).get("/api/merchant/dashboard").set("authorization", `Bearer ${session.token}`).expect(403);
    await expect(identity.createBrowserHandoff(session.session)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("revokes access after logout, credential rotation, disablement, or expiry", async () => {
    const session = await login();
    const result = await request(app).get("/api/backroom/overview").set("authorization", `Bearer ${session.token}`).expect(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.headers["x-robots-tag"]).toContain("noindex");
    const disabledConfig = { ...config, backroom: null };
    const disabled = new IdentityService(pool, disabledConfig);
    await expect(disabled.authenticateSessionToken(session.token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await request(createApp(service, disabled, new PaylOAuthProvider(pool, disabledConfig), disabledConfig, backroom)).get("/api/backroom/overview").expect(503);
    await request(app).post("/api/backroom/logout").set("authorization", `Bearer ${session.token}`).expect(204);
    await expect(identity.authenticateSessionToken(session.token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_000);
    const second = await login();
    const rotated = new IdentityService(pool, { ...config, backroom: { ...owner, password: "RotatedTestOnly!2026" } });
    await rotated.seedBackroomOwner();
    await expect(identity.authenticateSessionToken(second.token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(rotated.login(owner.email, owner.password, "platform_admin", totpCode(owner.totpSecret))).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const third = await rotated.login(owner.email, "RotatedTestOnly!2026", "platform_admin", totpCode(owner.totpSecret));
    await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [third.session.sessionId]);
    await expect(rotated.authenticateSessionToken(third.token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("operations reporting", () => {
  it("does not revive an old owner session when access is disabled and later re-enabled", async () => {
    const session = await login();
    await new IdentityService(pool, { ...config, backroom: null }).seedBackroomOwner();
    await identity.seedBackroomOwner();
    await expect(identity.authenticateSessionToken(session.token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("returns every listing without changing wallet or journal data, excludes private content, and records heartbeat state", async () => {
    const before = await pool.query("SELECT count(*)::text AS count, sum(amount_minor)::text AS total FROM journal_lines");
    await pool.query(`INSERT INTO audit_events(correlation_id,actor_type,actor_id,event_type,object_type,object_id,metadata)
      VALUES ('private-record','test','test','private.test','test','test','{"password":"hidden-secret","content":"private chat"}')`);
    const session = await login();
    for (const kind of ["orders", "topups", "payouts", "consumers", "merchants", "ledger", "events", "webhooks", "paypal_events"]) {
      const result = await request(app).get(`/api/backroom/records?kind=${kind}`).set("authorization", `Bearer ${session.token}`).expect(200);
      expect(result.body).toMatchObject({ kind, page: 1, hasMore: false, rows: expect.any(Array), columns: expect.any(Array) });
      expect(JSON.stringify(result.body)).not.toMatch(/hidden-secret|private chat|password_hash|mfa_secret|sessionToken|signing_secret/);
    }
    expect((await backroom.overview("7")).health.worker).toBeNull();
    await service.recordLifecycleHeartbeat(true);
    const healthy = await backroom.overview("7");
    expect(healthy.health).toMatchObject({ database: "ready", paypal: "configured", ai: "configured", worker: { status: "ok", last_success_at: expect.any(Date) } });
    await service.recordLifecycleHeartbeat(false);
    expect((await backroom.overview("7")).health.worker).toMatchObject({ status: "failed", last_success_at: healthy.health.worker.last_success_at });
    expect((await pool.query("SELECT count(*)::text AS count, sum(amount_minor)::text AS total FROM journal_lines")).rows).toEqual(before.rows);
  });

  it("reports exact full-credit funding and keeps currencies separate", async () => {
    const signup = await identity.registerConsumer({ displayName: "New Shopper", email: "new@example.test", password: "NewShopperTest!2026" });
    const created = await service.createTopup({ consumerId: signup.session.consumerId!, amountMinor: "2500", idempotencyKey: "backroom-credit" });
    await service.captureTopup(signup.session.consumerId!, created.topupId as string);
    await pool.query(`INSERT INTO ledger_accounts(id,owner_type,owner_id,account_type,currency) VALUES ('jpy-wallet','consumer','foreign','available','JPY'), ('jpy-clearing','platform','foreign','clearing','JPY')`);
    await pool.query("INSERT INTO journal_entries(id,event_type,idempotency_key,reference_type,reference_id) VALUES ('foreign-credit','test','foreign-credit','test','foreign')");
    await pool.query("INSERT INTO journal_lines(entry_id,account_id,amount_minor) VALUES ('foreign-credit','jpy-wallet',12345),('foreign-credit','jpy-clearing',-12345)");
    const result = await backroom.overview("7");
    expect(result.counts.unbalanced_journals).toBe("0");
    expect(result.balances.find((row) => row.currency === "USD")).toMatchObject({ consumer_available: "112500" });
    expect(result.balances.find((row) => row.currency === "JPY")).toMatchObject({ consumer_available: "12345" });
    const shoppers = await backroom.records({ kind: "consumers", q: "new@example.test" });
    expect(shoppers.rows).toMatchObject([{ amount_minor: "12500" }]);
    expect(result.daily).toHaveLength(7);
    expect(result.daily.at(-1).signups).toBeGreaterThan(0);
  });

  it("detects empty and cross-currency unbalanced journals even when their global sum is zero", async () => {
    await pool.query("INSERT INTO journal_entries(id,event_type,idempotency_key,reference_type,reference_id) VALUES ('empty','test','empty','test','bad'), ('mixed','test','mixed','test','bad')");
    await pool.query(`INSERT INTO ledger_accounts(id,owner_type,owner_id,account_type,currency) VALUES ('bad-usd','platform','test','clearing','USD'), ('bad-gbp','platform','test','clearing','GBP')`);
    await pool.query("INSERT INTO journal_lines(entry_id,account_id,amount_minor) VALUES ('mixed','bad-usd',5),('mixed','bad-gbp',-5)");
    expect((await backroom.overview("7")).counts.unbalanced_journals).toBe("3");
    const rows = (await backroom.records({ kind: "ledger", status: "unbalanced" })).rows;
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.id === "mixed").map((row) => row.currency).sort()).toEqual(["GBP", "USD"]);
  });

  it("filters attention queues by age and final state", async () => {
    await pool.query(`INSERT INTO wallet_topups(id,consumer_id,amount_minor,currency,status,idempotency_key,created_at) VALUES
      ('old-pending','consumer_demo',1000,'USD','pending','old-pending',now()-interval '1 hour'),
      ('old-complete','consumer_demo',1000,'USD','completed','old-complete',now()-interval '1 hour'),
      ('new-pending','consumer_demo',1000,'USD','pending','new-pending',now())`);
    await pool.query(`INSERT INTO payout_batches(id,merchant_id,currency,source_payable_minor,reserve_held_minor,paid_amount_minor,status,idempotency_key,created_at,updated_at) VALUES
      ('old-payout','merchant_demo','USD',1000,100,900,'pending','old-payout',now()-interval '1 hour',now()),
      ('new-payout','merchant_demo','USD',1000,100,900,'pending','new-payout',now(),now()),
      ('failed-payout','merchant_demo','USD',1000,100,900,'failed','failed-payout',now()-interval '60 days',now()),
      ('past-failure','merchant_demo','USD',1000,100,900,'failed','past-failure',now()-interval '60 days',now()-interval '60 days')`);
    await pool.query(`INSERT INTO outbox_events(id,merchant_id,event_type,aggregate_type,aggregate_id,payload,status,attempts,dedupe_key)
      VALUES ('dead-event','merchant_demo','test','order','missing','{}','dead',8,'dead-event')`);
    expect((await backroom.overview("7")).counts).toMatchObject({ stale_topups: "1", pending_payouts: "2", stale_payouts: "1", failed_payouts: "1", dead_webhooks: "1" });
    expect((await backroom.records({ kind: "topups", attention: "stale_topups" })).rows.map((row) => row.id)).toEqual(["old-pending"]);
    expect((await backroom.records({ kind: "payouts", attention: "stale_payouts" })).rows.map((row) => row.id)).toEqual(["old-payout"]);
    expect((await backroom.records({ kind: "payouts", days: "3650", attention: "failed_payouts", attentionDays: "7" })).rows.map((row) => row.id)).toEqual(["failed-payout"]);
  });

  it("paginates deterministically, searches literal references, and rejects unsupported filters", async () => {
    await pool.query(`INSERT INTO paypal_webhook_events(id,event_type,resource_id) SELECT 'event_'||lpad(n::text,3,'0'),'test','resource' FROM generate_series(1,53) n`);
    const first = await backroom.records({ kind: "paypal_events" });
    const second = await backroom.records({ kind: "paypal_events", page: "2" });
    expect(first.rows).toHaveLength(50); expect(first.hasMore).toBe(true);
    expect(second.rows).toHaveLength(3); expect(second.hasMore).toBe(false);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(53);
    expect((await backroom.records({ kind: "paypal_events", q: "%" })).rows).toHaveLength(0);
    expect((await backroom.records({ kind: "paypal_events", q: "event_053" })).rows).toHaveLength(1);
    expect((await backroom.records({ kind: "paypal_events", q: "' OR 1=1 --" })).rows).toHaveLength(0);
    for (const input of [{ kind: "__proto__" }, { page: "0" }, { page: "1.5" }, { days: "99999" }, { status: [] }, { q: "x".repeat(121) }, { kind: "orders", attention: "stale_payouts" }]) await expect(backroom.records(input)).rejects.toMatchObject({ code: "INVALID_FILTER" });
    await expect(backroom.overview("0")).rejects.toMatchObject({ code: "INVALID_FILTER" });
  });
});
