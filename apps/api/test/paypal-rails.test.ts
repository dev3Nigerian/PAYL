import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";
import { seedLegacyCatalogFixture } from "./legacy-catalog-fixture.js";
import { FakePayPalGateway } from "./fake-paypal.js";

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
  PAYPAL_SANDBOX_CLIENT_ID: "sandbox-client-id",
  PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-business-id",
  PAYPAL_SANDBOX_WEBHOOK_ID: "sandbox-webhook-id",
});
const pool = createPool(config);
let paypal: FakePayPalGateway;
let service: PaylService;

beforeAll(async () => { await migrate(pool); });
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
  paypal = new FakePayPalGateway();
  service = new PaylService(pool, config, paypal);
  await service.seedSandbox();
  await seedLegacyCatalogFixture(pool, config.sandboxMerchantId);
});
afterAll(async () => { await pool.end(); });

function event(id: string, eventType: string, resource: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ id, event_type: eventType, resource }));
}

describe("PayPal Sandbox funding and withdrawals", () => {
  it("credits a completed top-up once and reverses a confirmed capture once", async () => {
    paypal.captureStatus = "DECLINED";
    const created = await service.createTopup({ consumerId: "consumer_demo", amountMinor: "2500", idempotencyKey: "topup-one" });
    const topupId = created.topupId as string;
    const orderId = created.paypalOrderId as string;
    expect(await service.createTopup({ consumerId: "consumer_demo", amountMinor: "2500", idempotencyKey: "topup-one" }))
      .toMatchObject({ topupId, paypalOrderId: orderId });
    expect(await service.captureTopup("consumer_demo", topupId)).toMatchObject({ status: "pending" });
    expect(await service.walletSummary("consumer_demo")).toMatchObject({ balances: { available: "100000" } });
    const cancelled = await service.createTopup({ consumerId: "consumer_demo", amountMinor: "500", idempotencyKey: "topup-cancelled" });
    expect(await service.cancelTopup("consumer_demo", cancelled.topupId as string)).toMatchObject({ status: "cancelled" });
    expect(await service.topupStatus("consumer_demo", cancelled.topupId as string)).toMatchObject({ status: "cancelled" });

    paypal.captureStatus = "COMPLETED";
    const captured = await service.captureTopup("consumer_demo", topupId);
    expect(captured).toMatchObject({ status: "completed", amountMinor: "2500", providerFeeMinor: "30" });
    expect(await service.captureTopup("consumer_demo", topupId)).toMatchObject({ status: "completed" });
    const completeEvent = event("evt_capture_one", "PAYMENT.CAPTURE.COMPLETED", {
      supplementary_data: { related_ids: { order_id: orderId } },
    });
    await service.handlePayPalWebhook(completeEvent, {});
    await service.handlePayPalWebhook(completeEvent, {});
    expect(await service.walletSummary("consumer_demo")).toMatchObject({ balances: { available: "102500" } });
    const creditCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM journal_entries WHERE event_type = 'paypal_wallet_topup'",
    );
    expect(creditCount.rows[0]?.count).toBe("1");
    const feeCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM journal_entries WHERE event_type = 'paypal_topup_fee'",
    );
    expect(feeCount.rows[0]?.count).toBe("1");

    paypal.verified = false;
    await expect(service.handlePayPalWebhook(event("evt_unverified", "PAYMENT.CAPTURE.REVERSED", {
      id: captured.paypalCaptureId, amount: { currency_code: "USD", value: "25.00" },
    }), {})).rejects.toThrow("signature is invalid");
    paypal.verified = true;
    const reversal = event("evt_reversed", "PAYMENT.CAPTURE.REFUNDED", {
      id: "PP_REFUND_ONE", amount: { currency_code: "USD", value: "25.00" },
      links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captured.paypalCaptureId}` }],
    });
    await service.handlePayPalWebhook(reversal, {});
    await service.handlePayPalWebhook(reversal, {});
    expect(await service.walletSummary("consumer_demo")).toMatchObject({ balances: { available: "100000" } });
    expect(await service.topupStatus("consumer_demo", topupId)).toMatchObject({ status: "reversed", reversedAmountMinor: "2500" });
  });

  it("holds pending withdrawals, restores failures, and handles a late return", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo", agentClientId: "agent_paypal_rails", signedQuote: quote, idempotencyKey: "prepare-paypal-rails",
    });
    if (prepared.status !== "reserved") throw new Error("Expected policy-authorized payment");
    await service.commitOrder({ merchantId: "merchant_demo", signedQuote: quote, mandate: prepared.mandate, idempotencyKey: "commit-paypal-rails" });
    expect(paypal.orderCreates).toBe(0);
    await service.setPayoutEmail("merchant_demo", "merchant-paypal@example.com");
    const first = await service.createPayout({ merchantId: "merchant_demo", idempotencyKey: "withdraw-first" });
    expect(first).toMatchObject({ status: "pending", sourcePayableMinor: "7350", reserveHeldMinor: "735", paidAmountMinor: "6615", recipientEmail: "merchant-paypal@example.com" });
    expect(await service.createPayout({ merchantId: "merchant_demo", idempotencyKey: "withdraw-first" })).toMatchObject({ payoutId: first.payoutId });
    expect(paypal.payoutCreates).toBe(1);
    const pending = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string; reserve: string; payoutPending: string } } };
    expect(pending.merchant.balances).toMatchObject({ payable: "0", reserve: "735", payoutPending: "6615" });

    paypal.payoutStatus = "FAILED";
    expect(await service.payoutStatus("merchant_demo", first.payoutId as string)).toMatchObject({ status: "failed" });
    const failed = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string; reserve: string; payoutPending: string } } };
    expect(failed.merchant.balances).toMatchObject({ payable: "7350", reserve: "0", payoutPending: "0" });
    expect(await service.reconciliationReport("merchant_demo")).toMatchObject({ differenceMinor: "0", reconciled: true });

    paypal.payoutStatus = "PENDING";
    const second = await service.createPayout({ merchantId: "merchant_demo", idempotencyKey: "withdraw-second" });
    paypal.payoutStatus = "SUCCESS";
    expect(await service.payoutStatus("merchant_demo", second.payoutId as string)).toMatchObject({ status: "paid" });
    expect(await service.reconciliationReport("merchant_demo")).toMatchObject({ differenceMinor: "0", reconciled: true });

    paypal.payoutStatus = "RETURNED";
    const returned = event("evt_payout_returned", "PAYMENT.PAYOUTS-ITEM.RETURNED", { id: `PP_ITEM_${second.payoutId}` });
    await service.handlePayPalWebhook(returned, {});
    await service.handlePayPalWebhook(returned, {});
    expect(await service.payoutStatus("merchant_demo", second.payoutId as string)).toMatchObject({ status: "failed" });
    const restored = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string; reserve: string; payoutPending: string } } };
    expect(restored.merchant.balances).toMatchObject({ payable: "7350", reserve: "0", payoutPending: "0" });
    expect(await service.reconciliationReport("merchant_demo")).toMatchObject({ differenceMinor: "0", reconciled: true });
  });
});
