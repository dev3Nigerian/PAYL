import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";
import { IdentityService } from "../src/identity.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  APPROVAL_WEB_URL: "http://localhost:3000",
  PAYL_ISSUER: "https://sandbox.payl.local",
  PAYL_DEV_KEYS: "true",
  SANDBOX_CONSUMER_ID: "consumer_demo",
  SANDBOX_MERCHANT_ID: "merchant_demo",
});
const pool = createPool(config);
const service = new PaylService(pool, config);
const identity = new IdentityService(pool, config);

beforeAll(async () => {
  await migrate(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE
       oauth_revoked_access_tokens, oauth_refresh_tokens, oauth_grants, oauth_authorization_codes,
       oauth_consent_requests, oauth_clients, auth_sessions, auth_users,
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
    expect(beforeApproval.balances).toEqual({ available: "10000000", reserved: "0" });

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
    expect(receipt.payload.capturedAmountMinor).toBe("750000");
    expect(receipt.payload.fulfillmentStatus).toBe("fulfilled");

    const duplicate = await service.commitOrder({
      merchantId: "merchant_demo",
      signedQuote: quote,
      mandate: authorized.mandate as never,
      idempotencyKey: "commit-human-retry-002",
    });
    expect(duplicate.payload.orderId).toBe(receipt.payload.orderId);

    const state = await service.demoState();
    expect(state.ledger).toEqual({ entries: "3", unbalanced_entries: "0" });
    expect((state.wallet as { balances: unknown }).balances).toEqual({ available: "9250000", reserved: "0" });

    const merchant = await pool.query<{ balance: string }>(
      `SELECT COALESCE(sum(l.amount_minor), 0)::text AS balance
       FROM journal_lines l WHERE l.account_id = 'acct_merchant_payable'`,
    );
    expect(merchant.rows[0]?.balance).toBe("735000");
  });

  it("auto-authorizes only within the configured policy", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 1000000 WHERE consumer_id = 'consumer_demo'");
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
      autoApproveLimitMinor: "250000",
      perTransactionLimitMinor: "3000000",
      dailyLimitMinor: "8000000",
    });
    expect(updated).toMatchObject({
      version: 2,
      autoApproveLimitMinor: "250000",
      perTransactionLimitMinor: "3000000",
      dailyLimitMinor: "8000000",
    });
    await expect(service.updateWalletPolicy({
      consumerId: "consumer_demo",
      expectedVersion: 1,
      autoApproveLimitMinor: "250000",
      perTransactionLimitMinor: "3000000",
      dailyLimitMinor: "8000000",
    })).rejects.toThrow("Policy changed in another session");
  });

  it("lets a merchant create and deactivate products exposed through MCP search", async () => {
    const product = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Campaign Audit",
      description: "A structured audit of one digital campaign.",
      priceMinor: "2200000",
      fulfillmentMethod: "digital_service",
    });
    expect(product).toMatchObject({ name: "Campaign Audit", active: true, priceMinor: "2200000" });
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
      priceMinor: "150000",
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
      priceMinor: "100000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 90,
    })).rejects.toThrow("whole number of hours");
  });

  it("refunds the consumer in full while retaining PAYL's fee from the merchant", async () => {
    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 1000000 WHERE consumer_id = 'consumer_demo'");
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
      service.refundOrder({ consumerId: "consumer_demo", orderId: order.payload.orderId, idempotencyKey: "refund-full-001", reason: "Not needed" }),
      service.refundOrder({ consumerId: "consumer_demo", orderId: order.payload.orderId, idempotencyKey: "refund-full-001", reason: "Not needed" }),
    ]);
    expect(refund.payload).toMatchObject({
      orderId: order.payload.orderId,
      refundedAmountMinor: "750000",
      retainedFeeMinor: "15000",
      status: "refunded",
    });
    expect(retry.payload.refundId).toBe(refund.payload.refundId);
    const secondRetry = await service.refundOrder({
      consumerId: "consumer_demo",
      orderId: order.payload.orderId,
      idempotencyKey: "refund-full-retry-002",
    });
    expect(secondRetry.payload.refundId).toBe(refund.payload.refundId);

    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "10000000", reserved: "0" });
    const balances = await pool.query<{ account_type: string; balance: string }>(
      `SELECT a.account_type, COALESCE(sum(l.amount_minor), 0)::text AS balance
       FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
       WHERE a.id IN ('acct_merchant_payable', 'acct_platform_fee')
       GROUP BY a.id, a.account_type ORDER BY a.account_type`,
    );
    expect(Object.fromEntries(balances.rows.map((row) => [row.account_type, row.balance]))).toEqual({
      fee_revenue: "15000",
      payable: "-15000",
    });
    const lifecycle = await pool.query<{ order_status: string; payment_status: string }>(
      `SELECT o.status AS order_status, p.status AS payment_status
       FROM orders o JOIN payment_intents p ON p.id = o.payment_id WHERE o.id = $1`,
      [order.payload.orderId],
    );
    expect(lifecycle.rows[0]).toEqual({ order_status: "refunded", payment_status: "refunded" });
    const state = await service.demoState() as {
      ledger: { entries: string; unbalanced_entries: string };
      merchant: { totals: { netSalesMinor: string; retainedRefundFeesMinor: string; refundedOrders: string } };
    };
    expect(state.ledger).toEqual({ entries: "4", unbalanced_entries: "0" });
    expect(state.merchant.totals).toMatchObject({ netSalesMinor: "-15000", retainedRefundFeesMinor: "15000", refundedOrders: "1" });

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
      orderId: otherOrder.payload.orderId,
      idempotencyKey: "refund-full-001",
    })).rejects.toThrow("already used for another order");
  });

  it("rejects non-refundable, expired, and foreign refund attempts", async () => {
    const nonRefundable = await service.createMerchantOffer({
      merchantId: "merchant_demo",
      name: "Final Sale Report",
      description: "A final-sale report that cannot be refunded.",
      priceMinor: "100000",
      fulfillmentMethod: "digital_download",
    });
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
      orderId: finalOrder.payload.orderId,
      idempotencyKey: "refund-final-sale-001",
    })).rejects.toThrow("non-refundable");

    await pool.query("UPDATE spending_policies SET auto_approve_limit_minor = 1000000 WHERE consumer_id = 'consumer_demo'");
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
      orderId: refundableOrder.payload.orderId,
      idempotencyKey: "refund-foreign-001",
    })).rejects.toThrow("Only the consumer");
    await pool.query("UPDATE orders SET refund_eligible_until = now() - interval '1 second' WHERE id = $1", [refundableOrder.payload.orderId]);
    await expect(service.refundOrder({
      consumerId: "consumer_demo",
      orderId: refundableOrder.payload.orderId,
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
      priceMinor: "100000",
      fulfillmentMethod: "digital_service",
      refundable: true,
      refundWindowMinutes: 1440,
    });
    const secondOffer = await service.createMerchantOffer({
      merchantId: secondMerchantId,
      name: "Second Signal Comparison Quote",
      description: "A second independent quote used for comparison testing.",
      priceMinor: "200000",
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
    await service.commitOrder({
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

    const atlas = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string }; totals: { completedOrders: string } } };
    const second = await service.merchantDashboard(secondMerchantId) as { merchant: { balances: { payable: string }; totals: { completedOrders: string } } };
    expect(atlas.merchant.balances.payable).toBe("98000");
    expect(second.merchant.balances.payable).toBe("196000");
    expect(atlas.merchant.totals.completedOrders).toBe("1");
    expect(second.merchant.totals.completedOrders).toBe("1");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "9700000", reserved: "0" });

    await service.refundOrder({
      consumerId: "consumer_demo",
      orderId: secondReceipt.payload.orderId,
      idempotencyKey: "refund-second-multi-001",
    });
    const atlasAfterRefund = await service.merchantDashboard("merchant_demo") as { merchant: { balances: { payable: string } } };
    const secondAfterRefund = await service.merchantDashboard(secondMerchantId) as { merchant: { balances: { payable: string } } };
    expect(atlasAfterRefund.merchant.balances.payable).toBe("98000");
    expect(secondAfterRefund.merchant.balances.payable).toBe("-4000");
    expect((await service.walletSummary("consumer_demo")).balances).toEqual({ available: "9900000", reserved: "0" });
  });
});
