import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";
import { IdentityService } from "../src/identity.js";
import { FakePayPalGateway } from "./fake-paypal.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  PAYL_DEPLOYMENT_PROFILE: "local_sandbox",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  APPROVAL_WEB_URL: "http://localhost:3000",
  PAYL_ISSUER: "https://sandbox.payl.local",
  PAYL_DEV_KEYS: "true",
  SANDBOX_CONSUMER_ID: "consumer_demo",
  SANDBOX_MERCHANT_ID: "merchant_demo",
  PAYPAL_SANDBOX_CLIENT_ID: "sandbox-client-id",
  PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-business-id",
  PAYPAL_SANDBOX_WEBHOOK_ID: "sandbox-webhook-id",
});
const pool = createPool(config);
const paypal = new FakePayPalGateway();
const service = new PaylService(pool, config, paypal);
const identity = new IdentityService(pool, config);

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

describe("PAYL signed quote to receipt flow", () => {
  it("requires separate human approval and captures exactly once", async () => {
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_reference",
      signedQuote: quote,
      idempotencyKey: "prepare-human-001",
    });

    expect(prepared.status).toBe("pending_approval");
    if (prepared.status !== "pending_approval") throw new Error("Expected approval challenge");

    const beforeApproval = await service.walletSummary("consumer_demo");
    expect(beforeApproval.balances).toEqual({ available: "100000", reserved: "0" });

    await service.decideApproval(prepared.approvalId, "consumer_demo", "approve");
    const authorized = await service.paymentStatus(prepared.paymentId, "consumer_demo");
    expect(authorized.status).toBe("reserved");
    expect(authorized.mandate).toBeDefined();

    const receipt = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: quote,
      mandate: authorized.mandate as never,
      idempotencyKey: "commit-human-001",
    });
    expect(receipt.receipt?.payload.capturedAmountMinor).toBe("7500");
    expect(receipt.receipt?.payload.fulfillmentStatus).toBe("fulfilled");

    const duplicate = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: quote,
      mandate: authorized.mandate as never,
      idempotencyKey: "commit-human-retry-002",
    });
    expect(duplicate.orderId).toBe(receipt.orderId);

    const state = await service.demoState();
    expect(state.ledger).toEqual({ entries: "4", unbalanced_entries: "0" });
    expect((state.wallet as { balances: unknown }).balances).toEqual({ available: "92500", reserved: "0" });

    const merchant = await pool.query<{ balance: string }>(
      `SELECT COALESCE(sum(l.amount_minor), 0)::text AS balance
       FROM journal_lines l WHERE l.account_id = 'acct_merchant_payable'`,
    );
    expect(merchant.rows[0]?.balance).toBe("7350");
  });

  it("auto-authorizes only within the configured policy", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_reference",
      signedQuote: quote,
      idempotencyKey: "prepare-auto-001",
    });
    expect(prepared.status).toBe("reserved");
    if (prepared.status === "reserved") expect(prepared.mandate.payload.approvalLevel).toBe("policy_auto");
  });

  it("rejects a quote whose payload was changed after signing", async () => {
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const tampered = {
      ...quote,
      payload: { ...quote.payload, totalMinor: "1" },
    };
    await expect(
      service.preparePayment({
        consumerId: "consumer_demo",
        agentClientId: "agent_reference",
        signedQuote: tampered,
        idempotencyKey: "prepare-tampered-001",
      }),
    ).rejects.toThrow("Signed payload does not match");
  });

  it("updates policy limits with optimistic version checks", async () => {
    const updated = await service.updateWalletPolicy({
      consumerId: "consumer_demo",
      expectedVersion: 1,
      autoApproveLimitMinor: "2500",
      perTransactionLimitMinor: "30000",
      dailyLimitMinor: "80000",
    });
    expect(updated).toMatchObject({
      version: 2,
      autoApproveLimitMinor: "2500",
      perTransactionLimitMinor: "30000",
      dailyLimitMinor: "80000",
    });
    await expect(service.updateWalletPolicy({
      consumerId: "consumer_demo",
      expectedVersion: 1,
      autoApproveLimitMinor: "2500",
      perTransactionLimitMinor: "30000",
      dailyLimitMinor: "80000",
    })).rejects.toThrow("Policy changed in another session");
  });

  it("lets a merchant create and deactivate products exposed through MCP search", async () => {
    const product = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Campaign Audit",
      description: "A structured audit of one digital campaign.",
      priceMinor: "22000",
      fulfillmentMethod: "digital_service",
    });
    expect(product).toMatchObject({ name: "Campaign Audit", active: true, priceMinor: "22000" });
    const offerId = product.offerId as string;
    expect(await service.searchOffers("merchant_demo", "Campaign")).toHaveLength(1);
    await service.setMerchantOfferActive("merchant_demo", offerId, false);
    expect(await service.searchOffers("merchant_demo", "Campaign")).toHaveLength(0);
  });

  it("snapshots merchant refund terms into signed quotes", async () => {
    const product = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Refundable Campaign Audit",
      description: "A campaign audit with a merchant-defined refund period.",
      priceMinor: "15000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 24 * 60,
    });
    const firstQuote = await service.createQuote("merchant_demo", product.offerId as string, 1);
    expect(firstQuote.payload).toMatchObject({
      schemaVersion: "2026-07-19",
      refundPolicy: { refundable: true, refundWindowMinutes: 1440 },
    });

    await service.updateMerchantOffer({
      merchantId: "merchant_demo",
      offerId: product.offerId as string,
      refundable: false,
      refundWindowMinutes: null,
    });
    const secondQuote = await service.createQuote("merchant_demo", product.offerId as string, 1);
    expect(secondQuote.payload).toMatchObject({
      refundPolicy: { refundable: false, refundWindowMinutes: null },
    });
    expect(firstQuote.payload).toMatchObject({ refundPolicy: { refundable: true, refundWindowMinutes: 1440 } });

    await expect(service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Invalid Refund Window",
      description: "A product whose refund window is not a whole hour.",
      priceMinor: "1000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 90,
    })).rejects.toThrow("whole number of hours");
  });

  it("refunds the consumer in full while retaining PAYL's fee from the merchant", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_refund_test",
      signedQuote: quote,
      idempotencyKey: "prepare-refund-001",
    });
    if (prepared.status !== "reserved") throw new Error("Expected policy-approved payment");
    const order = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: quote,
      mandate: prepared.mandate,
      idempotencyKey: "commit-refund-001",
    });

    const [refund, retry] = await Promise.all([
      service.refundOrder({ consumerId: "consumer_demo", orderId: order.orderId, idempotencyKey: "refund-full-001", reason: "Not needed" }),
      service.refundOrder({ consumerId: "consumer_demo", orderId: order.orderId, idempotencyKey: "refund-full-001", reason: "Not needed" }),
    ]);
    expect(refund.payload).toMatchObject({
      orderId: order.orderId,
      refundedAmountMinor: "7500",
      retainedFeeMinor: "150",
      status: "refunded",
    });
    expect(retry.payload.refundId).toBe(refund.payload.refundId);
    const secondRetry = await service.refundOrder({
      consumerId: "consumer_demo",
      orderId: order.orderId,
      idempotencyKey: "refund-full-retry-002",
    });
    expect(secondRetry.payload.refundId).toBe(refund.payload.refundId);

    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "100000", reserved: "0" });
    const balances = await pool.query<{ account_type: string; balance: string }>(
      `SELECT a.account_type, COALESCE(sum(l.amount_minor), 0)::text AS balance
       FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
       WHERE a.id IN ('acct_merchant_payable', 'acct_platform_fee')
       GROUP BY a.id, a.account_type ORDER BY a.account_type`,
    );
    expect(Object.fromEntries(balances.rows.map((row) => [row.account_type, row.balance]))).toEqual({
      fee_revenue: "150",
      payable: "-150",
    });
    const lifecycle = await pool.query<{ order_status: string; payment_status: string }>(
      `SELECT o.status AS order_status, p.status AS payment_status
       FROM orders o JOIN payment_intents p ON p.id = o.payment_id WHERE o.id = $1`,
      [order.orderId],
    );
    expect(lifecycle.rows[0]).toEqual({ order_status: "refunded", payment_status: "refunded" });
    const state = await service.demoState() as {
      ledger: { entries: string; unbalanced_entries: string };
      merchant: { totals: { netSalesMinor: string; retainedRefundFeesMinor: string; refundedOrders: string } };
    };
    expect(state.ledger).toEqual({ entries: "5", unbalanced_entries: "0" });
    expect(state.merchant.totals).toMatchObject({ netSalesMinor: "-150", retainedRefundFeesMinor: "150", refundedOrders: "1" });

    const otherQuote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const otherPayment = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_refund_test",
      signedQuote: otherQuote,
      idempotencyKey: "prepare-refund-002",
    });
    if (otherPayment.status !== "reserved") throw new Error("Expected second policy-approved payment");
    const otherOrder = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: otherQuote,
      mandate: otherPayment.mandate,
      idempotencyKey: "commit-refund-002",
    });
    await expect(service.refundOrder({
      consumerId: "consumer_demo",
      orderId: otherOrder.orderId,
      idempotencyKey: "refund-full-001",
    })).rejects.toThrow("already used for another order");
  });

  it("rejects non-refundable, expired, and foreign refund attempts", async () => {
    const nonRefundable = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Final Sale Report",
      description: "A final-sale report that cannot be refunded.",
      priceMinor: "1000",
      fulfillmentMethod: "digital_download",
    });
    await service.delivery.upload("merchant_demo", { offerId: nonRefundable.offerId as string }, "final-report.txt", Buffer.from("The purchased final sale report"));
    const finalQuote = await service.createQuote("merchant_demo", nonRefundable.offerId as string, 1);
    const finalPayment = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_refund_rejection",
      signedQuote: finalQuote,
      idempotencyKey: "prepare-final-sale-001",
    });
    if (finalPayment.status !== "reserved") throw new Error("Expected final-sale payment to reserve");
    const finalOrder = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: finalQuote,
      mandate: finalPayment.mandate,
      idempotencyKey: "commit-final-sale-001",
    });
    await expect(service.refundOrder({
      consumerId: "consumer_demo",
      orderId: finalOrder.orderId,
      idempotencyKey: "refund-final-sale-001",
    })).rejects.toThrow("non-refundable");

    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const refundableQuote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const refundablePayment = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_refund_rejection",
      signedQuote: refundableQuote,
      idempotencyKey: "prepare-expiry-001",
    });
    if (refundablePayment.status !== "reserved") throw new Error("Expected refundable payment to reserve");
    const refundableOrder = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: refundableQuote,
      mandate: refundablePayment.mandate,
      idempotencyKey: "commit-expiry-001",
    });
    await pool.query("INSERT INTO consumers(id, display_name, status) VALUES ('consumer_other', 'Other Consumer', 'active')");
    await expect(service.refundOrder({
      consumerId: "consumer_other",
      orderId: refundableOrder.orderId,
      idempotencyKey: "refund-foreign-001",
    })).rejects.toThrow("Only the consumer");
    await pool.query("UPDATE orders SET refund_eligible_until = now() - interval '1 second' WHERE id = $1", [refundableOrder.orderId]);
    await expect(service.refundOrder({
      consumerId: "consumer_demo",
      orderId: refundableOrder.orderId,
      idempotencyKey: "refund-expired-001",
    })).rejects.toThrow("window has expired");
  });

  it("creates quotes for two merchants and settles each payment independently", async () => {
    const registered = await identity.registerMerchant({
      businessName: "Second Signal Studio",
      adminName: "Ada Merchant",
      email: "ada@secondsignal.test",
      password: "SecondSignal!2026",
    });
    const secondMerchantId = registered.merchant.merchantId;
    const demoOffer = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Atlas Comparison Quote",
      description: "A low-value quote used for multi-merchant payment testing.",
      priceMinor: "1000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 1440,
    });
    const secondOffer = await service.createMerchantOffer({
      merchantId: secondMerchantId,
      name: "Second Signal Comparison Quote",
      description: "A second independent quote used for comparison testing.",
      priceMinor: "2000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 1440,
    });
    const atlasQuote = await service.createQuote("merchant_demo", demoOffer.offerId as string, 1);
    const secondQuote = await service.createQuote(secondMerchantId, secondOffer.offerId as string, 1);
    expect(atlasQuote.payload.merchantId).toBe("merchant_demo");
    expect(secondQuote.payload.merchantId).toBe(secondMerchantId);
    expect(atlasQuote.hash).not.toBe(secondQuote.hash);

    const atlasPayment = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_multi_merchant",
      signedQuote: atlasQuote,
      idempotencyKey: "prepare-atlas-multi-001",
    });
    const secondPayment = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_multi_merchant",
      signedQuote: secondQuote,
      idempotencyKey: "prepare-second-multi-001",
    });
    if (atlasPayment.status !== "reserved" || secondPayment.status !== "reserved") {
      throw new Error("Expected both policy-approved payments to reserve immediately");
    }
    const atlasOrder = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: atlasQuote,
      mandate: atlasPayment.mandate,
      idempotencyKey: "commit-atlas-multi-001",
    });
    const secondReceipt = await service.commitOrder({
      merchantId: secondMerchantId,
      signedQuote: secondQuote,
      mandate: secondPayment.mandate,
      idempotencyKey: "commit-second-multi-001",
    });
    await service.delivery.upload("merchant_demo", { orderId: atlasOrder.orderId }, "result.txt", Buffer.from("Atlas service result"));
    await service.delivery.upload(secondMerchantId, { orderId: secondReceipt.orderId }, "result.txt", Buffer.from("Second merchant result"));
    await service.fulfillOrder({
      merchantId: "merchant_demo",
      orderId: atlasOrder.orderId,
      fulfillmentReference: "fulfillment_atlas_multi",
      idempotencyKey: "fulfill-atlas-multi-001",
    });
    await service.fulfillOrder({
      merchantId: secondMerchantId,
      orderId: secondReceipt.orderId,
      fulfillmentReference: "fulfillment_second_multi",
      idempotencyKey: "fulfill-second-multi-001",
    });

    const atlas = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string }; totals: { completedOrders: string } } };
    const second = await service.merchantDashboard(secondMerchantId) as { merchant: { balances: { payable: string }; totals: { completedOrders: string } } };
    expect(atlas.merchant.balances.payable).toBe("980");
    expect(second.merchant.balances.payable).toBe("1960");
    expect(atlas.merchant.totals.completedOrders).toBe("1");
    expect(second.merchant.totals.completedOrders).toBe("1");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "97000", reserved: "0" });

    await service.refundOrder({
      consumerId: "consumer_demo",
      orderId: secondReceipt.orderId,
      idempotencyKey: "refund-second-multi-001",
    });
    const atlasAfterRefund = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string } } };
    const secondAfterRefund = await service.merchantDashboard(secondMerchantId) as { merchant: { balances: { payable: string } } };
    expect(atlasAfterRefund.merchant.balances.payable).toBe("980");
    expect(secondAfterRefund.merchant.balances.payable).toBe("-40");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "99000", reserved: "0" });
  });

  it("cancels unused payment authority and releases reserved funds exactly once", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_cancel_test",
      signedQuote: quote,
      idempotencyKey: "prepare-cancel-payment-001",
    });
    if (prepared.status !== "reserved") throw new Error("Expected reserved payment");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "92500", reserved: "7500" });

    const first = await service.cancelPayment({
      consumerId: "consumer_demo",
      paymentId: prepared.paymentId,
      idempotencyKey: "cancel-payment-001",
      reason: "No longer needed",
    });
    const retry = await service.cancelPayment({
      consumerId: "consumer_demo",
      paymentId: prepared.paymentId,
      idempotencyKey: "cancel-payment-001",
    });
    expect(first).toMatchObject({ status: "cancelled", releasedAmountMinor: "7500" });
    expect(retry).toMatchObject({ status: "cancelled", releasedAmountMinor: "7500" });
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "100000", reserved: "0" });
  });

  it("keeps service revenue pending until fulfillment and fully reverses pre-fulfillment cancellation", async () => {
    const product = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Async Service",
      description: "A service requiring an explicit merchant fulfillment callback.",
      priceMinor: "2000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 1440,
    });
    const quote = await service.createQuote("merchant_demo", product.offerId as string, 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_async_test",
      signedQuote: quote,
      idempotencyKey: "prepare-async-cancel-001",
    });
    if (prepared.status !== "reserved") throw new Error("Expected reserved payment");
    const order = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: quote,
      mandate: prepared.mandate,
      idempotencyKey: "commit-async-cancel-001",
    });
    expect(order.status).toBe("confirmed");
    expect(order.receipt).toBeNull();
    const before = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { pendingFulfillment: string; payable: string } } };
    expect(before.merchant.balances).toMatchObject({ pendingFulfillment: "1960", payable: "0" });

    const cancelled = await service.cancelOrder({
      consumerId: "consumer_demo",
      orderId: order.orderId,
      idempotencyKey: "cancel-async-order-001",
      reason: "Merchant has not started work",
    });
    expect(cancelled.status).toBe("cancelled");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "100000", reserved: "0" });
    const after = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { pendingFulfillment: string; payable: string } } };
    expect(after.merchant.balances).toMatchObject({ pendingFulfillment: "0", payable: "0" });
    const fee = await pool.query<{ balance: string }>(
      "SELECT COALESCE(sum(l.amount_minor), 0)::text AS balance FROM journal_lines l WHERE l.account_id = 'acct_platform_fee'",
    );
    expect(fee.rows[0]?.balance).toBe("0");
  });

  it("expires reservations and timed-out fulfillment through the lifecycle worker", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const expiringQuote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const expiringPayment = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_expiry_test",
      signedQuote: expiringQuote,
      idempotencyKey: "prepare-expiring-payment-001",
    });
    await pool.query("UPDATE payment_intents SET expires_at = now() - interval '1 second' WHERE id = $1", [expiringPayment.paymentId]);
    const firstRun = await service.processExpirations();
    expect(firstRun).toMatchObject({ paymentsExpired: 1, reservationsReleased: 1 });
    expect((await service.paymentStatus(expiringPayment.paymentId, "consumer_demo")).status).toBe("expired");

    const serviceProduct = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Timeout Service",
      description: "A service used to verify fulfillment timeout compensation.",
      priceMinor: "1000",
      fulfillmentMethod: "digital_service",
    });
    const quote = await service.createQuote("merchant_demo", serviceProduct.offerId as string, 1);
    const prepared = await service.preparePayment({
      consumerId: "consumer_demo",
      agentClientId: "agent_expiry_test",
      signedQuote: quote,
      idempotencyKey: "prepare-timeout-order-001",
    });
    if (prepared.status !== "reserved") throw new Error("Expected reserved payment");
    const order = await service.commitOrder({ merchantId: "merchant_demo", signedQuote: quote, mandate: prepared.mandate, idempotencyKey: "commit-timeout-order-001" });
    await pool.query("UPDATE orders SET fulfillment_deadline = now() - interval '1 second' WHERE id = $1", [order.orderId]);
    const secondRun = await service.processExpirations();
    expect(secondRun.ordersCancelled).toBe(1);
    expect((await service.getOrder("merchant_demo", order.orderId)).status).toBe("cancelled");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "100000", reserved: "0" });
  });

  it("creates reserve-backed payouts, reconciles the ledger, and surfaces pilot operations", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
    const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
    const prepared = await service.preparePayment({ consumerId: "consumer_demo", agentClientId: "agent_payout_test", signedQuote: quote, idempotencyKey: "prepare-payout-001" });
    if (prepared.status !== "reserved") throw new Error("Expected reserved payment");
    const order = await service.commitOrder({ merchantId: "merchant_demo", signedQuote: quote, mandate: prepared.mandate, idempotencyKey: "commit-payout-001" });

    await service.setPayoutEmail("merchant_demo", "merchant-paypal@example.com");
    paypal.payoutStatus = "PENDING";
    const payout = await service.createPayout({ merchantId: "merchant_demo", idempotencyKey: "payout-batch-001" });
    expect(payout).toMatchObject({ sourcePayableMinor: "7350", reserveHeldMinor: "735", paidAmountMinor: "6615", status: "pending" });
    const payoutRetry = await service.createPayout({ merchantId: "merchant_demo", idempotencyKey: "payout-batch-001" });
    expect(payoutRetry.payoutId).toBe(payout.payoutId);
    paypal.payoutStatus = "SUCCESS";
    expect(await service.payoutStatus("merchant_demo", payout.payoutId as string)).toMatchObject({ status: "paid" });
    expect(await service.reconciliationReport("merchant_demo")).toMatchObject({ differenceMinor: "0", reconciled: true });

    await service.refundOrder({ consumerId: "consumer_demo", orderId: order.orderId, idempotencyKey: "refund-after-payout-001" });
    const dashboard = await service.merchantDashboard("merchant_demo") as {
      merchant: { balances: { payable: string; reserve: string } };
      metrics: { funnel: { orders: string; refundedOrders: string }; operations: { payouts: string } };
    };
    expect(dashboard.merchant.balances).toMatchObject({ payable: "-6765", reserve: "0" });
    expect(dashboard.metrics.funnel).toMatchObject({ orders: "1", refundedOrders: "1" });
    expect(dashboard.metrics.operations.payouts).toBe("1");
    expect(await service.reconciliationReport("merchant_demo", true)).toMatchObject({ differenceMinor: "0", reconciled: true });
    expect(await service.processOutbox()).toMatchObject({ delivered: 4, dead: 0 });
    expect((await service.merchantAuditExport("merchant_demo")).length).toBeGreaterThan(0);
  });

  it("delivers durable merchant events with a verifiable HMAC signature", async () => {
    const deliveries: Array<{ body: string; timestamp: string; signature: string }> = [];
    const webhookServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        deliveries.push({
          body: Buffer.concat(chunks).toString("utf8"),
          timestamp: String(request.headers["x-payl-timestamp"] ?? ""),
          signature: String(request.headers["x-payl-signature"] ?? ""),
        });
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
    try {
      const address = webhookServer.address();
      if (!address || typeof address === "string") throw new Error("Webhook test server did not bind a TCP port");
      const configured = await service.configureMerchantWebhook({ merchantId: "merchant_demo", url: `http://127.0.0.1:${address.port}/payl` });
      const quote = await service.createQuote("merchant_demo", "offer_research_pack", 1);
      await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 10000 WHERE consumer_id = 'consumer_demo'");
      const prepared = await service.preparePayment({ consumerId: "consumer_demo", agentClientId: "agent_webhook_test", signedQuote: quote, idempotencyKey: "prepare-webhook-001" });
      if (prepared.status !== "reserved") throw new Error("Expected reserved payment");
      await service.commitOrder({ merchantId: "merchant_demo", signedQuote: quote, mandate: prepared.mandate, idempotencyKey: "commit-webhook-001" });

      expect(await service.processOutbox(2)).toMatchObject({ delivered: 2, retried: 0, dead: 0 });
      expect(deliveries).toHaveLength(2);
      for (const delivery of deliveries) {
        const expected = `v1=${createHmac("sha256", String(configured.signingSecret)).update(`${delivery.timestamp}.${delivery.body}`).digest("hex")}`;
        expect(delivery.signature).toBe(expected);
        expect(JSON.parse(delivery.body)).toMatchObject({ id: expect.any(String), type: expect.any(String), data: { merchantId: "merchant_demo" } });
      }
    } finally {
      await new Promise<void>((resolve, reject) => webhookServer.close((error) => error ? reject(error) : resolve()));
    }
  });
});
