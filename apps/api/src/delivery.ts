import { randomUUID } from "node:crypto";
import type pg from "pg";
import { inTransaction } from "./db.js";
import { DomainError, requireValue } from "./errors.js";

export type ConsumerOrder = {
  orderId: string; offerName: string; merchantName: string; status: string;
  amountMinor: string; currency: string; createdAt: string;
  fulfillmentDeadline: string | null; refundEligibleUntil: string | null;
  canCancel: boolean; canRefund: boolean;
  delivery: { fileName: string; downloadUrl: string } | null;
  serviceIntakePrompt: string | null; serviceDetails: string | null;
};

export type ConsumerDownload = {
  orderId: string; offerName: string; merchantName: string;
  purchasedAt: string; fulfilledAt: string | null; fileName: string; sizeBytes: number;
};

const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
};

export class DeliveryService {
  constructor(private readonly pool: pg.Pool) {}

  // Files stay in durable Postgres storage; no dependency on an ephemeral web-service disk.
  async upload(merchantId: string, target: { offerId: string } | { orderId: string }, fileName: unknown, contents: unknown) {
    const name = typeof fileName === "string" ? fileName.trim() : "";
    const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
    const contentType = Object.hasOwn(FILE_TYPES, extension) ? FILE_TYPES[extension] : undefined;
    if (!/^[\w .()-]{1,120}$/.test(name) || !contentType) {
      throw new DomainError("INVALID_DELIVERY_FILE", "Use a PDF, TXT, MD, CSV, ZIP, PNG, or JPG file with a simple filename (up to 120 characters)");
    }
    if (!Buffer.isBuffer(contents) || contents.length < 1 || contents.length > 5 * 1024 * 1024) {
      throw new DomainError("INVALID_DELIVERY_FILE", "Delivery files must be between 1 byte and 5 MB");
    }
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`delivery-storage:${merchantId}`]);
      const offerTarget = "offerId" in target;
      const targetId = offerTarget ? target.offerId : target.orderId;
      const table = offerTarget ? "offers" : "orders";
      const row = requireValue((await client.query<{ status?: string; fulfillment_method?: string }>(
        `SELECT * FROM ${table} WHERE id = $1 AND merchant_id = $2 ${offerTarget ? "AND archived_at IS NULL" : ""} FOR UPDATE`, [targetId, merchantId],
      )).rows[0], "DELIVERY_TARGET_NOT_FOUND", "Product or order was not found");
      if (offerTarget && row.fulfillment_method !== "digital_download") {
        throw new DomainError("INVALID_DELIVERY_TARGET", "Attach service results to an individual order");
      }
      if (!offerTarget && !["confirmed", "fulfillment_failed"].includes(row.status ?? "")) {
        throw new DomainError("ORDER_DELIVERY_LOCKED", "Delivery cannot be changed after fulfillment, cancellation, or refund", 409);
      }
      const usage = (await client.query<{ bytes: string }>(
        "SELECT COALESCE(sum(octet_length(contents)), 0)::text AS bytes FROM delivery_assets WHERE merchant_id = $1", [merchantId],
      )).rows[0]!;
      if (Number(usage.bytes) + contents.length > 100 * 1024 * 1024) {
        throw new DomainError("DELIVERY_STORAGE_FULL", "This sandbox merchant has reached its 100 MB delivery storage limit", 409);
      }
      const assetId = `asset_${randomUUID()}`;
      await client.query("INSERT INTO delivery_assets(id, merchant_id, file_name, content_type, contents) VALUES ($1, $2, $3, $4, $5)",
        [assetId, merchantId, name, contentType, contents]);
      await client.query(`UPDATE ${table} SET delivery_asset_id = $2 WHERE id = $1`, [targetId, assetId]);
      return { fileName: name, sizeBytes: contents.length };
    });
  }

  async setIntakePrompt(merchantId: string, offerId: string, value: unknown) {
    if (typeof value !== "string") throw new DomainError("INVALID_INTAKE_PROMPT", "Provide a service requirements prompt, or an empty string to remove it");
    const prompt = value.trim();
    if (prompt.length > 1000) throw new DomainError("INVALID_INTAKE_PROMPT", "Service requirements must be at most 1000 characters");
    const row = (await this.pool.query(
      "UPDATE offers SET service_intake_prompt = $3 WHERE id = $1 AND merchant_id = $2 AND archived_at IS NULL AND fulfillment_method = 'digital_service' RETURNING id",
      [offerId, merchantId, prompt || null],
    )).rows[0];
    requireValue(row, "OFFER_NOT_FOUND", "Service was not found");
    return { serviceIntakePrompt: prompt || null };
  }

  async orders(consumerId: string, orderId?: string): Promise<ConsumerOrder[]> {
    const rows = await this.pool.query<{
      id: string; name: string; merchant_name: string; status: string; captured_amount_minor: string; currency: string;
      created_at: Date; fulfillment_deadline: Date | null; refund_eligible_until: Date | null; refundable: boolean;
      file_name: string | null; service_intake_prompt: string | null; service_details: string | null;
    }>(`SELECT o.id, f.name, m.name AS merchant_name, o.status, o.captured_amount_minor::text, o.currency,
           o.created_at, o.fulfillment_deadline, o.refund_eligible_until, o.refundable,
           a.file_name, o.service_intake_prompt, o.service_details
        FROM orders o JOIN payment_intents p ON p.id = o.payment_id
        JOIN quotes q ON q.id = o.quote_id JOIN offers f ON f.id = q.offer_id
        JOIN merchants m ON m.id = o.merchant_id LEFT JOIN delivery_assets a ON a.id = o.delivery_asset_id
        WHERE p.consumer_id = $1 AND ($2::text IS NULL OR o.id = $2)
        ORDER BY o.created_at DESC, o.id DESC LIMIT 20`, [consumerId, orderId ?? null]);
    if (orderId && !rows.rowCount) throw new DomainError("ORDER_NOT_FOUND", "Order was not found", 404);
    return rows.rows.map((o) => ({
      orderId: o.id, offerName: o.name, merchantName: o.merchant_name, status: o.status,
      amountMinor: o.captured_amount_minor, currency: o.currency, createdAt: o.created_at.toISOString(),
      fulfillmentDeadline: o.fulfillment_deadline?.toISOString() ?? null,
      refundEligibleUntil: o.refund_eligible_until?.toISOString() ?? null,
      canCancel: ["confirmed", "fulfillment_failed"].includes(o.status),
      canRefund: o.status === "fulfilled" && o.refundable && !!o.refund_eligible_until && o.refund_eligible_until.getTime() >= Date.now(),
      delivery: o.status === "fulfilled" && o.file_name ? {
        fileName: o.file_name, downloadUrl: `/api/consumer/orders/${encodeURIComponent(o.id)}/download`,
      } : null,
      serviceIntakePrompt: o.service_intake_prompt, serviceDetails: o.service_details,
    }));
  }

  async downloads(consumerId: string, cursor?: unknown): Promise<{ downloads: ConsumerDownload[]; nextCursor: string | null }> {
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 128)) {
      throw new DomainError("INVALID_DOWNLOAD_CURSOR", "Use the next page link to load more downloads");
    }
    // Read the timestamp as text to preserve Postgres microseconds across page boundaries.
    // A refunded cursor order remains a valid position, but never appears as a downloadable file.
    const before = cursor === undefined ? null : requireValue((await this.pool.query<{ created_at: string }>(
      `SELECT o.created_at::text FROM orders o JOIN payment_intents p ON p.id = o.payment_id
       WHERE o.id = $1 AND p.consumer_id = $2`, [cursor, consumerId],
    )).rows[0], "INVALID_DOWNLOAD_CURSOR", "This download page is no longer available. Refresh your library.");
    const pageSize = 24;
    const result = await this.pool.query<{
      id: string; offer_name: string; merchant_name: string; created_at: Date; fulfilled_at: Date | null;
      file_name: string; size_bytes: number;
    }>(`SELECT o.id, f.name AS offer_name, m.name AS merchant_name, o.created_at, o.fulfilled_at,
               a.file_name, octet_length(a.contents) AS size_bytes
        FROM orders o JOIN payment_intents p ON p.id = o.payment_id
        JOIN quotes q ON q.id = o.quote_id JOIN offers f ON f.id = q.offer_id
        JOIN merchants m ON m.id = o.merchant_id JOIN delivery_assets a ON a.id = o.delivery_asset_id
        WHERE p.consumer_id = $1 AND o.status = 'fulfilled'
          AND ($2::timestamptz IS NULL OR (o.created_at, o.id) < ($2::timestamptz, $3::text))
        ORDER BY o.created_at DESC, o.id DESC LIMIT $4`, [consumerId, before?.created_at ?? null, cursor ?? null, pageSize + 1]);
    const page = result.rows.slice(0, pageSize);
    return {
      downloads: page.map((row) => ({
        orderId: row.id, offerName: row.offer_name, merchantName: row.merchant_name,
        purchasedAt: row.created_at.toISOString(), fulfilledAt: row.fulfilled_at?.toISOString() ?? null,
        fileName: row.file_name, sizeBytes: row.size_bytes,
      })),
      nextCursor: result.rows.length > pageSize ? page.at(-1)!.id : null,
    };
  }

  async submitDetails(consumerId: string, orderId: string, value: unknown) {
    const details = typeof value === "string" ? value.trim() : "";
    if (details.length < 3 || details.length > 4000) throw new DomainError("INVALID_SERVICE_DETAILS", "Provide 3 to 4000 characters of service requirements");
    return inTransaction(this.pool, async (client) => {
      const order = requireValue((await client.query<{ status: string; service_intake_prompt: string | null; service_details: string | null }>(
        `SELECT o.status, o.service_intake_prompt, o.service_details FROM orders o JOIN payment_intents p ON p.id = o.payment_id
         WHERE o.id = $1 AND p.consumer_id = $2 FOR UPDATE OF o`, [orderId, consumerId],
      )).rows[0], "ORDER_NOT_FOUND", "Order was not found");
      if (order.service_details === details) return { submitted: true };
      if (!order.service_intake_prompt || order.status !== "confirmed" || order.service_details) {
        throw new DomainError("SERVICE_DETAILS_LOCKED", "Requirements can only be submitted once for a pending service order", 409);
      }
      await client.query("UPDATE orders SET service_details = $2, service_details_submitted_at = now(), updated_at = now() WHERE id = $1", [orderId, details]);
      return { submitted: true };
    });
  }

  async download(consumerId: string, orderId: string) {
    return requireValue((await this.pool.query<{ file_name: string; content_type: string; contents: Buffer }>(
      `SELECT a.file_name, a.content_type, a.contents FROM orders o
       JOIN payment_intents p ON p.id = o.payment_id JOIN delivery_assets a ON a.id = o.delivery_asset_id
       WHERE o.id = $1 AND p.consumer_id = $2 AND o.status = 'fulfilled'`, [orderId, consumerId],
    )).rows[0], "DELIVERY_NOT_AVAILABLE", "Download is unavailable for this order");
  }
}
