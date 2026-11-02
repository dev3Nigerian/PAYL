import type pg from "pg";

// Stable historical products for payment/approval regression scenarios. These
// are test fixtures only; application startup installs the versioned catalog.
export async function seedLegacyCatalogFixture(pool: pg.Pool, merchantId: string) {
  await pool.query(
    `INSERT INTO offers(id, merchant_id, name, description, price_minor, currency, fulfillment_method, refundable, refund_window_minutes)
     VALUES
       ('offer_research_pack', $1, 'Market Research Pack', 'A fixed-scope digital research brief delivered immediately.', 7500, 'USD', 'digital_download', true, 10080),
       ('offer_brand_review', $1, 'AI Brand Review', 'A deterministic ten-point brand review delivered as a PDF.', 12500, 'USD', 'digital_service', true, 10080)`,
    [merchantId],
  );
  await pool.query(
    `INSERT INTO delivery_assets(id, merchant_id, file_name, content_type, contents)
     VALUES ('asset_sandbox_research', $1, 'market-research-sample.txt', 'text/plain', $2)`,
    [merchantId, Buffer.from("PAYL SANDBOX SAMPLE: Market research worksheet\n\nThis is a demonstration deliverable, not commissioned market research.\n\n1. Define your customer: role, location, buying trigger.\n2. List three alternatives and compare price, delivery time, and refunds.\n3. Interview five customers about their last purchase.\n4. Record evidence and source dates for every market claim.\n5. Test one offer with a fixed budget and measure completed purchases.\n\nDecision worksheet\nCustomer segment: __________\nProblem observed: __________\nEvidence and date: __________\nAlternatives: __________\nPrice hypothesis: __________\nNext experiment: __________\n")],
  );
  await pool.query("UPDATE offers SET delivery_asset_id = 'asset_sandbox_research' WHERE id = 'offer_research_pack'", []);
}
