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
    });
    const secondOffer = await service.createMerchantOffer({
      merchantId: secondMerchantId,
      name: "Second Signal Comparison Quote",
      description: "A second independent quote used for comparison testing.",
      priceMinor: "200000",
      fulfillmentMethod: "digital_service",
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
    await service.commitOrder({
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
  });
});
