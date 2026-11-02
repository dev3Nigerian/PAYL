import type pg from "pg";
import { inTransaction } from "./db.js";
import { sampleArchive } from "./sample-archive.js";
import { sampleMerchants } from "./sample-products.js";

export const SAMPLE_CATALOG_VERSION = "digital-marketplace-2026-11-v1";

export async function seedSampleCatalog(pool: pg.Pool, bootstrapMerchantId: string, signingKeyId: (merchantId: string) => string) {
  return inTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["payl:sample-catalog"]);
    if ((await client.query("SELECT 1 FROM sandbox_catalog_revisions WHERE version = $1", [SAMPLE_CATALOG_VERSION])).rowCount) {
      return { applied: false, version: SAMPLE_CATALOG_VERSION };
    }
    // Also serialize with product writes from an older instance during deploy.
    await client.query("LOCK TABLE offers IN SHARE ROW EXCLUSIVE MODE");
    const retired = await client.query<{ id: string }>(
      "UPDATE offers SET active = false, archived_at = now() WHERE archived_at IS NULL RETURNING id",
    );
    const catalog = sampleMerchants(bootstrapMerchantId);
    let offerCount = 0;
    for (const merchant of catalog) {
      await client.query(
        `INSERT INTO merchants(id, name, server_id, currency, signing_key_id, status)
         VALUES ($1, $2, $3, 'USD', $4, 'active') ON CONFLICT (id) DO NOTHING`,
        [merchant.id, merchant.name, `server_${merchant.id}`, signingKeyId(merchant.id)],
      );
      // Preserve the configured demo merchant's existing accounts and balances.
      for (const accountType of ["payable", "pending_payable", "reserve", "payout_pending"]) {
        await client.query(
          `INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
           VALUES ($1, 'merchant', $2, $3, 'USD')
           ON CONFLICT (owner_type, owner_id, account_type, currency) DO NOTHING`,
          [`acct_${merchant.id}_${accountType}`, merchant.id, accountType],
        );
      }
      await client.query("INSERT INTO merchant_settlement_configs(merchant_id) VALUES ($1) ON CONFLICT (merchant_id) DO NOTHING", [merchant.id]);
      for (const product of merchant.products) {
        const offerId = `offer_sample_${product.slug}`;
        const assetId = `asset_sample_${product.slug}`;
        const contents = sampleArchive({
          "README.md": `# ${product.name}\n\n${product.description}\n\n## Getting started\n${product.instructions}\n\n## Sandbox sample\nThis original demonstration product is supplied by a fictional Antspace sample merchant.\nYou may edit and reuse these sample files in your own projects.\nPurchases use virtual USD only. No external account, subscription, or paid license is included.\n`,
          ...product.files,
        });
        await client.query(
          "INSERT INTO delivery_assets(id, merchant_id, file_name, content_type, contents) VALUES ($1, $2, $3, 'application/zip', $4)",
          [assetId, merchant.id, `${product.slug.replaceAll("_", "-")}.zip`, contents],
        );
        await client.query(
          `INSERT INTO offers(id, merchant_id, name, description, price_minor, currency, fulfillment_method,
             refundable, refund_window_minutes, delivery_asset_id, active)
           VALUES ($1, $2, $3, $4, $5, 'USD', 'digital_download', true, 10080, $6, true)`,
          [offerId, merchant.id, product.name, `${product.description} Sandbox sample; instant ZIP download.`, product.priceMinor, assetId],
        );
        offerCount++;
      }
    }
    await client.query(
      `INSERT INTO sandbox_catalog_revisions(version, bootstrap_merchant_id, retired_offer_ids, merchant_count, offer_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [SAMPLE_CATALOG_VERSION, bootstrapMerchantId, retired.rows.map((row) => row.id), catalog.length, offerCount],
    );
    await client.query(
      `INSERT INTO audit_events(correlation_id, actor_type, actor_id, event_type, object_type, object_id, metadata)
       VALUES ($1, 'system', 'sandbox_seed', 'sandbox.catalog_refreshed', 'catalog', $1, $2::jsonb)`,
      [SAMPLE_CATALOG_VERSION, JSON.stringify({ retiredOffers: retired.rowCount, merchants: catalog.length, offers: offerCount })],
    );
    return { applied: true, version: SAMPLE_CATALOG_VERSION, retiredOffers: retired.rowCount, merchants: catalog.length, offers: offerCount };
  });
}
