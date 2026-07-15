import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://payl:payl_dev_only@localhost:54329/payl",
  APPROVAL_WEB_URL: "http://localhost:3000",
  PAYL_ISSUER: "https://sandbox.payl.local",
  PAYL_DEV_KEYS: "true",
  SANDBOX_CONSUMER_ID: "consumer_demo",
  SANDBOX_MERCHANT_ID: "merchant_demo",
});
const pool = createPool(config);
const service = new PaylService(pool, config);

beforeAll(async () => {
  await migrate(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE
       audit_events, orders, payment_mandates, approval_challenges, payment_intents, quotes,
       journal_lines, journal_entries, ledger_accounts, spending_policies, offers, consumers, merchants
     RESTART IDENTITY CASCADE`,
  );
  await service.seedSandbox();
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
});
