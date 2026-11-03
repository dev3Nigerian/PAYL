import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PaymentMandateSchema } from "@payl/contracts";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { PaylService } from "../src/service.js";
import { IdentityService } from "../src/identity.js";
import { SAMPLE_CATALOG_VERSION } from "../src/sample-catalog.js";
import { sampleMerchants } from "../src/sample-products.js";
import { seedLegacyCatalogFixture } from "./legacy-catalog-fixture.js";

const config = loadConfig({ ...process.env, NODE_ENV: "test", PAYL_DEPLOYMENT_PROFILE: "local_sandbox", PAYL_DEV_KEYS: "true",
  DATABASE_URL: process.env.PAYL_TEST_DATABASE_URL ?? "postgresql://payl:payl_test_only@localhost:54330/payl_test",
  SANDBOX_CONSUMER_ID: "consumer_demo", SANDBOX_MERCHANT_ID: "merchant_demo", DEEPSEEK_API_KEY: "" });
const pool = createPool(config);
const service = new PaylService(pool, config, null);
const identity = new IdentityService(pool, config);

beforeAll(async () => { await migrate(pool); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE consumers, merchants, ledger_accounts, journal_entries, audit_events,
    outbox_events, reconciliation_reports RESTART IDENTITY CASCADE`);
  await service.seedSandbox();
  await seedLegacyCatalogFixture(pool, config.sandboxMerchantId);
});
afterAll(async () => { await pool.end(); });

async function buy(merchantId: string, offerId: string, consumerId = config.sandboxConsumerId) {
  const signedQuote = await service.createQuote(merchantId, offerId, 1);
  const prepared = await service.preparePayment({ consumerId, agentClientId: "agent_reference", signedQuote, idempotencyKey: randomUUID() });
  if (prepared.status === "pending_approval") await service.decideApproval(prepared.approvalId, consumerId, "approve");
  const authorized = await service.paymentStatus(prepared.paymentId, consumerId);
  return service.commitOrder({ merchantId, signedQuote, mandate: PaymentMandateSchema.parse(authorized.mandate), idempotencyKey: randomUUID() });
}

describe("versioned sample digital marketplace", () => {
  it("retires existing listings across merchants and installs 18 deliverable products without changing balances", async () => {
    const other = await identity.registerMerchant({ businessName: "Previous Shop", adminName: "Previous Admin", email: "previous@example.test", password: "PreviousMerchant!2026" });
    const previous = await service.createMerchantOffer({ merchantId: other.merchant.merchantId, name: "Previous listing", description: "An existing listing to replace.", priceMinor: "1000", fulfillmentMethod: "digital_download" });
    const walletBefore = (await service.walletSummary(config.sandboxConsumerId)).balances;
    expect(await service.seedSampleCatalog()).toMatchObject({ applied: true, merchants: 6, offers: 18, retiredOffers: 3 });
    expect((await service.walletSummary(config.sandboxConsumerId)).balances).toEqual(walletBefore);
    expect((await pool.query("SELECT id FROM journal_entries")).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM offers WHERE archived_at IS NOT NULL AND active = false")).rowCount).toBe(3);
    expect(await service.listMerchantOffers(other.merchant.merchantId)).toEqual([]);
    expect(await service.searchOffers(other.merchant.merchantId)).toEqual([]);
    expect(await service.searchMarketplaceOffers({ query: "Previous listing" })).toEqual([]);
    await expect(service.getOffer(other.merchant.merchantId, String(previous.offerId))).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });

    const offers = await service.searchMarketplaceOffers({});
    expect(offers).toHaveLength(18);
    expect(new Set(offers.map((offer) => offer.merchantId)).size).toBe(6);
    expect(offers.every((offer) => offer.currency === "USD" && offer.fulfillmentMethod === "digital_download" && offer.refundable)).toBe(true);
    expect(offers.some((offer) => BigInt(String(offer.priceMinor)) > 5000n)).toBe(true);
    expect(offers.every((offer) => BigInt(String(offer.priceMinor)) < 10000n)).toBe(true);
    expect((await service.listMerchantOffers(config.sandboxMerchantId))).toHaveLength(3);
    const assets = await pool.query("SELECT a.file_name, a.contents FROM offers o JOIN delivery_assets a ON a.id = o.delivery_asset_id WHERE o.active = true");
    expect(assets.rows).toHaveLength(18);
    for (const asset of assets.rows) {
      expect(asset.file_name).toMatch(/\.zip$/);
      expect(asset.contents.readUInt32LE(0)).toBe(0x04034b50);
      expect(asset.contents.toString("utf8")).toContain("README.md");
      expect(asset.contents.toString("utf8")).toContain("Sandbox sample");
    }
    expect((await pool.query("SELECT * FROM sandbox_catalog_revisions WHERE version = $1", [SAMPLE_CATALOG_VERSION])).rows[0]?.retired_offer_ids).toContain(previous.offerId);
  });

  it("does not overwrite later catalog edits, new products, or accounts when startup repeats", async () => {
    await service.seedSampleCatalog();
    await service.setMerchantOfferActive(config.sandboxMerchantId, "offer_sample_customer_interview_workbook", false);
    const custom = await service.createMerchantOffer({ merchantId: config.sandboxMerchantId, name: "New custom product", description: "Added after the sample refresh.", priceMinor: "1000", fulfillmentMethod: "digital_download" });
    const before = (await pool.query("SELECT count(*) AS count FROM delivery_assets")).rows[0]?.count;
    await service.seedSandbox();
    const result = await service.seedSampleCatalog();
    expect(result.applied).toBe(false);
    expect((await service.searchMarketplaceOffers({})).some((offer) => offer.offerId === custom.offerId)).toBe(true);
    expect(await service.searchMarketplaceOffers({ query: "Customer Interview Workbook" })).toEqual([]);
    expect((await pool.query("SELECT count(*) AS count FROM delivery_assets")).rows[0]?.count).toBe(before);
    expect((await pool.query("SELECT * FROM sandbox_catalog_revisions")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM audit_events WHERE event_type = 'sandbox.catalog_refreshed'")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM journal_entries")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM offers WHERE id IN ('offer_research_pack', 'offer_brand_review') AND active = true")).rowCount).toBe(0);
  });

  it("applies once when two instances start together", async () => {
    const results = await Promise.all([service.seedSampleCatalog(), service.seedSampleCatalog()]);
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(await service.searchMarketplaceOffers({})).toHaveLength(18);
    expect((await pool.query("SELECT * FROM sandbox_catalog_revisions")).rowCount).toBe(1);
  });

  it("rolls back retirement and new assets if catalog insertion fails, then retries cleanly", async () => {
    await pool.query(`CREATE FUNCTION test_reject_sample_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = 'offer_sample_minimal_portfolio_template' THEN RAISE EXCEPTION 'catalog insert failed'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_sample_catalog BEFORE INSERT ON offers FOR EACH ROW EXECUTE FUNCTION test_reject_sample_catalog();`);
    try {
      await expect(service.seedSampleCatalog()).rejects.toThrow("catalog insert failed");
      expect(await service.searchMarketplaceOffers({})).toHaveLength(2);
      expect((await pool.query("SELECT * FROM offers WHERE archived_at IS NOT NULL")).rowCount).toBe(0);
      expect((await pool.query("SELECT * FROM delivery_assets WHERE id LIKE 'asset_sample_%'")).rowCount).toBe(0);
      expect((await pool.query("SELECT * FROM merchants WHERE id LIKE 'merchant_sample_%'")).rowCount).toBe(0);
      expect((await pool.query("SELECT * FROM sandbox_catalog_revisions")).rowCount).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER test_reject_sample_catalog ON offers; DROP FUNCTION test_reject_sample_catalog()");
    }
    expect((await service.seedSampleCatalog()).applied).toBe(true);
    expect(await service.searchMarketplaceOffers({})).toHaveLength(18);
  });

  it("preserves historical downloads, pending fulfillment, and refunds after removing the listings", async () => {
    const downloaded = await buy(config.sandboxMerchantId, "offer_research_pack");
    const pending = await buy(config.sandboxMerchantId, "offer_brand_review");
    const original = await service.delivery.download(config.sandboxConsumerId, downloaded.orderId);
    const before = (await service.walletSummary(config.sandboxConsumerId)).balances;
    await service.seedSampleCatalog();
    expect((await service.walletSummary(config.sandboxConsumerId)).balances).toEqual(before);
    expect((await service.delivery.orders(config.sandboxConsumerId, downloaded.orderId))[0]).toMatchObject({ offerName: "Market Research Pack", status: "fulfilled" });
    expect((await service.delivery.download(config.sandboxConsumerId, downloaded.orderId)).contents).toEqual(original.contents);
    await expect(service.createQuote(config.sandboxMerchantId, "offer_research_pack", 1)).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
    await expect(service.setMerchantOfferActive(config.sandboxMerchantId, "offer_research_pack", true)).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
    await expect(service.delivery.upload(config.sandboxMerchantId, { offerId: "offer_research_pack" }, "replacement.txt", Buffer.from("replacement"))).rejects.toMatchObject({ code: "DELIVERY_TARGET_NOT_FOUND" });

    await service.delivery.upload(config.sandboxMerchantId, { orderId: pending.orderId }, "completed-review.txt", Buffer.from("Historical service result"));
    await service.fulfillOrder({ merchantId: config.sandboxMerchantId, orderId: pending.orderId, fulfillmentReference: "completed", idempotencyKey: "complete-old-service" });
    expect((await service.delivery.orders(config.sandboxConsumerId, pending.orderId))[0]?.status).toBe("fulfilled");
    await service.refundOrder({ consumerId: config.sandboxConsumerId, orderId: downloaded.orderId, idempotencyKey: "refund-old-download" });
    expect((await service.delivery.orders(config.sandboxConsumerId, downloaded.orderId))[0]?.status).toBe("refunded");
    expect(await service.reconciliationReport(config.sandboxMerchantId)).toMatchObject({ reconciled: true });
  });

  it("purchases and delivers every sample through the normal signed-quote and balanced-ledger flow", async () => {
    await service.seedSampleCatalog();
    for (const merchant of sampleMerchants(config.sandboxMerchantId)) {
      for (const product of merchant.products) {
        const order = await buy(merchant.id, `offer_sample_${product.slug}`);
        expect(order.receipt?.payload.fulfillmentStatus).toBe("fulfilled");
        const download = await service.delivery.download(config.sandboxConsumerId, order.orderId);
        expect(download.content_type).toBe("application/zip");
        expect(download.contents.toString("utf8")).toContain(product.name);
        expect(download.file_name).toBe(`${product.slug.replaceAll("_", "-")}.zip`);
      }
      expect(await service.reconciliationReport(merchant.id)).toMatchObject({ reconciled: true });
    }
    expect((await pool.query("SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(amount_minor) <> 0")).rowCount).toBe(0);
    expect((await pool.query("SELECT * FROM wallet_topups")).rowCount).toBe(0);
  }, 60_000);

  it("lets a newly registered consumer shop across sample merchants using the $100 grant", async () => {
    await service.seedSampleCatalog();
    const shopper = await identity.registerConsumer({ displayName: "Sample Shopper", email: "sample-shopper@example.test", password: "SampleShopper!2026" });
    const consumerId = shopper.session.consumerId!;
    const planner = await buy("merchant_sample_papertrail", "offer_sample_weekly_focus_planner", consumerId);
    const portfolio = await buy("merchant_sample_pixel_pine", "offer_sample_minimal_portfolio_template", consumerId);
    expect(planner.receipt?.payload.fulfillmentStatus).toBe("fulfilled");
    expect(portfolio.receipt?.payload.fulfillmentStatus).toBe("fulfilled");
    expect((await service.walletSummary(consumerId)).balances).toEqual({ available: "6700", reserved: "0" });
    await expect(service.delivery.download(config.sandboxConsumerId, planner.orderId)).rejects.toMatchObject({ code: "DELIVERY_NOT_AVAILABLE" });
    await service.refundOrder({ consumerId, orderId: planner.orderId, idempotencyKey: "sample-planner-refund" });
    expect((await service.walletSummary(consumerId)).balances).toEqual({ available: "7600", reserved: "0" });
    expect(await service.reconciliationReport("merchant_sample_papertrail")).toMatchObject({ reconciled: true });
  });
});
