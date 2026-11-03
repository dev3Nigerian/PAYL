import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import {
  MandatePayloadSchema,
  OrderReceiptSchema,
  OrderStatusSchema,
  PaymentMandateSchema,
  QuotePayloadSchema,
  ReceiptPayloadSchema,
  RefundReceiptPayloadSchema,
  RefundReceiptSchema,
  SignedQuoteSchema,
  type MandatePayload,
  type OrderReceipt,
  type OrderStatus,
  type PaymentMandate,
  type PaymentPrepareResult,
  type QuotePayload,
  type RefundReceipt,
  type SignedQuote,
} from "@payl/contracts";
import {
  createDeterministicDevKey,
  createSecretDerivedKey,
  sha256Hex,
  signPayload,
  verifyPayload,
  type SigningKey,
} from "@payl/crypto";
import type { Config } from "./config.js";
import { inTransaction } from "./db.js";
import { postJournal } from "./ledger.js";
import { DomainError, requireValue } from "./errors.js";
import { ConsumerChatService } from "./chat.js";
import { DeliveryService } from "./delivery.js";
import { seedSampleCatalog } from "./sample-catalog.js";
import { HttpPayPalGateway, type PayPalCapture, type PayPalGateway, type PayPalPayoutBatch } from "./paypal.js";

export const DIGITAL_GOODS_TERMS_V1 = "PAYL sandbox digital goods terms v1. Simulated funds only. No live payment or settlement occurs.";



type OfferRow = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  server_id: string;
  name: string;
  description: string;
  price_minor: string;
  currency: string;
  fulfillment_method: "digital_download" | "digital_service";
  refundable: boolean;
  refund_window_minutes: number | null;
};

type MerchantOfferRow = OfferRow & {
  active: boolean;
  created_at: Date;
  delivery_file_name: string | null;
  service_intake_prompt: string | null;
};

type PaymentRow = {
  id: string;
  quote_id: string;
  consumer_id: string;
  agent_client_id: string;
  merchant_id: string;
  amount_minor: string;
  currency: string;
  status: "pending_approval" | "reserved" | "captured" | "refunded" | "declined" | "released" | "expired" | "cancelled";
  mandate_id: string | null;
  expires_at: Date;
  approval_level: "policy_auto" | "human_mfa" | null;
};

type TopupRow = {
  id: string;
  consumer_id: string;
  amount_minor: string;
  currency: string;
  status: string;
  idempotency_key: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  provider_fee_minor: string;
  reversed_amount_minor: string;
  created_at: Date;
  completed_at: Date | null;
};

type PayoutRow = {
  id: string;
  merchant_id: string;
  currency: string;
  source_payable_minor: string;
  reserve_held_minor: string;
  paid_amount_minor: string;
  status: string;
  idempotency_key: string;
  paypal_recipient_email: string | null;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  provider_fee_minor: string;
  submitted_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
};

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function iso(date = new Date()): string {
  return date.toISOString();
}

function futureIso(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function asBigInt(value: string | number | bigint): bigint {
  return BigInt(value);
}

function validatedMinorAmount(value: unknown, label: string, allowZero = false): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new DomainError("INVALID_AMOUNT", `${label} must be a non-negative integer minor-unit amount`);
  }
  const amount = BigInt(value);
  if (allowZero ? amount < 0n : amount <= 0n) {
    throw new DomainError("INVALID_AMOUNT", `${label} must be ${allowZero ? "zero or greater" : "greater than zero"}`);
  }
  return amount;
}

function validatedIdempotencyKey(value: unknown, operation: string): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 8 || key.length > 128) {
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", `${operation} idempotency key must contain 8 to 128 characters`);
  }
  return key;
}

function validatedReason(value: unknown, operation: string): string | undefined {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) return undefined;
  if (reason.length > 500) throw new DomainError("INVALID_REASON", `${operation} reason cannot exceed 500 characters`);
  return reason;
}

const LEGACY_REFUND_WINDOW_MINUTES = 7 * 24 * 60;
const MAX_REFUND_WINDOW_MINUTES = 365 * 24 * 60;

function validatedRefundPolicy(
  refundable: unknown,
  refundWindowMinutes: unknown,
  defaultRefundable = false,
): { refundable: boolean; refundWindowMinutes: number | null } {
  const enabled = refundable === undefined ? defaultRefundable : refundable;
  if (typeof enabled !== "boolean") {
    throw new DomainError("INVALID_REFUND_POLICY", "Refundable must be true or false");
  }
  if (!enabled) {
    if (refundWindowMinutes !== undefined && refundWindowMinutes !== null) {
      throw new DomainError("INVALID_REFUND_POLICY", "A non-refundable product cannot have a refund window");
    }
    return { refundable: false, refundWindowMinutes: null };
  }
  if (
    typeof refundWindowMinutes !== "number" ||
    !Number.isInteger(refundWindowMinutes) ||
    refundWindowMinutes < 60 ||
    refundWindowMinutes > MAX_REFUND_WINDOW_MINUTES ||
    refundWindowMinutes % 60 !== 0
  ) {
    throw new DomainError("INVALID_REFUND_WINDOW", "Refund window must be a whole number of hours between 1 hour and 365 days");
  }
  return { refundable: true, refundWindowMinutes };
}

export class PaylService {
  private readonly paylKey: SigningKey;
  private readonly paypal: PayPalGateway | null;
  readonly chat: ConsumerChatService;
  readonly delivery: DeliveryService;

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
    paypalGateway?: PayPalGateway | null,
  ) {
    this.chat = new ConsumerChatService(pool, config, this);
    this.delivery = new DeliveryService(pool);
    this.paylKey = this.signingKey("payl-mandate-issuer", "payl-sandbox-2026-01", "mandate");
    this.paypal = paypalGateway === undefined
      ? (config.paypal ? new HttpPayPalGateway(config.paypal) : null)
      : paypalGateway;
  }

  paypalClientId(): string | null { return this.config.paypal?.clientId ?? null; }

  private requirePayPal(): PayPalGateway {
    if (!this.paypal) throw new DomainError("PAYPAL_NOT_CONFIGURED", "PayPal Sandbox is not configured", 503);
    return this.paypal;
  }

  async assertReady(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private merchantKey(merchantId: string): SigningKey {
    return this.signingKey(`merchant:${merchantId}`, `${merchantId}-sandbox-2026-01`, `merchant:${merchantId}`);
  }

  private signingKey(label: string, developmentKid: string, hostedSuffix: string): SigningKey {
    return this.config.signingMasterKey
      ? createSecretDerivedKey(this.config.signingMasterKey, label, `${this.config.signingKeyId}:${hostedSuffix}`)
      : createDeterministicDevKey(label, developmentKid);
  }

  async seedSandbox(): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO merchants(id, name, server_id, currency, signing_key_id, status)
         VALUES ($1, 'Atlas Digital Market', 'merchant_server_demo', 'USD', $2, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [this.config.sandboxMerchantId, this.merchantKey(this.config.sandboxMerchantId).kid],
      );
      await client.query(
        `INSERT INTO consumers(id, display_name, status)
         VALUES ($1, 'Demo Consumer', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [this.config.sandboxConsumerId],
      );
      await client.query(
        `INSERT INTO spending_policies(
           consumer_id, version, auto_approve_limit_minor, per_transaction_limit_minor, daily_limit_minor, currency
         ) VALUES ($1, 1, 5000, 50000, 100000, 'USD')
         ON CONFLICT (consumer_id) DO NOTHING`,
        [this.config.sandboxConsumerId],
      );

      const accounts = [
        ["acct_consumer_available", "consumer", this.config.sandboxConsumerId, "available", "USD"],
        ["acct_consumer_reserved", "consumer", this.config.sandboxConsumerId, "reserved", "USD"],
        ["acct_merchant_payable", "merchant", this.config.sandboxMerchantId, "payable", "USD"],
        [`acct_${this.config.sandboxMerchantId}_pending_payable`, "merchant", this.config.sandboxMerchantId, "pending_payable", "USD"],
        [`acct_${this.config.sandboxMerchantId}_reserve`, "merchant", this.config.sandboxMerchantId, "reserve", "USD"],
        [`acct_${this.config.sandboxMerchantId}_payout_pending`, "merchant", this.config.sandboxMerchantId, "payout_pending", "USD"],
        ["acct_platform_clearing", "platform", "payl", "clearing", "USD"],
        ["acct_platform_fee", "platform", "payl", "fee_revenue", "USD"],
        ["acct_platform_provider_fee_expense", "platform", "payl", "provider_fee_expense", "USD"],
      ] as const;
      for (const account of accounts) {
        await client.query(
          `INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [...account],
        );
      }

      await client.query(
        "INSERT INTO merchant_settlement_configs(merchant_id) VALUES ($1) ON CONFLICT (merchant_id) DO NOTHING",
        [this.config.sandboxMerchantId],
      );

      await postJournal(client, {
        eventType: "sandbox_funding",
        idempotencyKey: `sandbox-funding:${this.config.sandboxConsumerId}`,
        referenceType: "consumer",
        referenceId: this.config.sandboxConsumerId,
        lines: [
          { accountId: "acct_consumer_available", amountMinor: 100_000n },
          { accountId: "acct_platform_clearing", amountMinor: -100_000n },
        ],
      });
    });
  }

  async seedSampleCatalog() {
    return seedSampleCatalog(this.pool, this.config.sandboxMerchantId, (merchantId) => this.merchantKey(merchantId).kid);
  }

  async searchOffers(merchantId: string, query?: string): Promise<Array<Record<string, unknown>>> {
    const values: unknown[] = [merchantId];
    let search = "";
    if (query?.trim()) {
      values.push(`%${query.trim()}%`);
      search = "AND (o.name ILIKE $2 OR o.description ILIKE $2)";
    }
    const result = await this.pool.query<OfferRow>(
      `SELECT o.id, o.merchant_id, m.name AS merchant_name, m.server_id, o.name, o.description,
              o.price_minor::text, o.currency, o.fulfillment_method, o.refundable, o.refund_window_minutes
       FROM offers o JOIN merchants m ON m.id = o.merchant_id
       WHERE o.merchant_id = $1 AND o.active = true ${search}
       ORDER BY o.id`,
      values,
    );
    return result.rows.map((offer) => ({
      offerId: offer.id,
      merchantId: offer.merchant_id,
      name: offer.name,
      description: offer.description,
      priceMinor: offer.price_minor,
      currency: offer.currency,
      fulfillmentMethod: offer.fulfillment_method,
      refundable: offer.refundable,
      refundWindowMinutes: offer.refund_window_minutes,
    }));
  }

  async listMarketplaceMerchants(query?: string): Promise<Array<Record<string, unknown>>> {
    const search = query?.trim() || null;
    const result = await this.pool.query<{
      id: string;
      name: string;
      server_id: string;
      currency: string;
      active_offers: string;
    }>(
      `SELECT m.id, m.name, m.server_id, m.currency, count(o.id)::text AS active_offers
       FROM merchants m
       LEFT JOIN offers o ON o.merchant_id = m.id AND o.active = true
       WHERE m.status = 'active' AND ($1::text IS NULL OR m.name ILIKE '%' || $1 || '%')
       GROUP BY m.id, m.name, m.server_id, m.currency
       ORDER BY m.name, m.id
       LIMIT 100`,
      [search],
    );
    return result.rows.map((merchant) => ({
      merchantId: merchant.id,
      name: merchant.name,
      currency: merchant.currency,
      activeOffers: merchant.active_offers,
      directMcpUrl: new URL(`/mcp/merchants/${merchant.id}`, this.config.publicBaseUrl).href,
    }));
  }

  async searchMarketplaceOffers(input: { query?: string; merchantId?: string }): Promise<Array<Record<string, unknown>>> {
    const query = input.query?.trim() || null;
    const merchantId = input.merchantId?.trim() || null;
    const result = await this.pool.query<OfferRow>(
      `SELECT o.id, o.merchant_id, m.name AS merchant_name, m.server_id, o.name, o.description,
              o.price_minor::text, o.currency, o.fulfillment_method, o.refundable, o.refund_window_minutes
       FROM offers o JOIN merchants m ON m.id = o.merchant_id
       WHERE o.active = true AND m.status = 'active'
         AND ($1::text IS NULL OR o.merchant_id = $1)
         AND ($2::text IS NULL OR o.name ILIKE '%' || $2 || '%' OR o.description ILIKE '%' || $2 || '%' OR m.name ILIKE '%' || $2 || '%')
       ORDER BY o.price_minor, m.name, o.name
       LIMIT 100`,
      [merchantId, query],
    );
    return result.rows.map((offer) => ({
      offerId: offer.id,
      merchantId: offer.merchant_id,
      merchantName: offer.merchant_name,
      name: offer.name,
      description: offer.description,
      priceMinor: offer.price_minor,
      currency: offer.currency,
      fulfillmentMethod: offer.fulfillment_method,
      refundable: offer.refundable,
      refundWindowMinutes: offer.refund_window_minutes,
    }));
  }

  async getOffer(merchantId: string, offerId: string): Promise<Record<string, unknown>> {
    const offer = await this.loadOffer(merchantId, offerId);
    return {
      offerId: offer.id,
      merchantId: offer.merchant_id,
      merchantName: offer.merchant_name,
      name: offer.name,
      description: offer.description,
      priceMinor: offer.price_minor,
      currency: offer.currency,
      fulfillmentMethod: offer.fulfillment_method,
      refundable: offer.refundable,
      refundWindowMinutes: offer.refund_window_minutes,
      termsUri: new URL("/terms/digital-goods-v1", this.config.publicBaseUrl).href,
    };
  }

  async listMerchantOffers(merchantId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<MerchantOfferRow>(
      `SELECT o.id, o.merchant_id, m.name AS merchant_name, m.server_id, o.name, o.description,
              o.price_minor::text, o.currency, o.fulfillment_method, o.refundable,
              o.refund_window_minutes, o.active, o.created_at, a.file_name AS delivery_file_name, o.service_intake_prompt
       FROM offers o JOIN merchants m ON m.id = o.merchant_id LEFT JOIN delivery_assets a ON a.id = o.delivery_asset_id
       WHERE o.merchant_id = $1 AND o.archived_at IS NULL
       ORDER BY o.created_at DESC, o.id`,
      [merchantId],
    );
    return result.rows.map((offer) => ({
      offerId: offer.id,
      merchantId: offer.merchant_id,
      name: offer.name,
      description: offer.description,
      priceMinor: offer.price_minor,
      currency: offer.currency,
      fulfillmentMethod: offer.fulfillment_method,
      refundable: offer.refundable,
      refundWindowMinutes: offer.refund_window_minutes,
      active: offer.active,
      deliveryFileName: offer.delivery_file_name,
      serviceIntakePrompt: offer.service_intake_prompt,
      createdAt: offer.created_at.toISOString(),
    }));
  }

  async createMerchantOffer(input: {
    merchantId: string;
    name: string;
    description: string;
    priceMinor: string;
    fulfillmentMethod: "digital_download" | "digital_service";
    refundable?: boolean;
    refundWindowMinutes?: number | null;
  }): Promise<Record<string, unknown>> {
    const name = input.name.trim();
    const description = input.description.trim();
    if (name.length < 2 || name.length > 120) {
      throw new DomainError("INVALID_PRODUCT_NAME", "Product name must contain 2 to 120 characters");
    }
    if (description.length < 5 || description.length > 500) {
      throw new DomainError("INVALID_PRODUCT_DESCRIPTION", "Product description must contain 5 to 500 characters");
    }
    if (!(["digital_download", "digital_service"] as const).includes(input.fulfillmentMethod)) {
      throw new DomainError("INVALID_FULFILLMENT", "Choose digital download or digital service fulfillment");
    }
    const price = validatedMinorAmount(input.priceMinor, "Product price");
    const refundPolicy = validatedRefundPolicy(input.refundable, input.refundWindowMinutes);
    const merchant = requireValue(
      (await this.pool.query<{ currency: string; status: string }>(
        "SELECT currency, status FROM merchants WHERE id = $1",
        [input.merchantId],
      )).rows[0],
      "MERCHANT_NOT_FOUND",
      "Merchant was not found",
    );
    if (merchant.status !== "active") throw new DomainError("MERCHANT_SUSPENDED", "Merchant is not active", 403);

    const offerId = `offer_${randomUUID().replaceAll("-", "")}`;
    await this.pool.query(
      `INSERT INTO offers(
         id, merchant_id, name, description, price_minor, currency, fulfillment_method,
         refundable, refund_window_minutes, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [
        offerId,
        input.merchantId,
        name,
        description,
        price.toString(),
        merchant.currency,
        input.fulfillmentMethod,
        refundPolicy.refundable,
        refundPolicy.refundWindowMinutes,
      ],
    );
    await this.audit(this.pool, offerId, "merchant", input.merchantId, "offer.created", "offer", offerId, {
      priceMinor: price.toString(),
      currency: merchant.currency,
      ...refundPolicy,
    });
    return requireValue(
      (await this.listMerchantOffers(input.merchantId)).find((offer) => offer.offerId === offerId),
      "OFFER_NOT_FOUND",
      "Created product could not be loaded",
    );
  }

  async setMerchantOfferActive(merchantId: string, offerId: string, active: boolean): Promise<Record<string, unknown>> {
    return this.updateMerchantOffer({ merchantId, offerId, active });
  }

  async updateMerchantOffer(input: {
    merchantId: string;
    offerId: string;
    active?: unknown;
    refundable?: unknown;
    refundWindowMinutes?: unknown;
  }): Promise<Record<string, unknown>> {
    const hasActive = input.active !== undefined;
    const hasRefundPolicy = input.refundable !== undefined || input.refundWindowMinutes !== undefined;
    if (!hasActive && !hasRefundPolicy) {
      throw new DomainError("INVALID_PRODUCT_UPDATE", "Provide a publication status or refund policy to update");
    }
    if (hasActive && typeof input.active !== "boolean") {
      throw new DomainError("INVALID_PRODUCT_STATUS", "Product active status must be true or false");
    }
    if (input.refundable === undefined && input.refundWindowMinutes !== undefined) {
      throw new DomainError("INVALID_REFUND_POLICY", "Refundable must be supplied when changing the refund window");
    }
    const refundPolicy = hasRefundPolicy
      ? validatedRefundPolicy(input.refundable, input.refundWindowMinutes)
      : null;
    const updated = (await this.pool.query<{ id: string }>(
      `UPDATE offers
       SET active = CASE WHEN $3::boolean IS NULL THEN active ELSE $3 END,
           refundable = CASE WHEN $4::boolean IS NULL THEN refundable ELSE $4 END,
           refund_window_minutes = CASE WHEN $4::boolean IS NULL THEN refund_window_minutes ELSE $5 END
       WHERE id = $1 AND merchant_id = $2 AND archived_at IS NULL
       RETURNING id`,
      [
        input.offerId,
        input.merchantId,
        hasActive ? input.active : null,
        refundPolicy?.refundable ?? null,
        refundPolicy?.refundWindowMinutes ?? null,
      ],
    )).rows[0];
    requireValue(updated, "OFFER_NOT_FOUND", "Product was not found");
    await this.audit(this.pool, input.offerId, "merchant", input.merchantId, "offer.updated", "offer", input.offerId, {
      ...(hasActive ? { active: input.active } : {}),
      ...(refundPolicy ?? {}),
    });
    return requireValue(
      (await this.listMerchantOffers(input.merchantId)).find((offer) => offer.offerId === input.offerId),
      "OFFER_NOT_FOUND",
      "Updated product could not be loaded",
    );
  }

  async createQuote(merchantId: string, offerId: string, quantity: number): Promise<SignedQuote> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new DomainError("INVALID_QUANTITY", "Quantity must be an integer between 1 and 100");
    }
    const offer = await this.loadOffer(merchantId, offerId);
    const quoteId = newId("quote");
    const delivery = requireValue((await this.pool.query<{ delivery_asset_id: string | null; service_intake_prompt: string | null }>(
      "SELECT delivery_asset_id, service_intake_prompt FROM offers WHERE id = $1 AND merchant_id = $2", [offerId, merchantId],
    )).rows[0], "OFFER_NOT_FOUND", "Product was not found");
    const unit = asBigInt(offer.price_minor);
    const total = unit * BigInt(quantity);
    const createdAt = iso();
    const payload = QuotePayloadSchema.parse({
      schemaVersion: "2026-07-19",
      merchantId,
      merchantServerId: offer.server_id,
      quoteId,
      nonce: newId("nonce"),
      items: [
        {
          offerId,
          description: offer.description,
          quantity,
          unitPriceMinor: unit.toString(),
          lineTotalMinor: total.toString(),
        },
      ],
      subtotalMinor: total.toString(),
      discountMinor: "0",
      taxMinor: "0",
      feeMinor: "0",
      totalMinor: total.toString(),
      currency: offer.currency,
      fulfillmentMethod: offer.fulfillment_method,
      estimatedCompletion: offer.fulfillment_method === "digital_download" && delivery.delivery_asset_id ? "immediate" : "after_merchant_delivery",
      termsUri: new URL("/terms/digital-goods-v1", this.config.publicBaseUrl).href,
      termsHash: sha256Hex(DIGITAL_GOODS_TERMS_V1),
      refundPolicy: {
        refundable: offer.refundable,
        refundWindowMinutes: offer.refund_window_minutes,
      },
      createdAt,
      expiresAt: futureIso(this.config.sandboxQuoteTtlMinutes * 60_000),
    });
    const jws = await signPayload(payload, this.merchantKey(merchantId));
    const signedQuote = SignedQuoteSchema.parse({ payload, jws, hash: sha256Hex(jws) });
    await this.pool.query(
      `INSERT INTO quotes(
        id, merchant_id, offer_id, nonce, total_minor, currency, payload, jws, quote_hash, status, expires_at, delivery_asset_id, service_intake_prompt
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'active', $10, $11, $12)`,
      [
        quoteId,
        merchantId,
        offerId,
        payload.nonce,
        total.toString(),
        payload.currency,
        JSON.stringify(payload),
        jws,
        signedQuote.hash,
        payload.expiresAt,
        delivery.delivery_asset_id,
        delivery.service_intake_prompt,
      ],
    );
    await this.audit(this.pool, quoteId, "merchant", merchantId, "quote.created", "quote", quoteId, {
      quoteHash: signedQuote.hash,
    });
    return signedQuote;
  }

  async walletSummary(consumerId: string): Promise<Record<string, unknown>> {
    const consumer = requireValue(
      (await this.pool.query<{ id: string; display_name: string; status: string }>(
        "SELECT id, display_name, status FROM consumers WHERE id = $1",
        [consumerId],
      )).rows[0],
      "CONSUMER_NOT_FOUND",
      "Consumer was not found",
    );
    const balances = await this.pool.query<{ account_type: string; balance_minor: string }>(
      `SELECT a.account_type, COALESCE(sum(l.amount_minor), 0)::text AS balance_minor
       FROM ledger_accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       WHERE a.owner_type = 'consumer' AND a.owner_id = $1
       GROUP BY a.id, a.account_type`,
      [consumerId],
    );
    return {
      consumerRef: consumer.id,
      displayName: consumer.display_name,
      status: consumer.status,
      currency: "USD",
      balances: Object.fromEntries(balances.rows.map((row) => [row.account_type, row.balance_minor])),
    };
  }

  async walletPolicy(consumerId: string): Promise<Record<string, unknown>> {
    const policy = requireValue(
      (await this.pool.query<{
        version: number;
        auto_approve_limit_minor: string;
        per_transaction_limit_minor: string;
        daily_limit_minor: string;
        currency: string;
      }>(
        `SELECT version, auto_approve_limit_minor::text, per_transaction_limit_minor::text,
                daily_limit_minor::text, currency
         FROM spending_policies WHERE consumer_id = $1`,
        [consumerId],
      )).rows[0],
      "POLICY_NOT_FOUND",
      "No spending policy is configured",
    );
    return {
      version: policy.version,
      autoApproveLimitMinor: policy.auto_approve_limit_minor,
      perTransactionLimitMinor: policy.per_transaction_limit_minor,
      dailyLimitMinor: policy.daily_limit_minor,
      currency: policy.currency,
      humanApproval: "required_above_auto_approve_limit",
    };
  }

  async updateWalletPolicy(input: {
    consumerId: string;
    expectedVersion: number;
    autoApproveLimitMinor: string;
    perTransactionLimitMinor: string;
    dailyLimitMinor: string;
  }): Promise<Record<string, unknown>> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new DomainError("INVALID_POLICY_VERSION", "A valid current policy version is required");
    }
    const autoApprove = validatedMinorAmount(input.autoApproveLimitMinor, "Auto-approve limit", true);
    const perTransaction = validatedMinorAmount(input.perTransactionLimitMinor, "Per-transaction limit");
    const daily = validatedMinorAmount(input.dailyLimitMinor, "Daily limit");
    if (autoApprove > perTransaction) {
      throw new DomainError("INVALID_POLICY_LIMITS", "Auto-approve limit cannot exceed the per-transaction limit");
    }
    if (perTransaction > daily) {
      throw new DomainError("INVALID_POLICY_LIMITS", "Per-transaction limit cannot exceed the daily limit");
    }

    const updated = (await this.pool.query<{ version: number }>(
      `UPDATE spending_policies
       SET version = version + 1,
           auto_approve_limit_minor = $3,
           per_transaction_limit_minor = $4,
           daily_limit_minor = $5,
           updated_at = now()
       WHERE consumer_id = $1 AND version = $2
       RETURNING version`,
      [
        input.consumerId,
        input.expectedVersion,
        autoApprove.toString(),
        perTransaction.toString(),
        daily.toString(),
      ],
    )).rows[0];
    if (!updated) {
      const exists = (await this.pool.query("SELECT 1 FROM spending_policies WHERE consumer_id = $1", [input.consumerId])).rowCount;
      if (!exists) throw new DomainError("POLICY_NOT_FOUND", "No spending policy is configured", 404);
      throw new DomainError("POLICY_VERSION_CONFLICT", "Policy changed in another session; refresh and try again", 409, true);
    }
    await this.audit(this.pool, newId("policy_change"), "consumer", input.consumerId, "policy.updated", "policy", input.consumerId, {
      version: updated.version,
      autoApproveLimitMinor: autoApprove.toString(),
      perTransactionLimitMinor: perTransaction.toString(),
      dailyLimitMinor: daily.toString(),
    });
    return this.walletPolicy(input.consumerId);
  }

  async preparePayment(input: {
    consumerId: string;
    agentClientId: string;
    signedQuote: SignedQuote;
    idempotencyKey: string;
  }): Promise<PaymentPrepareResult> {
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Payment preparation");
    const signedQuote = SignedQuoteSchema.parse(input.signedQuote);
    await verifyPayload(signedQuote.jws, signedQuote.payload, this.merchantKey(signedQuote.payload.merchantId).publicKey);
    if (sha256Hex(signedQuote.jws) !== signedQuote.hash) {
      throw new DomainError("QUOTE_HASH_MISMATCH", "Signed quote hash is invalid");
    }
    if (new Date(signedQuote.payload.expiresAt).getTime() <= Date.now()) {
      throw new DomainError("QUOTE_EXPIRED", "The signed quote has expired");
    }

    return inTransaction(this.pool, async (client) => {
      const existing = (await client.query<PaymentRow>(
        "SELECT * FROM payment_intents WHERE consumer_id = $1 AND idempotency_key = $2 FOR UPDATE",
        [input.consumerId, idempotencyKey],
      )).rows[0];
      if (existing) {
        if (existing.quote_id !== signedQuote.payload.quoteId) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", "This payment idempotency key belongs to another quote", 409);
        }
        return this.paymentPrepareResult(client, existing);
      }

      const quote = requireValue(
        (await client.query<{
          id: string;
          merchant_id: string;
          total_minor: string;
          currency: string;
          jws: string;
          quote_hash: string;
          status: string;
          expires_at: Date;
        }>("SELECT * FROM quotes WHERE id = $1 FOR UPDATE", [signedQuote.payload.quoteId])).rows[0],
        "QUOTE_NOT_FOUND",
        "Quote is not registered with the merchant",
      );
      if (quote.jws !== signedQuote.jws || quote.quote_hash !== signedQuote.hash) {
        throw new DomainError("QUOTE_TAMPERED", "Quote does not match the merchant record");
      }
      if (quote.status !== "active" || quote.expires_at.getTime() <= Date.now()) {
        throw new DomainError("QUOTE_UNAVAILABLE", "Quote is no longer active");
      }

      const policy = requireValue(
        (await client.query<{
          auto_approve_limit_minor: string;
          per_transaction_limit_minor: string;
          daily_limit_minor: string;
          currency: string;
        }>("SELECT * FROM spending_policies WHERE consumer_id = $1 FOR UPDATE", [input.consumerId])).rows[0],
        "POLICY_NOT_FOUND",
        "No spending policy is configured",
      );
      const amount = asBigInt(quote.total_minor);
      if (quote.currency !== policy.currency) {
        throw new DomainError("CURRENCY_NOT_ALLOWED", "Quote currency is not permitted by this wallet");
      }
      if (amount > asBigInt(policy.per_transaction_limit_minor)) {
        throw new DomainError("POLICY_DECLINED", "Amount exceeds the per-transaction policy limit");
      }
      const capturedToday = asBigInt(
        (await client.query<{ total: string }>(
          `SELECT COALESCE(sum(amount_minor), 0)::text AS total FROM payment_intents
           WHERE consumer_id = $1 AND status IN ('captured', 'refunded') AND created_at >= date_trunc('day', now())`,
          [input.consumerId],
        )).rows[0]?.total ?? "0",
      );
      if (capturedToday + amount > asBigInt(policy.daily_limit_minor)) {
        throw new DomainError("DAILY_LIMIT_EXCEEDED", "Amount would exceed the daily policy limit");
      }

      const paymentId = newId("payment");
      const expiresAt = new Date(
        Math.min(
          quote.expires_at.getTime(),
          Date.now() + this.config.sandboxApprovalTtlMinutes * 60_000,
        ),
      );
      const autoApproved = amount <= asBigInt(policy.auto_approve_limit_minor);
      await client.query(
        `INSERT INTO payment_intents(
           id, quote_id, consumer_id, agent_client_id, merchant_id, amount_minor, currency,
           status, idempotency_key, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          paymentId,
          quote.id,
          input.consumerId,
          input.agentClientId,
          quote.merchant_id,
          amount.toString(),
          quote.currency,
          autoApproved ? "reserved" : "pending_approval",
          idempotencyKey,
          expiresAt,
        ],
      );

      if (autoApproved) {
        const mandate = await this.reserveAndIssue(client, {
          paymentId,
          quoteId: quote.id,
          quoteHash: quote.quote_hash,
          consumerId: input.consumerId,
          agentClientId: input.agentClientId,
          merchantId: quote.merchant_id,
          amount,
          currency: quote.currency,
          approvalLevel: "policy_auto",
          expiresAt,
        });
        await this.audit(client, paymentId, "policy", input.consumerId, "payment.reserved", "payment", paymentId, {
          approvalLevel: "policy_auto",
        });
        return { paymentId, status: "reserved", mandate, expiresAt: expiresAt.toISOString() };
      }

      const approvalId = newId("approval");
      await client.query(
        `INSERT INTO approval_challenges(id, payment_id, consumer_id, quote_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [approvalId, paymentId, input.consumerId, quote.quote_hash, expiresAt],
      );
      await this.audit(client, paymentId, "policy", input.consumerId, "approval.requested", "approval", approvalId, {});
      return {
        paymentId,
        status: "pending_approval",
        approvalId,
        approvalUrl: `${this.config.approvalWebUrl}/approve/${approvalId}`,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async getApproval(approvalId: string, consumerId: string): Promise<Record<string, unknown>> {
    const row = requireValue(
      (await this.pool.query<{
        id: string;
        consumer_id: string;
        status: string;
        expires_at: Date;
        payment_id: string;
        amount_minor: string;
        currency: string;
        merchant_name: string;
        quote_payload: QuotePayload;
      }>(
        `SELECT a.id, a.consumer_id, a.status, a.expires_at, a.payment_id,
                p.amount_minor::text, p.currency, m.name AS merchant_name, q.payload AS quote_payload
         FROM approval_challenges a
         JOIN payment_intents p ON p.id = a.payment_id
         JOIN merchants m ON m.id = p.merchant_id
         JOIN quotes q ON q.id = p.quote_id
         WHERE a.id = $1`,
        [approvalId],
      )).rows[0],
      "APPROVAL_NOT_FOUND",
      "Approval challenge was not found",
    );
    if (row.consumer_id !== consumerId) throw new DomainError("APPROVAL_FORBIDDEN", "Approval belongs to another consumer", 403);
    return {
      approvalId: row.id,
      paymentId: row.payment_id,
      status: row.status,
      merchantName: row.merchant_name,
      amountMinor: row.amount_minor,
      currency: row.currency,
      items: QuotePayloadSchema.parse(row.quote_payload).items,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  async decideApproval(approvalId: string, consumerId: string, decision: "approve" | "decline"): Promise<Record<string, unknown>> {
    const result = await inTransaction(this.pool, async (client) => {
      const row = requireValue(
        (await client.query<{
          id: string;
          payment_id: string;
          consumer_id: string;
          quote_hash: string;
          status: "pending" | "approved" | "declined" | "expired";
          expires_at: Date;
        }>("SELECT * FROM approval_challenges WHERE id = $1 FOR UPDATE", [approvalId])).rows[0],
        "APPROVAL_NOT_FOUND",
        "Approval challenge was not found",
      );
      if (row.consumer_id !== consumerId) throw new DomainError("APPROVAL_FORBIDDEN", "Approval belongs to another consumer", 403);
      const payment = requireValue(
        (await client.query<PaymentRow>("SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE", [row.payment_id])).rows[0],
        "PAYMENT_NOT_FOUND",
        "Payment was not found",
      );

      if (row.status === "approved" && payment.status === "reserved") {
        return { approvalId, paymentId: payment.id, status: "approved" };
      }
      if (row.status !== "pending" || payment.status !== "pending_approval") {
        throw new DomainError("APPROVAL_ALREADY_DECIDED", `Approval is already ${row.status}`);
      }
      if (row.expires_at.getTime() <= Date.now()) {
        await client.query("UPDATE approval_challenges SET status = 'expired', decided_at = now() WHERE id = $1", [approvalId]);
        await client.query("UPDATE payment_intents SET status = 'expired', updated_at = now() WHERE id = $1", [payment.id]);
        return { approvalId, paymentId: payment.id, status: "expired" };
      }
      if (decision === "decline") {
        await client.query("UPDATE approval_challenges SET status = 'declined', decided_at = now() WHERE id = $1", [approvalId]);
        await client.query("UPDATE payment_intents SET status = 'declined', updated_at = now() WHERE id = $1", [payment.id]);
        await this.audit(client, payment.id, "consumer", consumerId, "approval.declined", "approval", approvalId, {});
        return { approvalId, paymentId: payment.id, status: "declined" };
      }

      const mandate = await this.reserveAndIssue(client, {
        paymentId: payment.id,
        quoteId: payment.quote_id,
        quoteHash: row.quote_hash,
        consumerId,
        agentClientId: payment.agent_client_id,
        merchantId: payment.merchant_id,
        amount: asBigInt(payment.amount_minor),
        currency: payment.currency,
        approvalLevel: "human_mfa",
        expiresAt: payment.expires_at,
      });
      await client.query("UPDATE approval_challenges SET status = 'approved', decided_at = now() WHERE id = $1", [approvalId]);
      await this.audit(client, payment.id, "consumer", consumerId, "approval.approved", "approval", approvalId, {
        authentication: "sandbox_session",
      });
      return { approvalId, paymentId: payment.id, status: "approved", mandateId: mandate.payload.mandateId };
    });
    if (result.status === "expired") {
      throw new DomainError("APPROVAL_EXPIRED", "Approval challenge has expired");
    }
    return result;
  }

  async paymentStatus(paymentId: string, consumerId: string): Promise<Record<string, unknown>> {
    const payment = requireValue(
      (await this.pool.query<PaymentRow>("SELECT * FROM payment_intents WHERE id = $1 AND consumer_id = $2", [paymentId, consumerId])).rows[0],
      "PAYMENT_NOT_FOUND",
      "Payment was not found",
    );
    const result: Record<string, unknown> = {
      paymentId: payment.id,
      quoteId: payment.quote_id,
      status: payment.status,
      expiresAt: payment.expires_at.toISOString(),
    };
    if (payment.mandate_id) {
      const mandate = (await this.pool.query<{ payload: MandatePayload; jws: string }>(
        "SELECT payload, jws FROM payment_mandates WHERE id = $1",
        [payment.mandate_id],
      )).rows[0];
      if (mandate) result.mandate = PaymentMandateSchema.parse({ payload: mandate.payload, jws: mandate.jws });
    }
    return result;
  }

  async completedCheckout(consumerId: string, idempotencyKey: string, signedQuote: SignedQuote): Promise<OrderStatus | null> {
    const quote = SignedQuoteSchema.parse(signedQuote);
    await verifyPayload(quote.jws, quote.payload, this.merchantKey(quote.payload.merchantId).publicKey);
    if (sha256Hex(quote.jws) !== quote.hash) {
      throw new DomainError("QUOTE_HASH_MISMATCH", "Signed quote hash is invalid");
    }
    const result = await this.pool.query<{ order_id: string; merchant_id: string }>(
      `SELECT o.id AS order_id, o.merchant_id
       FROM payment_intents p
       JOIN quotes q ON q.id = p.quote_id
       JOIN orders o ON o.payment_id = p.id
       WHERE p.consumer_id = $1 AND p.idempotency_key = $2
         AND p.quote_id = $3 AND q.quote_hash = $4`,
      [consumerId, idempotencyKey, quote.payload.quoteId, quote.hash],
    );
    const row = result.rows[0];
    return row ? this.loadOrderStatus(this.pool, row.order_id, row.merchant_id) : null;
  }

  async commitOrder(input: {
    merchantId: string;
    signedQuote: SignedQuote;
    mandate: PaymentMandate;
    idempotencyKey: string;
  }): Promise<OrderStatus> {
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Order commit");
    const signedQuote = SignedQuoteSchema.parse(input.signedQuote);
    const mandate = PaymentMandateSchema.parse(input.mandate);
    await verifyPayload(signedQuote.jws, signedQuote.payload, this.merchantKey(input.merchantId).publicKey);
    await verifyPayload(mandate.jws, mandate.payload, this.paylKey.publicKey);
    if (sha256Hex(signedQuote.jws) !== signedQuote.hash || mandate.payload.quoteHash !== signedQuote.hash) {
      throw new DomainError("MANDATE_QUOTE_MISMATCH", "Mandate is not bound to this signed quote");
    }

    return inTransaction(this.pool, async (client) => {
      const storedMandate = requireValue(
        (await client.query<{
          id: string;
          payment_id: string;
          quote_id: string;
          merchant_id: string;
          max_amount_minor: string;
          currency: string;
          quote_hash: string;
          status: "reserved" | "consumed" | "released" | "expired";
          expires_at: Date;
          jws: string;
        }>("SELECT * FROM payment_mandates WHERE id = $1 FOR UPDATE", [mandate.payload.mandateId])).rows[0],
        "MANDATE_NOT_FOUND",
        "Payment mandate was not found",
      );
      const duplicate = (await client.query<{ id: string }>(
        "SELECT id FROM orders WHERE mandate_id = $1",
        [storedMandate.id],
      )).rows[0];
      if (duplicate) return this.loadOrderStatus(client, duplicate.id, input.merchantId);

      if (storedMandate.jws !== mandate.jws) throw new DomainError("MANDATE_TAMPERED", "Mandate does not match the Antspace record");
      if (storedMandate.status !== "reserved") throw new DomainError("MANDATE_ALREADY_USED", "Mandate is not available for capture");
      if (storedMandate.expires_at.getTime() <= Date.now()) throw new DomainError("MANDATE_EXPIRED", "Mandate has expired");
      if (storedMandate.merchant_id !== input.merchantId || mandate.payload.merchantId !== input.merchantId) {
        throw new DomainError("WRONG_MERCHANT", "Mandate is bound to another merchant");
      }
      if (storedMandate.quote_id !== signedQuote.payload.quoteId || storedMandate.quote_hash !== signedQuote.hash) {
        throw new DomainError("WRONG_QUOTE", "Mandate is bound to another quote");
      }
      if (
        asBigInt(signedQuote.payload.totalMinor) > asBigInt(storedMandate.max_amount_minor) ||
        signedQuote.payload.currency !== storedMandate.currency
      ) {
        throw new DomainError("MANDATE_LIMIT_EXCEEDED", "Quote exceeds the mandate amount or currency");
      }

      const quote = requireValue(
        (await client.query<{ status: string; expires_at: Date; jws: string }>("SELECT status, expires_at, jws FROM quotes WHERE id = $1 FOR UPDATE", [storedMandate.quote_id])).rows[0],
        "QUOTE_NOT_FOUND",
        "Quote was not found",
      );
      if (quote.status !== "active" || quote.expires_at.getTime() <= Date.now() || quote.jws !== signedQuote.jws) {
        throw new DomainError("QUOTE_UNAVAILABLE", "Quote is expired, committed, or altered");
      }

      const amount = asBigInt(signedQuote.payload.totalMinor);
      const fee = (amount * 200n) / 10_000n;
      const merchantNet = amount - fee;
      const orderId = newId("order");
      const orderCreatedAt = new Date();
      const fulfillmentDeadline = new Date(orderCreatedAt.getTime() + this.config.sandboxFulfillmentTtlMinutes * 60_000);
      const refundPolicy = signedQuote.payload.schemaVersion === "2026-07-19"
        ? signedQuote.payload.refundPolicy
        : { refundable: true as const, refundWindowMinutes: LEGACY_REFUND_WINDOW_MINUTES };
      const payment = requireValue(
        (await client.query<PaymentRow>("SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE", [storedMandate.payment_id])).rows[0],
        "PAYMENT_NOT_FOUND",
        "Payment was not found",
      );
      if (payment.status !== "reserved") throw new DomainError("PAYMENT_NOT_RESERVED", "Payment is not reserved");

      const settlementAccounts = await client.query<{
        id: string;
        owner_type: "consumer" | "merchant" | "platform";
        owner_id: string;
        account_type: "reserved" | "pending_payable" | "fee_revenue";
      }>(
        `SELECT id, owner_type, owner_id, account_type
         FROM ledger_accounts
         WHERE currency = $1 AND (
           (owner_type = 'consumer' AND owner_id = $2 AND account_type = 'reserved') OR
           (owner_type = 'merchant' AND owner_id = $3 AND account_type = 'pending_payable') OR
           (owner_type = 'platform' AND owner_id = 'payl' AND account_type = 'fee_revenue')
         )
         ORDER BY id FOR UPDATE`,
        [storedMandate.currency, payment.consumer_id, input.merchantId],
      );
      const accountId = (ownerType: string, accountType: string) => requireValue(
        settlementAccounts.rows.find((account) => account.owner_type === ownerType && account.account_type === accountType)?.id,
        "SETTLEMENT_ACCOUNT_MISSING",
        `${ownerType} ${accountType} ledger account is missing`,
      );

      await postJournal(client, {
        eventType: "payment_capture",
        idempotencyKey: `capture:${storedMandate.id}`,
        referenceType: "order",
        referenceId: orderId,
        lines: [
          { accountId: accountId("consumer", "reserved"), amountMinor: -amount },
          { accountId: accountId("merchant", "pending_payable"), amountMinor: merchantNet },
          { accountId: accountId("platform", "fee_revenue"), amountMinor: fee },
        ].filter((line) => line.amountMinor !== 0n),
      });

      await client.query(
        `INSERT INTO orders(
           id, merchant_id, quote_id, mandate_id, payment_id, status, captured_amount_minor,
           platform_fee_minor, currency, fulfillment_reference, refundable, refund_window_minutes, refund_eligible_until,
           receipt_payload, receipt_jws, fulfillment_deadline, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, NULL, $9, $10, NULL, NULL, NULL, $11, $12, $12)`,
        [
          orderId,
          input.merchantId,
          storedMandate.quote_id,
          storedMandate.id,
          payment.id,
          amount.toString(),
          fee.toString(),
          storedMandate.currency,
          refundPolicy.refundable,
          refundPolicy.refundable ? refundPolicy.refundWindowMinutes : null,
          fulfillmentDeadline,
          orderCreatedAt,
        ],
      );
      await client.query("UPDATE payment_mandates SET status = 'consumed', consumed_at = now() WHERE id = $1", [storedMandate.id]);
      await client.query("UPDATE payment_intents SET status = 'captured', updated_at = now() WHERE id = $1", [payment.id]);
      await client.query("UPDATE quotes SET status = 'committed' WHERE id = $1", [storedMandate.quote_id]);
      await this.audit(client, payment.id, "merchant", input.merchantId, "order.confirmed", "order", orderId, {
        idempotencyKey,
        capturedAmountMinor: amount.toString(),
        fulfillmentDeadline: fulfillmentDeadline.toISOString(),
      });
      await this.enqueueOutbox(client, input.merchantId, "merchant.order_created", "order", orderId, {
        orderId,
        merchantId: input.merchantId,
        quoteId: storedMandate.quote_id,
        capturedAmountMinor: amount.toString(),
        currency: storedMandate.currency,
        fulfillmentDeadline: fulfillmentDeadline.toISOString(),
      }, `order-created:${orderId}`);

      const delivery = (await client.query<{ delivery_asset_id: string | null }>(
        `UPDATE orders o SET delivery_asset_id = q.delivery_asset_id, service_intake_prompt = q.service_intake_prompt
         FROM quotes q WHERE o.id = $1 AND q.id = o.quote_id RETURNING o.delivery_asset_id`, [orderId],
      )).rows[0];
      if (signedQuote.payload.fulfillmentMethod === "digital_download" && delivery?.delivery_asset_id) {
        await this.fulfillOrderLocked(client, {
          merchantId: input.merchantId,
          orderId,
          fulfillmentReference: newId("fulfillment"),
          idempotencyKey: `automatic:${orderId}`,
          actorType: "system",
        });
      }
      return this.loadOrderStatus(client, orderId, input.merchantId);
    });
  }

  async getOrder(merchantId: string, orderId: string): Promise<OrderStatus> {
    return this.loadOrderStatus(this.pool, orderId, merchantId);
  }

  async fulfillOrder(input: {
    merchantId: string;
    orderId: string;
    fulfillmentReference: string;
    idempotencyKey: string;
  }): Promise<OrderStatus> {
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Fulfillment");
    const fulfillmentReference = typeof input.fulfillmentReference === "string" ? input.fulfillmentReference.trim() : "";
    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(fulfillmentReference)) {
      throw new DomainError("INVALID_FULFILLMENT_REFERENCE", "Fulfillment reference must contain 3 to 128 letters, numbers, hyphens, or underscores");
    }
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`fulfill:${input.orderId}`]);
      await this.fulfillOrderLocked(client, {
        merchantId: input.merchantId,
        orderId: input.orderId,
        fulfillmentReference,
        idempotencyKey,
        actorType: "merchant",
      });
      return this.loadOrderStatus(client, input.orderId, input.merchantId);
    });
  }

  async cancelPayment(input: {
    consumerId: string;
    paymentId: string;
    idempotencyKey: string;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Payment cancellation");
    const reason = validatedReason(input.reason, "Cancellation");
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.consumerId}:${idempotencyKey}`]);
      const byKey = (await client.query<{ payment_id: string; status: string; released_amount_minor: string; created_at: Date }>(
        `SELECT payment_id, status, released_amount_minor::text, created_at
         FROM payment_cancellations WHERE consumer_id = $1 AND idempotency_key = $2`,
        [input.consumerId, idempotencyKey],
      )).rows[0];
      if (byKey) {
        if (byKey.payment_id !== input.paymentId) throw new DomainError("IDEMPOTENCY_CONFLICT", "Cancellation key was used for another payment", 409);
        return {
          paymentId: byKey.payment_id,
          status: byKey.status,
          releasedAmountMinor: byKey.released_amount_minor,
          createdAt: byKey.created_at.toISOString(),
        };
      }
      const payment = requireValue(
        (await client.query<PaymentRow>("SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE", [input.paymentId])).rows[0],
        "PAYMENT_NOT_FOUND",
        "Payment was not found",
      );
      if (payment.consumer_id !== input.consumerId) throw new DomainError("PAYMENT_FORBIDDEN", "Payment belongs to another consumer", 403);
      const existing = (await client.query<{ status: string; released_amount_minor: string; created_at: Date }>(
        "SELECT status, released_amount_minor::text, created_at FROM payment_cancellations WHERE payment_id = $1",
        [payment.id],
      )).rows[0];
      if (existing) return { paymentId: payment.id, status: existing.status, releasedAmountMinor: existing.released_amount_minor, createdAt: existing.created_at.toISOString() };
      if (payment.status !== "pending_approval" && payment.status !== "reserved") {
        throw new DomainError("PAYMENT_NOT_CANCELLABLE", `A payment in ${payment.status} status cannot be cancelled`, 409);
      }
      const releasedAmount = payment.status === "reserved" ? asBigInt(payment.amount_minor) : 0n;
      if (payment.status === "reserved") {
        await this.releaseReservationLocked(client, payment, "released");
        await client.query("UPDATE payment_intents SET status = 'cancelled', updated_at = now() WHERE id = $1", [payment.id]);
      } else {
        await client.query("UPDATE approval_challenges SET status = 'declined', decided_at = now() WHERE payment_id = $1 AND status = 'pending'", [payment.id]);
        await client.query("UPDATE payment_intents SET status = 'cancelled', updated_at = now() WHERE id = $1", [payment.id]);
      }
      await client.query("UPDATE quotes SET status = 'cancelled' WHERE id = $1 AND status = 'active'", [payment.quote_id]);
      const cancellationId = newId("payment_cancel");
      const createdAt = new Date();
      await client.query(
        `INSERT INTO payment_cancellations(
           id, payment_id, consumer_id, reason, idempotency_key, released_amount_minor, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'cancelled', $7)`,
        [cancellationId, payment.id, input.consumerId, reason ?? null, idempotencyKey, releasedAmount.toString(), createdAt],
      );
      await this.audit(client, payment.id, "consumer", input.consumerId, "payment.cancelled", "payment", payment.id, {
        releasedAmountMinor: releasedAmount.toString(),
        ...(reason ? { reason } : {}),
      });
      await this.enqueueOutbox(client, payment.merchant_id, "payment.cancelled", "payment", payment.id, {
        paymentId: payment.id,
        merchantId: payment.merchant_id,
        releasedAmountMinor: releasedAmount.toString(),
        currency: payment.currency,
      }, `payment-cancelled:${payment.id}`);
      return { paymentId: payment.id, status: "cancelled", releasedAmountMinor: releasedAmount.toString(), createdAt: createdAt.toISOString() };
    });
  }

  async cancelOrder(input: {
    consumerId: string;
    orderId: string;
    idempotencyKey: string;
    reason?: string;
  }): Promise<OrderStatus> {
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Order cancellation");
    const reason = validatedReason(input.reason, "Cancellation");
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.consumerId}:${idempotencyKey}`]);
      const byKey = (await client.query<{ order_id: string }>(
        "SELECT order_id FROM order_cancellations WHERE consumer_id = $1 AND idempotency_key = $2",
        [input.consumerId, idempotencyKey],
      )).rows[0];
      if (byKey && byKey.order_id !== input.orderId) throw new DomainError("IDEMPOTENCY_CONFLICT", "Cancellation key was used for another order", 409);
      const consumer = requireValue(
        (await client.query<{ consumer_id: string }>(
          `SELECT p.consumer_id FROM orders o JOIN payment_intents p ON p.id = o.payment_id WHERE o.id = $1`,
          [input.orderId],
        )).rows[0],
        "ORDER_NOT_FOUND",
        "Order was not found",
      );
      if (consumer.consumer_id !== input.consumerId) throw new DomainError("ORDER_FORBIDDEN", "Order belongs to another consumer", 403);
      await this.cancelOrderLocked(client, {
        orderId: input.orderId,
        consumerId: input.consumerId,
        idempotencyKey,
        reason: reason ?? "Consumer cancelled before fulfillment",
        actorType: "consumer",
      });
      return this.loadOrderStatus(client, input.orderId);
    });
  }

  async processExpirations(limit = 100): Promise<Record<string, number>> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return inTransaction(this.pool, async (client) => {
      const counts = { paymentsExpired: 0, reservationsReleased: 0, ordersCancelled: 0, quotesExpired: 0 };
      const payments = await client.query<PaymentRow>(
        `SELECT * FROM payment_intents
         WHERE status IN ('pending_approval', 'reserved') AND expires_at <= now()
         ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [boundedLimit],
      );
      for (const payment of payments.rows) {
        if (payment.status === "reserved") {
          await this.releaseReservationLocked(client, payment, "expired");
          counts.reservationsReleased += 1;
        } else {
          await client.query("UPDATE payment_intents SET status = 'expired', updated_at = now() WHERE id = $1", [payment.id]);
        }
        await client.query("UPDATE approval_challenges SET status = 'expired', decided_at = now() WHERE payment_id = $1 AND status = 'pending'", [payment.id]);
        await client.query("UPDATE quotes SET status = 'expired' WHERE id = $1 AND status = 'active' AND expires_at <= now()", [payment.quote_id]);
        await client.query(
          `INSERT INTO payment_cancellations(
             id, payment_id, consumer_id, reason, idempotency_key, released_amount_minor, status
           ) VALUES ($1, $2, $3, 'Payment authority expired', $4, $5, 'expired')
           ON CONFLICT (payment_id) DO NOTHING`,
          [newId("payment_expiry"), payment.id, payment.consumer_id, `expiry:${payment.id}`, payment.status === "reserved" ? payment.amount_minor : "0"],
        );
        await this.audit(client, payment.id, "system", "lifecycle_worker", "payment.expired", "payment", payment.id, {
          releasedAmountMinor: payment.status === "reserved" ? payment.amount_minor : "0",
        });
        counts.paymentsExpired += 1;
      }

      const orders = await client.query<{ id: string; consumer_id: string }>(
        `SELECT o.id, p.consumer_id FROM orders o
         JOIN payment_intents p ON p.id = o.payment_id
         WHERE o.status IN ('confirmed', 'fulfillment_failed') AND o.fulfillment_deadline <= now()
         ORDER BY o.fulfillment_deadline FOR UPDATE OF o SKIP LOCKED LIMIT $1`,
        [boundedLimit],
      );
      for (const order of orders.rows) {
        await this.cancelOrderLocked(client, {
          orderId: order.id,
          consumerId: order.consumer_id,
          idempotencyKey: `fulfillment-timeout:${order.id}`,
          reason: "Merchant fulfillment deadline expired",
          actorType: "system",
        });
        counts.ordersCancelled += 1;
      }

      const expiredQuotes = await client.query(
        "UPDATE quotes SET status = 'expired' WHERE status = 'active' AND expires_at <= now() RETURNING id",
      );
      counts.quotesExpired = expiredQuotes.rowCount ?? 0;
      return counts;
    });
  }

  async configureMerchantWebhook(input: { merchantId: string; url: unknown }): Promise<Record<string, unknown>> {
    if (typeof input.url !== "string") throw new DomainError("INVALID_WEBHOOK_URL", "Webhook URL is required");
    let url: URL;
    try {
      url = new URL(input.url.trim());
    } catch {
      throw new DomainError("INVALID_WEBHOOK_URL", "Webhook URL is invalid");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !(this.config.nodeEnv !== "production" && loopback && url.protocol === "http:"))) {
      throw new DomainError("INVALID_WEBHOOK_URL", "Webhook URL must use HTTPS; development additionally permits HTTP loopback URLs");
    }
    const webhookId = newId("webhook");
    const secret = randomBytes(32).toString("base64url");
    const row = requireValue(
      (await this.pool.query<{ id: string; url: string; active: boolean; updated_at: Date }>(
        `INSERT INTO merchant_webhook_endpoints(id, merchant_id, url, signing_secret, active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (merchant_id) DO UPDATE
         SET url = excluded.url, signing_secret = excluded.signing_secret, active = true, updated_at = now()
         RETURNING id, url, active, updated_at`,
        [webhookId, input.merchantId, url.href, secret],
      )).rows[0],
      "MERCHANT_NOT_FOUND",
      "Merchant was not found",
    );
    await this.audit(this.pool, row.id, "merchant", input.merchantId, "webhook.configured", "webhook", row.id, { url: row.url });
    return { webhookId: row.id, url: row.url, active: row.active, signingSecret: secret, updatedAt: row.updated_at.toISOString() };
  }

  async disableMerchantWebhook(merchantId: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE merchant_webhook_endpoints SET active = false, updated_at = now() WHERE merchant_id = $1 AND active = true",
      [merchantId],
    );
    if (!result.rowCount) throw new DomainError("WEBHOOK_NOT_FOUND", "Active merchant webhook was not found", 404);
    await this.audit(this.pool, merchantId, "merchant", merchantId, "webhook.disabled", "merchant", merchantId, {});
  }

  async processOutbox(limit = 25): Promise<Record<string, number>> {
    const counts = { delivered: 0, retried: 0, dead: 0 };
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    for (let index = 0; index < boundedLimit; index += 1) {
      const event = await inTransaction(this.pool, async (client) => {
        const row = (await client.query<{
          id: string;
          event_type: string;
          payload: unknown;
          attempts: number;
          endpoint_id: string | null;
          url: string | null;
          signing_secret: string | null;
          endpoint_active: boolean | null;
        }>(
          `SELECT e.id, e.event_type, e.payload, e.attempts, e.endpoint_id,
                  w.url, w.signing_secret, w.active AS endpoint_active
           FROM outbox_events e
           LEFT JOIN merchant_webhook_endpoints w ON w.id = e.endpoint_id
           WHERE (e.status = 'pending' OR (e.status = 'processing' AND e.locked_at < now() - interval '5 minutes'))
             AND e.available_at <= now()
           ORDER BY e.created_at
           FOR UPDATE OF e SKIP LOCKED LIMIT 1`,
        )).rows[0];
        if (!row) return null;
        await client.query(
          "UPDATE outbox_events SET status = 'processing', attempts = attempts + 1, locked_at = now(), last_error = NULL WHERE id = $1",
          [row.id],
        );
        return { ...row, attempts: row.attempts + 1 };
      });
      if (!event) break;

      if (!event.endpoint_id || !event.url || !event.signing_secret || !event.endpoint_active) {
        await this.pool.query(
          "UPDATE outbox_events SET status = 'delivered', delivered_at = now(), last_error = $2 WHERE id = $1",
          [event.id, "No active merchant endpoint; retained as a delivered sandbox event"],
        );
        counts.delivered += 1;
        continue;
      }

      const body = JSON.stringify({ id: event.id, type: event.event_type, data: event.payload });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = `v1=${createHmac("sha256", event.signing_secret).update(`${timestamp}.${body}`).digest("hex")}`;
      try {
        const response = await fetch(event.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "PAYL-Sandbox-Webhook/1.0",
            "x-payl-event-id": event.id,
            "x-payl-timestamp": timestamp,
            "x-payl-signature": signature,
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
        await this.pool.query("UPDATE outbox_events SET status = 'delivered', delivered_at = now() WHERE id = $1", [event.id]);
        counts.delivered += 1;
      } catch (error) {
        const dead = event.attempts >= 8;
        const delaySeconds = Math.min(300, 2 ** Math.min(event.attempts, 8));
        await this.pool.query(
          `UPDATE outbox_events
           SET status = $2, available_at = now() + make_interval(secs => $3), last_error = $4
           WHERE id = $1`,
          [event.id, dead ? "dead" : "pending", delaySeconds, error instanceof Error ? error.message.slice(0, 1000) : "Webhook delivery failed"],
        );
        if (dead) counts.dead += 1;
        else counts.retried += 1;
      }
    }
    return counts;
  }

  async createTopup(input: { consumerId: string; amountMinor: unknown; idempotencyKey: unknown }): Promise<Record<string, unknown>> {
    const paypal = this.requirePayPal();
    const amount = validatedMinorAmount(input.amountMinor, "Top-up amount");
    if (amount > 1_000_000n) throw new DomainError("TOPUP_LIMIT", "Top-up amount cannot exceed $10,000 in the sandbox");
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Top-up");
    const row = await inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`topup:${input.consumerId}:${idempotencyKey}`]);
      const existing = (await client.query<TopupRow>(
        "SELECT * FROM wallet_topups WHERE consumer_id = $1 AND idempotency_key = $2 FOR UPDATE",
        [input.consumerId, idempotencyKey],
      )).rows[0];
      if (existing) {
        if (asBigInt(existing.amount_minor) !== amount) throw new DomainError("TOPUP_KEY_REUSED", "Top-up key belongs to a different amount", 409);
        return existing;
      }
      return requireValue((await client.query<TopupRow>(
        `INSERT INTO wallet_topups(id, consumer_id, amount_minor, currency, status, idempotency_key)
         VALUES ($1, $2, $3, 'USD', 'creating', $4) RETURNING *`,
        [newId("topup"), input.consumerId, amount.toString(), idempotencyKey],
      )).rows[0], "TOPUP_FAILED", "Top-up could not be created");
    });
    if (row.paypal_order_id || row.status === "completed" || row.status === "cancelled" || row.status === "reversed") return this.topupResult(row);
    const orderId = await paypal.createOrder({ topupId: row.id, amountMinor: amount });
    const updated = requireValue((await this.pool.query<TopupRow>(
      `UPDATE wallet_topups SET paypal_order_id = COALESCE(paypal_order_id, $2), status = 'pending', updated_at = now()
       WHERE id = $1 AND status = 'creating' RETURNING *`,
      [row.id, orderId],
    )).rows[0], "TOPUP_NOT_READY", "Top-up is no longer available");
    return this.topupResult(updated);
  }

  async captureTopup(consumerId: string, topupId: string): Promise<Record<string, unknown>> {
    const paypal = this.requirePayPal();
    const row = requireValue((await this.pool.query<TopupRow>(
      "SELECT * FROM wallet_topups WHERE id = $1 AND consumer_id = $2",
      [topupId, consumerId],
    )).rows[0], "TOPUP_NOT_FOUND", "Top-up was not found");
    if (row.status === "completed" || row.status === "reversed") return this.topupResult(row);
    if ((row.status !== "pending" && row.status !== "cancelled") || !row.paypal_order_id) throw new DomainError("TOPUP_NOT_READY", "Top-up is not ready for capture", 409);
    const capture = await paypal.captureOrder(row.paypal_order_id, row.id);
    if (!capture || capture.status !== "COMPLETED") return this.topupResult(row);
    return this.finalizeTopup(row.id, capture);
  }

  async topupStatus(consumerId: string, topupId: string): Promise<Record<string, unknown>> {
    const row = requireValue((await this.pool.query<TopupRow>(
      "SELECT * FROM wallet_topups WHERE id = $1 AND consumer_id = $2",
      [topupId, consumerId],
    )).rows[0], "TOPUP_NOT_FOUND", "Top-up was not found");
    if ((row.status === "pending" || row.status === "cancelled") && row.paypal_order_id && this.paypal) {
      const capture = await this.paypal.getOrderCapture(row.paypal_order_id);
      if (capture?.status === "COMPLETED") return this.finalizeTopup(row.id, capture);
    }
    return this.topupResult(row);
  }

  async cancelTopup(consumerId: string, topupId: string): Promise<Record<string, unknown>> {
    const row = (await this.pool.query<TopupRow>(
      `UPDATE wallet_topups SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND consumer_id = $2 AND status IN ('creating', 'pending') RETURNING *`,
      [topupId, consumerId],
    )).rows[0];
    if (!row) throw new DomainError("TOPUP_NOT_CANCELLABLE", "Top-up cannot be cancelled", 409);
    return this.topupResult(row);
  }

  async listTopups(consumerId: string): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<TopupRow>(
      "SELECT * FROM wallet_topups WHERE consumer_id = $1 ORDER BY created_at DESC LIMIT 25",
      [consumerId],
    );
    return result.rows.map((row) => this.topupResult(row));
  }

  private async finalizeTopup(topupId: string, capture: PayPalCapture): Promise<Record<string, unknown>> {
    if (capture.status !== "COMPLETED") throw new DomainError("TOPUP_NOT_CAPTURED", "PayPal has not completed this capture", 409);
    return inTransaction(this.pool, async (client) => {
      const row = requireValue((await client.query<TopupRow>(
        "SELECT * FROM wallet_topups WHERE id = $1 FOR UPDATE",
        [topupId],
      )).rows[0], "TOPUP_NOT_FOUND", "Top-up was not found");
      if (row.status === "completed" || row.status === "reversed") {
        if (row.paypal_capture_id !== capture.captureId) throw new DomainError("TOPUP_CAPTURE_MISMATCH", "Top-up capture does not match", 409);
        return this.topupResult(row);
      }
      if ((row.status !== "pending" && row.status !== "cancelled") || row.paypal_order_id !== capture.orderId) {
        throw new DomainError("TOPUP_NOT_READY", "Top-up is not available for credit", 409);
      }
      if (capture.amountMinor !== asBigInt(row.amount_minor) || capture.currency !== row.currency ||
        capture.merchantId !== this.config.paypal?.merchantId || capture.referenceId !== row.id) {
        throw new DomainError("TOPUP_CAPTURE_MISMATCH", "PayPal capture details do not match the top-up", 409);
      }
      const accounts = await client.query<{ id: string; owner_type: string; account_type: string }>(
        `SELECT id, owner_type, account_type FROM ledger_accounts
         WHERE currency = 'USD' AND (
           (owner_type = 'consumer' AND owner_id = $1 AND account_type = 'available') OR
           (owner_type = 'platform' AND owner_id = 'payl' AND account_type IN ('clearing', 'provider_fee_expense'))
         ) ORDER BY id FOR UPDATE`,
        [row.consumer_id],
      );
      const account = (owner: string, kind: string) => requireValue(
        accounts.rows.find((item) => item.owner_type === owner && item.account_type === kind)?.id,
        "TOPUP_ACCOUNT_MISSING", "Top-up ledger account is missing",
      );
      const amount = asBigInt(row.amount_minor);
      await postJournal(client, {
        eventType: "paypal_wallet_topup",
        idempotencyKey: `paypal-topup:${capture.captureId}`,
        referenceType: "topup",
        referenceId: row.id,
        lines: [
          { accountId: account("consumer", "available"), amountMinor: amount },
          { accountId: account("platform", "clearing"), amountMinor: -amount },
        ],
      });
      if (capture.feeMinor > 0n) {
        await postJournal(client, {
          eventType: "paypal_topup_fee",
          idempotencyKey: `paypal-topup-fee:${capture.captureId}`,
          referenceType: "topup",
          referenceId: row.id,
          lines: [
            { accountId: account("platform", "provider_fee_expense"), amountMinor: -capture.feeMinor },
            { accountId: account("platform", "clearing"), amountMinor: capture.feeMinor },
          ],
        });
      }
      const updated = requireValue((await client.query<TopupRow>(
        `UPDATE wallet_topups SET status = 'completed', paypal_capture_id = $2,
         provider_fee_minor = $3, completed_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [row.id, capture.captureId, capture.feeMinor.toString()],
      )).rows[0], "TOPUP_FAILED", "Top-up could not be finalized");
      await this.audit(client, row.id, "consumer", row.consumer_id, "topup.completed", "topup", row.id, {
        amountMinor: row.amount_minor, paypalOrderId: capture.orderId, paypalCaptureId: capture.captureId,
      });
      return this.topupResult(updated);
    });
  }

  private topupResult(row: TopupRow): Record<string, unknown> {
    return {
      topupId: row.id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      paypalOrderId: row.paypal_order_id,
      paypalCaptureId: row.paypal_capture_id,
      providerFeeMinor: row.provider_fee_minor,
      reversedAmountMinor: row.reversed_amount_minor,
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  async createPayout(input: { merchantId: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    this.requirePayPal();
    const idempotencyKey = validatedIdempotencyKey(input.idempotencyKey, "Payout");
    const row = await inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`payout:${input.merchantId}:${idempotencyKey}`]);
      const existing = (await client.query<PayoutRow>(
        "SELECT * FROM payout_batches WHERE merchant_id = $1 AND idempotency_key = $2 FOR UPDATE",
        [input.merchantId, idempotencyKey],
      )).rows[0];
      if (existing) return existing;

      const config = requireValue(
        (await client.query<{ reserve_bps: number; payouts_enabled: boolean; currency: string; paypal_payout_email: string | null }>(
          `SELECT s.reserve_bps, s.payouts_enabled, s.paypal_payout_email, m.currency
           FROM merchant_settlement_configs s JOIN merchants m ON m.id = s.merchant_id
           WHERE s.merchant_id = $1 FOR UPDATE OF s`,
          [input.merchantId],
        )).rows[0],
        "SETTLEMENT_NOT_CONFIGURED",
        "Merchant settlement is not configured",
      );
      if (!config.payouts_enabled) throw new DomainError("PAYOUTS_DISABLED", "Merchant payouts are disabled", 409);
      if (!config.paypal_payout_email) throw new DomainError("PAYOUT_ACCOUNT_REQUIRED", "Set a PayPal payout email before withdrawing", 409);
      if (config.currency !== "USD") throw new DomainError("PAYOUT_CURRENCY_UNSUPPORTED", "PayPal Sandbox payouts require USD", 409);
      const accounts = await client.query<{ id: string; owner_type: string; account_type: string }>(
        `SELECT id, owner_type, account_type FROM ledger_accounts
         WHERE currency = $1 AND (
           (owner_type = 'merchant' AND owner_id = $2 AND account_type IN ('payable', 'reserve', 'payout_pending'))
         ) ORDER BY id FOR UPDATE`,
        [config.currency, input.merchantId],
      );
      const accountId = (ownerType: string, accountType: string) => requireValue(
        accounts.rows.find((account) => account.owner_type === ownerType && account.account_type === accountType)?.id,
        "SETTLEMENT_ACCOUNT_MISSING",
        `${ownerType} ${accountType} account is missing`,
      );
      const payableId = accountId("merchant", "payable");
      const payable = await this.accountBalance(client, payableId);
      if (payable <= 0n) throw new DomainError("NO_PAYABLE_FUNDS", "Merchant has no positive payable balance", 409);
      const reserveHeld = (payable * BigInt(config.reserve_bps)) / 10_000n;
      const paid = payable - reserveHeld;
      const payoutId = newId("payout");
      await postJournal(client, {
        eventType: "merchant_payout_pending",
        idempotencyKey: `payout-hold:${payoutId}`,
        referenceType: "payout",
        referenceId: payoutId,
        lines: [
          { accountId: payableId, amountMinor: -payable },
          { accountId: accountId("merchant", "reserve"), amountMinor: reserveHeld },
          { accountId: accountId("merchant", "payout_pending"), amountMinor: paid },
        ].filter((line) => line.amountMinor !== 0n),
      });
      const row = requireValue(
        (await client.query<PayoutRow>(
          `INSERT INTO payout_batches(
             id, merchant_id, currency, source_payable_minor, reserve_held_minor, paid_amount_minor,
             status, idempotency_key, paypal_recipient_email
           ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
           RETURNING *`,
          [payoutId, input.merchantId, config.currency, payable.toString(), reserveHeld.toString(), paid.toString(), idempotencyKey, config.paypal_payout_email],
        )).rows[0],
        "PAYOUT_FAILED",
        "Payout record could not be created",
      );
      await this.audit(client, payoutId, "merchant", input.merchantId, "payout.pending", "payout", payoutId, {
        paidAmountMinor: paid.toString(), reserveHeldMinor: reserveHeld.toString(), currency: config.currency, recipientEmail: config.paypal_payout_email,
      });
      return row;
    });
    if (row.status === "pending") {
      try { return await this.submitOrReconcilePayout(row.id); } catch { /* a status request retries the same sender batch */ }
    }
    return this.payoutResult(row);
  }

  async setPayoutEmail(merchantId: string, value: unknown): Promise<{ email: string }> {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (email.length > 127 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DomainError("INVALID_PAYOUT_EMAIL", "Enter a valid PayPal payout email");
    }
    const updated = (await this.pool.query<{ paypal_payout_email: string }>(
      `UPDATE merchant_settlement_configs SET paypal_payout_email = $2, updated_at = now()
       WHERE merchant_id = $1 RETURNING paypal_payout_email`,
      [merchantId, email],
    )).rows[0];
    requireValue(updated, "MERCHANT_NOT_FOUND", "Merchant was not found");
    await this.audit(this.pool, merchantId, "merchant", merchantId, "payout.email_updated", "merchant", merchantId, { email });
    return { email };
  }

  async payoutStatus(merchantId: string, payoutId: string): Promise<Record<string, unknown>> {
    const row = requireValue((await this.pool.query<PayoutRow>(
      "SELECT * FROM payout_batches WHERE id = $1 AND merchant_id = $2",
      [payoutId, merchantId],
    )).rows[0], "PAYOUT_NOT_FOUND", "Payout was not found");
    if (row.status === "failed" || (row.status === "paid" && !row.paypal_batch_id)) return this.payoutResult(row);
    return this.submitOrReconcilePayout(row.id);
  }

  async reconcilePendingPayouts(merchantId?: string): Promise<number> {
    if (!this.paypal) return 0;
    const pending = await this.pool.query<{ id: string }>(
      `SELECT id FROM payout_batches WHERE status = 'pending'
       AND ($1::text IS NULL OR merchant_id = $1)
       AND updated_at < now() - interval '30 seconds'
       ORDER BY created_at LIMIT 5`,
      [merchantId ?? null],
    );
    let processed = 0;
    for (const row of pending.rows) {
      try { await this.submitOrReconcilePayout(row.id); processed += 1; } catch { /* next poll will retry */ }
    }
    return processed;
  }

  private async submitOrReconcilePayout(payoutId: string): Promise<Record<string, unknown>> {
    const paypal = this.requirePayPal();
    let row = requireValue((await this.pool.query<PayoutRow>("SELECT * FROM payout_batches WHERE id = $1", [payoutId])).rows[0],
      "PAYOUT_NOT_FOUND", "Payout was not found");
    if (row.status === "failed" || (row.status === "paid" && !row.paypal_batch_id)) return this.payoutResult(row);
    if (!row.paypal_recipient_email) throw new DomainError("PAYOUT_ACCOUNT_REQUIRED", "PayPal payout email is missing", 409);
    const recipientEmail = row.paypal_recipient_email;
    if (!row.paypal_batch_id) {
      if (row.submitted_at && Date.now() - row.submitted_at.getTime() >= 29 * 24 * 60 * 60 * 1000) {
        throw new DomainError("PAYOUT_REVIEW_REQUIRED", "PayPal payout needs manual reconciliation before another submission", 409);
      }
      row = requireValue((await this.pool.query<PayoutRow>(
        `UPDATE payout_batches SET submitted_at = COALESCE(submitted_at, now()), updated_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING *`, [row.id],
      )).rows[0], "PAYOUT_NOT_FOUND", "Payout was not found");
      const batchId = await paypal.createPayout({
        payoutId: row.id, amountMinor: asBigInt(row.paid_amount_minor), recipientEmail,
      });
      row = requireValue((await this.pool.query<PayoutRow>(
        `UPDATE payout_batches SET paypal_batch_id = COALESCE(paypal_batch_id, $2),
         submitted_at = COALESCE(submitted_at, now()), updated_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [row.id, batchId],
      )).rows[0], "PAYOUT_NOT_FOUND", "Payout was not found");
    }
    const batch = await paypal.getPayoutBatch(requireValue(row.paypal_batch_id, "PAYOUT_NOT_SUBMITTED", "Payout batch is missing"));
    return this.applyPayoutBatch(row.id, batch);
  }

  private async applyPayoutBatch(payoutId: string, batch: PayPalPayoutBatch): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (client) => {
      const row = requireValue((await client.query<PayoutRow>(
        "SELECT * FROM payout_batches WHERE id = $1 FOR UPDATE", [payoutId],
      )).rows[0], "PAYOUT_NOT_FOUND", "Payout was not found");
      if (row.paypal_batch_id !== batch.batchId) throw new DomainError("PAYOUT_BATCH_MISMATCH", "PayPal payout batch does not match", 409);
      const item = batch.items.find((candidate) => candidate.senderItemId === row.id);
      if (item && (item.amountMinor !== asBigInt(row.paid_amount_minor) || item.currency !== row.currency ||
        item.recipientEmail.toLowerCase() !== row.paypal_recipient_email?.toLowerCase())) {
        throw new DomainError("PAYOUT_ITEM_MISMATCH", "PayPal payout item does not match the withdrawal", 409);
      }
      const status = item?.status ?? (["DENIED", "CANCELED"].includes(batch.status) ? "FAILED" : "PENDING");
      const paid = status === "SUCCESS";
      const failed = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "CANCELED"].includes(status);
      if (!paid && !failed) return this.payoutResult(row);
      if (row.status === "failed") return this.payoutResult(row);
      const accounts = await client.query<{ id: string; owner_type: string; account_type: string }>(
        `SELECT id, owner_type, account_type FROM ledger_accounts
         WHERE currency = $1 AND ((owner_type = 'merchant' AND owner_id = $2
           AND account_type IN ('payable', 'reserve', 'payout_pending')) OR
           (owner_type = 'platform' AND owner_id = 'payl' AND account_type IN ('clearing', 'provider_fee_expense')))
         ORDER BY id FOR UPDATE`,
        [row.currency, row.merchant_id],
      );
      const account = (owner: string, kind: string) => requireValue(
        accounts.rows.find((candidate) => candidate.owner_type === owner && candidate.account_type === kind)?.id,
        "PAYOUT_ACCOUNT_MISSING", "Payout ledger account is missing",
      );
      const amount = asBigInt(row.paid_amount_minor);
      const reserve = asBigInt(row.reserve_held_minor);
      if (paid && row.status === "pending") {
        await postJournal(client, {
          eventType: "merchant_payout_paid", idempotencyKey: `payout-paid:${row.id}`,
          referenceType: "payout", referenceId: row.id,
          lines: [
            { accountId: account("merchant", "payout_pending"), amountMinor: -amount },
            { accountId: account("platform", "clearing"), amountMinor: amount },
          ],
        });
      } else if (failed) {
        await postJournal(client, {
          eventType: row.status === "paid" ? "merchant_payout_returned" : "merchant_payout_failed",
          idempotencyKey: `payout-release:${row.id}`, referenceType: "payout", referenceId: row.id,
          lines: [
            { accountId: account(row.status === "paid" ? "platform" : "merchant", row.status === "paid" ? "clearing" : "payout_pending"), amountMinor: -amount },
            { accountId: account("merchant", "reserve"), amountMinor: -reserve },
            { accountId: account("merchant", "payable"), amountMinor: asBigInt(row.source_payable_minor) },
          ].filter((line) => line.amountMinor !== 0n),
        });
      }
      if (item && item.feeMinor > asBigInt(row.provider_fee_minor)) {
        const additional = item.feeMinor - asBigInt(row.provider_fee_minor);
        await postJournal(client, {
          eventType: "paypal_payout_fee", idempotencyKey: `payout-fee:${row.id}:${item.feeMinor}`,
          referenceType: "payout", referenceId: row.id,
          lines: [
            { accountId: account("platform", "provider_fee_expense"), amountMinor: -additional },
            { accountId: account("platform", "clearing"), amountMinor: additional },
          ],
        });
      }
      if (row.status === "paid" && paid) {
        const updated = requireValue((await client.query<PayoutRow>(
          `UPDATE payout_batches SET paypal_item_id = COALESCE(paypal_item_id, $2),
           provider_fee_minor = GREATEST(provider_fee_minor, $3::bigint), updated_at = now()
           WHERE id = $1 RETURNING *`,
          [row.id, item?.itemId ?? null, item?.feeMinor.toString() ?? "0"],
        )).rows[0], "PAYOUT_FAILED", "Payout could not be updated");
        return this.payoutResult(updated);
      }
      const nextStatus = paid ? "paid" : "failed";
      const updated = requireValue((await client.query<PayoutRow>(
        `UPDATE payout_batches SET status = $2, paypal_item_id = COALESCE(paypal_item_id, $3),
         provider_fee_minor = $4, completed_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [row.id, nextStatus, item?.itemId ?? null, item && item.feeMinor > asBigInt(row.provider_fee_minor) ? item.feeMinor.toString() : row.provider_fee_minor],
      )).rows[0], "PAYOUT_FAILED", "Payout could not be finalized");
      await this.audit(client, row.id, "merchant", row.merchant_id, `payout.${nextStatus}`, "payout", row.id, {
        paypalBatchId: batch.batchId, paypalItemId: item?.itemId ?? null, providerStatus: status,
      });
      await this.enqueueOutbox(client, row.merchant_id, `payout.${nextStatus}`, "payout", row.id,
        this.payoutResult(updated), `payout-${nextStatus}:${row.id}`);
      return this.payoutResult(updated);
    });
  }

  async handlePayPalWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<void> {
    const paypal = this.requirePayPal();
    let event: {
      id?: string;
      event_type?: string;
      resource?: {
        id?: string;
        amount?: { currency_code?: string; value?: string };
        payout_batch_id?: string;
        payout_item_id?: string;
        batch_header?: { payout_batch_id?: string };
        links?: Array<{ rel?: string; href?: string }>;
        supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
      };
    };
    try { event = JSON.parse(rawBody.toString("utf8")) as typeof event; }
    catch { throw new DomainError("PAYPAL_WEBHOOK_INVALID", "PayPal webhook body is invalid", 400); }
    if (!event.id || !event.event_type) throw new DomainError("PAYPAL_WEBHOOK_INVALID", "PayPal webhook event is incomplete", 400);
    if (!await paypal.verifyWebhook(rawBody, headers)) {
      throw new DomainError("PAYPAL_WEBHOOK_UNVERIFIED", "PayPal webhook signature is invalid", 400);
    }
    const processed = await this.pool.query("SELECT 1 FROM paypal_webhook_events WHERE id = $1", [event.id]);
    if (processed.rowCount) return;
    const resource = event.resource;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = resource?.supplementary_data?.related_ids?.order_id;
      if (orderId) {
        const topup = (await this.pool.query<TopupRow>(
          "SELECT * FROM wallet_topups WHERE paypal_order_id = $1", [orderId],
        )).rows[0];
        if (topup && (topup.status === "pending" || topup.status === "cancelled")) {
          const capture = await paypal.getOrderCapture(orderId);
          if (capture?.status === "COMPLETED") await this.finalizeTopup(topup.id, capture);
        }
      }
    } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" || event.event_type === "PAYMENT.CAPTURE.REVERSED") {
      const upLink = resource?.links?.find((link) => link.rel === "up" && link.href?.includes("/v2/payments/captures/"));
      let linkedCaptureId: string | undefined;
      try { linkedCaptureId = upLink?.href ? /^\/v2\/payments\/captures\/([^/]+)$/.exec(new URL(upLink.href).pathname)?.[1] : undefined; }
      catch { linkedCaptureId = undefined; }
      const captureId = resource?.supplementary_data?.related_ids?.capture_id ?? linkedCaptureId ??
        (event.event_type === "PAYMENT.CAPTURE.REVERSED" ? resource?.id : undefined);
      const amount = resource?.amount;
      if (captureId && amount?.currency_code === "USD" && amount.value) {
        const [whole, fractional = ""] = amount.value.split(".");
        if (!/^\d+$/.test(whole ?? "") || !/^\d{0,2}$/.test(fractional)) {
          throw new DomainError("PAYPAL_WEBHOOK_INVALID", "PayPal reversal amount is invalid", 400);
        }
        const amountMinor = BigInt(whole!) * 100n + BigInt(fractional.padEnd(2, "0"));
        await this.reverseTopup(captureId, amountMinor, event.id, event.event_type);
        return;
      }
    } else if (event.event_type.startsWith("PAYMENT.PAYOUTS")) {
      const batchId = resource?.payout_batch_id ?? resource?.batch_header?.payout_batch_id;
      const itemId = resource?.payout_item_id ??
        (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM") ? resource?.id : undefined);
      if (batchId || itemId) {
        const payout = (await this.pool.query<PayoutRow>(
          "SELECT * FROM payout_batches WHERE paypal_batch_id = $1 OR paypal_item_id = $2", [batchId ?? null, itemId ?? null],
        )).rows[0];
        if (payout) await this.submitOrReconcilePayout(payout.id);
      }
    }
    await this.pool.query(
      "INSERT INTO paypal_webhook_events(id, event_type, resource_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [event.id, event.event_type, resource?.id ?? null],
    );
  }

  private async reverseTopup(captureId: string, amountMinor: bigint, eventId: string, eventType: string): Promise<void> {
    if (amountMinor <= 0n) throw new DomainError("PAYPAL_WEBHOOK_INVALID", "PayPal reversal amount is invalid", 400);
    await inTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO paypal_webhook_events(id, event_type, resource_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [eventId, eventType, captureId],
      );
      if (!inserted.rowCount) return;
      const row = (await client.query<TopupRow>(
        "SELECT * FROM wallet_topups WHERE paypal_capture_id = $1 FOR UPDATE", [captureId],
      )).rows[0];
      if (!row || (row.status !== "completed" && row.status !== "reversed")) return;
      const reversed = asBigInt(row.reversed_amount_minor);
      if (reversed + amountMinor > asBigInt(row.amount_minor)) {
        throw new DomainError("TOPUP_REVERSAL_EXCEEDS_CAPTURE", "PayPal reversal exceeds the original capture", 409);
      }
      const accounts = await client.query<{ id: string; owner_type: string; account_type: string }>(
        `SELECT id, owner_type, account_type FROM ledger_accounts
         WHERE currency = 'USD' AND ((owner_type = 'consumer' AND owner_id = $1 AND account_type = 'available') OR
         (owner_type = 'platform' AND owner_id = 'payl' AND account_type = 'clearing')) ORDER BY id FOR UPDATE`,
        [row.consumer_id],
      );
      const available = requireValue(accounts.rows.find((item) => item.owner_type === "consumer")?.id,
        "TOPUP_ACCOUNT_MISSING", "Consumer wallet is missing");
      const clearing = requireValue(accounts.rows.find((item) => item.owner_type === "platform")?.id,
        "TOPUP_ACCOUNT_MISSING", "Antspace clearing account is missing");
      await postJournal(client, {
        eventType: "paypal_topup_reversal", idempotencyKey: `paypal-reversal:${eventId}`,
        referenceType: "topup", referenceId: row.id,
        lines: [
          { accountId: available, amountMinor: -amountMinor },
          { accountId: clearing, amountMinor },
        ],
      });
      const total = reversed + amountMinor;
      await client.query(
        `UPDATE wallet_topups SET reversed_amount_minor = $2,
         status = CASE WHEN $2::bigint = amount_minor THEN 'reversed' ELSE status END,
         updated_at = now() WHERE id = $1`,
        [row.id, total.toString()],
      );
      await this.audit(client, row.id, "paypal", captureId, "topup.reversed", "topup", row.id, {
        amountMinor: amountMinor.toString(), eventId, eventType,
      });
    });
  }

  async reconciliationReport(merchantId: string, persist = false): Promise<Record<string, unknown>> {
    const queryable = this.pool;
    const [movement, accounts, journal] = await Promise.all([
      queryable.query<{
        captures: string; cancelled_net: string; refunds: string; payouts: string;
      }>(
        `SELECT
           COALESCE((SELECT sum(captured_amount_minor - platform_fee_minor) FROM orders WHERE merchant_id = $1), 0)::text AS captures,
           COALESCE((SELECT sum(captured_amount_minor - platform_fee_minor) FROM orders WHERE merchant_id = $1 AND status = 'cancelled'), 0)::text AS cancelled_net,
           COALESCE((SELECT sum(refunded_amount_minor) FROM refunds WHERE merchant_id = $1), 0)::text AS refunds,
           COALESCE((SELECT sum(paid_amount_minor) FROM payout_batches WHERE merchant_id = $1 AND status = 'paid'), 0)::text AS payouts`,
        [merchantId],
      ),
      queryable.query<{ currency: string; account_type: string; balance: string }>(
        `SELECT a.currency, a.account_type, COALESCE(sum(l.amount_minor), 0)::text AS balance
         FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
         WHERE a.owner_type = 'merchant' AND a.owner_id = $1
           AND a.account_type IN ('pending_payable', 'payable', 'reserve', 'payout_pending')
         GROUP BY a.id, a.currency, a.account_type ORDER BY a.account_type`,
        [merchantId],
      ),
      queryable.query<{ unbalanced: string }>(
        `SELECT count(*) FILTER (WHERE balance <> 0)::text AS unbalanced
         FROM (SELECT e.id, COALESCE(sum(l.amount_minor), 0) AS balance
               FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id) j`,
      ),
    ]);
    const row = requireValue(movement.rows[0], "RECONCILIATION_FAILED", "Settlement movements could not be loaded");
    const balances = Object.fromEntries(accounts.rows.map((account) => [account.account_type, account.balance]));
    const expected = asBigInt(row.captures) - asBigInt(row.cancelled_net) - asBigInt(row.refunds) - asBigInt(row.payouts);
    const actual = accounts.rows.reduce((sum, account) => sum + asBigInt(account.balance), 0n);
    const currency = accounts.rows[0]?.currency ?? "USD";
    const report = {
      merchantId,
      currency,
      generatedAt: iso(),
      movements: {
        capturedNetMinor: row.captures,
        cancelledNetMinor: row.cancelled_net,
        refundedGrossMinor: row.refunds,
        paidOutMinor: row.payouts,
      },
      balances,
      expectedPositionMinor: expected.toString(),
      actualPositionMinor: actual.toString(),
      differenceMinor: (actual - expected).toString(),
      unbalancedJournalEntries: journal.rows[0]?.unbalanced ?? "0",
      reconciled: actual === expected && (journal.rows[0]?.unbalanced ?? "0") === "0",
    };
    if (persist) {
      await this.pool.query(
        `INSERT INTO reconciliation_reports(
           id, merchant_id, currency, expected_position_minor, actual_position_minor,
           difference_minor, unbalanced_journal_entries, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [newId("reconciliation"), merchantId, currency, expected.toString(), actual.toString(), (actual - expected).toString(), journal.rows[0]?.unbalanced ?? "0", JSON.stringify(report)],
      );
    }
    return report;
  }

  async pilotMetrics(merchantId: string): Promise<Record<string, unknown>> {
    const [funnel, approvals, fulfillment, operations] = await Promise.all([
      this.pool.query<{
        quotes: string; orders: string; fulfilled: string; cancelled: string; refunded: string;
      }>(
        `SELECT
           (SELECT count(*) FROM quotes WHERE merchant_id = $1)::text AS quotes,
           count(*)::text AS orders,
           count(*) FILTER (WHERE status IN ('fulfilled', 'refunded'))::text AS fulfilled,
           count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
           count(*) FILTER (WHERE status = 'refunded')::text AS refunded
         FROM orders WHERE merchant_id = $1`,
        [merchantId],
      ),
      this.pool.query<{ requested: string; completed: string; median_seconds: string | null }>(
        `SELECT count(*)::text AS requested,
                count(*) FILTER (WHERE a.decided_at IS NOT NULL)::text AS completed,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a.decided_at - a.created_at)))
                  FILTER (WHERE a.decided_at IS NOT NULL)::text AS median_seconds
         FROM approval_challenges a JOIN payment_intents p ON p.id = a.payment_id
         WHERE p.merchant_id = $1`,
        [merchantId],
      ),
      this.pool.query<{ average_seconds: string | null; pending: string; failed: string }>(
        `SELECT avg(extract(epoch FROM (fulfilled_at - created_at)))
                  FILTER (WHERE fulfilled_at IS NOT NULL)::text AS average_seconds,
                count(*) FILTER (WHERE status = 'confirmed')::text AS pending,
                count(*) FILTER (WHERE status = 'fulfillment_failed')::text AS failed
         FROM orders WHERE merchant_id = $1`,
        [merchantId],
      ),
      this.pool.query<{ pending_webhooks: string; dead_webhooks: string; payouts: string; audit_coverage: string }>(
        `SELECT
           (SELECT count(*) FROM outbox_events WHERE merchant_id = $1 AND status IN ('pending', 'processing'))::text AS pending_webhooks,
           (SELECT count(*) FROM outbox_events WHERE merchant_id = $1 AND status = 'dead')::text AS dead_webhooks,
           (SELECT count(*) FROM payout_batches WHERE merchant_id = $1 AND status = 'paid')::text AS payouts,
           (SELECT count(*) FROM orders o WHERE o.merchant_id = $1 AND EXISTS (
              SELECT 1 FROM audit_events a WHERE a.object_type = 'order' AND a.object_id = o.id
            ))::text AS audit_coverage`,
        [merchantId],
      ),
    ]);
    const f = requireValue(funnel.rows[0], "METRICS_FAILED", "Pilot funnel could not be loaded");
    const orderCount = Number(f.orders);
    const quoteCount = Number(f.quotes);
    const fulfilled = Number(f.fulfilled);
    return {
      generatedAt: iso(),
      funnel: {
        quotes: f.quotes,
        orders: f.orders,
        quoteToOrderPercent: quoteCount ? Number(((orderCount / quoteCount) * 100).toFixed(2)) : 0,
        terminalSuccessPercent: orderCount ? Number(((fulfilled / orderCount) * 100).toFixed(2)) : 0,
        cancelledOrders: f.cancelled,
        refundedOrders: f.refunded,
        refundRatePercent: fulfilled ? Number(((Number(f.refunded) / fulfilled) * 100).toFixed(2)) : 0,
      },
      approvals: {
        requested: approvals.rows[0]?.requested ?? "0",
        completed: approvals.rows[0]?.completed ?? "0",
        medianSeconds: approvals.rows[0]?.median_seconds ?? null,
      },
      fulfillment: {
        pending: fulfillment.rows[0]?.pending ?? "0",
        failed: fulfillment.rows[0]?.failed ?? "0",
        averageSeconds: fulfillment.rows[0]?.average_seconds ?? null,
      },
      operations: operations.rows[0] ?? { pending_webhooks: "0", dead_webhooks: "0", payouts: "0", audit_coverage: "0" },
    };
  }

  async merchantAuditExport(merchantId: string, limit = 250): Promise<Array<Record<string, unknown>>> {
    const bounded = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const result = await this.pool.query<{
      id: string; correlation_id: string; actor_type: string; actor_id: string; event_type: string; object_type: string; object_id: string; metadata: Record<string, unknown>; created_at: Date;
    }>(
      `SELECT a.id::text, a.correlation_id, a.actor_type, a.actor_id, a.event_type,
              a.object_type, a.object_id, a.metadata, a.created_at
       FROM audit_events a
       WHERE a.actor_id = $1
          OR (a.object_type = 'order' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = a.object_id AND o.merchant_id = $1))
          OR (a.object_type = 'refund' AND EXISTS (SELECT 1 FROM refunds r WHERE r.id = a.object_id AND r.merchant_id = $1))
          OR (a.object_type = 'payment' AND EXISTS (SELECT 1 FROM payment_intents p WHERE p.id = a.object_id AND p.merchant_id = $1))
       ORDER BY a.id DESC LIMIT $2`,
      [merchantId, bounded],
    );
    return result.rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
  }

  async refundOrder(input: {
    consumerId: string;
    orderId: string;
    idempotencyKey: string;
    reason?: string;
  }): Promise<RefundReceipt> {
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new DomainError("INVALID_IDEMPOTENCY_KEY", "Refund idempotency key must contain 8 to 128 characters");
    }
    const reason = input.reason?.trim() || undefined;
    if (reason && reason.length > 500) throw new DomainError("INVALID_REFUND_REASON", "Refund reason cannot exceed 500 characters");

    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.consumerId}:${idempotencyKey}`]);
      const byKey = (await client.query<{ order_id: string; receipt_payload: unknown; receipt_jws: string }>(
        `SELECT order_id, receipt_payload, receipt_jws
         FROM refunds WHERE consumer_id = $1 AND idempotency_key = $2`,
        [input.consumerId, idempotencyKey],
      )).rows[0];
      if (byKey) {
        if (byKey.order_id !== input.orderId) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", "This refund idempotency key was already used for another order", 409);
        }
        return RefundReceiptSchema.parse({ payload: byKey.receipt_payload, jws: byKey.receipt_jws });
      }

      const order = requireValue(
        (await client.query<{
          id: string;
          payment_id: string;
          merchant_id: string;
          consumer_id: string;
          status: "confirmed" | "fulfilled" | "cancelled" | "refunded";
          captured_amount_minor: string;
          platform_fee_minor: string;
          currency: string;
          refundable: boolean;
          refund_eligible_until: Date | null;
        }>(
          `SELECT o.id, o.payment_id, o.merchant_id, p.consumer_id, o.status,
                  o.captured_amount_minor::text, o.platform_fee_minor::text, o.currency,
                  o.refundable, o.refund_eligible_until
           FROM orders o
           JOIN payment_intents p ON p.id = o.payment_id
           WHERE o.id = $1
           FOR UPDATE OF o, p`,
          [input.orderId],
        )).rows[0],
        "ORDER_NOT_FOUND",
        "Order was not found",
      );
      if (order.consumer_id !== input.consumerId) {
        throw new DomainError("REFUND_FORBIDDEN", "Only the consumer who purchased this order can refund it", 403);
      }
      if (order.status === "refunded") {
        const existing = requireValue(
          (await client.query<{ receipt_payload: unknown; receipt_jws: string }>(
            "SELECT receipt_payload, receipt_jws FROM refunds WHERE order_id = $1",
            [order.id],
          )).rows[0],
          "REFUND_NOT_FOUND",
          "The completed refund record could not be loaded",
        );
        return RefundReceiptSchema.parse({ payload: existing.receipt_payload, jws: existing.receipt_jws });
      }
      if (order.status !== "fulfilled") {
        throw new DomainError("ORDER_NOT_REFUNDABLE", `An order in ${order.status} status cannot be refunded`, 409);
      }
      if (!order.refundable || !order.refund_eligible_until) {
        throw new DomainError("PRODUCT_NOT_REFUNDABLE", "This product was sold as non-refundable", 409);
      }
      if (order.refund_eligible_until.getTime() < Date.now()) {
        throw new DomainError("REFUND_WINDOW_EXPIRED", "The merchant's refund window has expired", 409);
      }

      const accounts = await client.query<{
        id: string;
        owner_type: "consumer" | "merchant";
        account_type: "available" | "payable" | "reserve";
      }>(
        `SELECT id, owner_type, account_type
         FROM ledger_accounts
         WHERE currency = $1 AND (
           (owner_type = 'consumer' AND owner_id = $2 AND account_type = 'available') OR
           (owner_type = 'merchant' AND owner_id = $3 AND account_type IN ('payable', 'reserve'))
         )
         ORDER BY id FOR UPDATE`,
        [order.currency, input.consumerId, order.merchant_id],
      );
      const accountId = (ownerType: "consumer" | "merchant", accountType: "available" | "payable" | "reserve") => requireValue(
        accounts.rows.find((account) => account.owner_type === ownerType && account.account_type === accountType)?.id,
        "REFUND_ACCOUNT_MISSING",
        `${ownerType} refund ledger account is missing`,
      );
      const amount = asBigInt(order.captured_amount_minor);
      const refundId = newId("refund");
      await postJournal(client, {
        eventType: "payment_refund",
        idempotencyKey: `refund:${order.id}`,
        referenceType: "refund",
        referenceId: refundId,
        lines: [
          { accountId: accountId("consumer", "available"), amountMinor: amount },
          { accountId: accountId("merchant", "payable"), amountMinor: -amount },
        ],
      });

      const reserveId = accountId("merchant", "reserve");
      const reserveBalance = await this.accountBalance(client, reserveId);
      const reserveRecovery = reserveBalance < amount ? reserveBalance : amount;
      if (reserveRecovery > 0n) {
        await postJournal(client, {
          eventType: "merchant_reserve_recovery",
          idempotencyKey: `refund-reserve:${order.id}`,
          referenceType: "refund",
          referenceId: refundId,
          lines: [
            { accountId: reserveId, amountMinor: -reserveRecovery },
            { accountId: accountId("merchant", "payable"), amountMinor: reserveRecovery },
          ],
        });
      }

      const createdAt = iso();
      const receiptPayload = RefundReceiptPayloadSchema.parse({
        schemaVersion: "2026-07-19",
        refundId,
        orderId: order.id,
        paymentId: order.payment_id,
        consumerRef: input.consumerId,
        merchantId: order.merchant_id,
        refundedAmountMinor: order.captured_amount_minor,
        retainedFeeMinor: order.platform_fee_minor,
        currency: order.currency,
        status: "refunded",
        ...(reason ? { reason } : {}),
        createdAt,
      });
      const receiptJws = await signPayload(receiptPayload, this.paylKey);
      const receipt = RefundReceiptSchema.parse({ payload: receiptPayload, jws: receiptJws });
      await client.query(
        `INSERT INTO refunds(
           id, order_id, payment_id, consumer_id, merchant_id, refunded_amount_minor,
           retained_fee_minor, currency, status, reason, idempotency_key, receipt_payload, receipt_jws, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10, $11::jsonb, $12, $13)`,
        [
          refundId,
          order.id,
          order.payment_id,
          input.consumerId,
          order.merchant_id,
          order.captured_amount_minor,
          order.platform_fee_minor,
          order.currency,
          reason ?? null,
          idempotencyKey,
          JSON.stringify(receiptPayload),
          receiptJws,
          createdAt,
        ],
      );
      await client.query("UPDATE orders SET status = 'refunded', refunded_at = $2, updated_at = $2 WHERE id = $1", [order.id, createdAt]);
      await client.query("UPDATE payment_intents SET status = 'refunded', updated_at = $2 WHERE id = $1", [order.payment_id, createdAt]);
      await this.audit(client, order.payment_id, "consumer", input.consumerId, "refund.completed", "refund", refundId, {
        orderId: order.id,
        refundedAmountMinor: order.captured_amount_minor,
        retainedFeeMinor: order.platform_fee_minor,
        idempotencyKey,
        reserveRecoveryMinor: reserveRecovery.toString(),
      });
      await this.enqueueOutbox(client, order.merchant_id, "order.refunded", "order", order.id, receiptPayload, `order-refunded:${order.id}`);
      return receipt;
    });
  }

  async consumerDashboard(consumerId: string): Promise<Record<string, unknown>> {
    const [wallet, policy, orders, topups] = await Promise.all([
      this.walletSummary(consumerId),
      this.walletPolicy(consumerId),
      this.pool.query<{
        id: string;
        status: string;
        captured_amount_minor: string;
        currency: string;
        merchant_name: string;
        offer_id: string;
        offer_name: string;
        delivery_file_name: string | null;
        fulfillment_reference: string | null;
        fulfillment_deadline: Date | null;
        fulfilled_at: Date | null;
        cancelled_at: Date | null;
        cancellation_reason: string | null;
        refundable: boolean;
        refund_eligible_until: Date | null;
        refunded_at: Date | null;
        retained_fee_minor: string | null;
        created_at: Date;
      }>(
        `SELECT o.id, o.status, o.captured_amount_minor::text, o.currency,
                m.name AS merchant_name, f.id AS offer_id, f.name AS offer_name,
                o.fulfillment_reference, o.fulfillment_deadline, o.fulfilled_at,
                o.cancelled_at, o.cancellation_reason, o.refundable, o.refund_eligible_until,
                o.refunded_at, r.retained_fee_minor::text, o.created_at, a.file_name AS delivery_file_name
         FROM orders o
         JOIN payment_intents p ON p.id = o.payment_id
         JOIN merchants m ON m.id = o.merchant_id
         JOIN quotes q ON q.id = o.quote_id
         JOIN offers f ON f.id = q.offer_id
         LEFT JOIN refunds r ON r.order_id = o.id
         LEFT JOIN delivery_assets a ON a.id = o.delivery_asset_id
         WHERE p.consumer_id = $1
         ORDER BY o.created_at DESC LIMIT 50`,
        [consumerId],
      ),
      this.listTopups(consumerId),
    ]);
    return {
      sandbox: true,
      paypal: { enabled: !!this.paypal, clientId: this.paypalClientId() },
      wallet,
      policy,
      topups,
      orders: orders.rows.map((row) => ({
        ...row,
        delivery: row.status === "fulfilled" && row.delivery_file_name ? { fileName: row.delivery_file_name } : null,
        created_at: row.created_at.toISOString(),
        fulfillment_deadline: row.fulfillment_deadline?.toISOString() ?? null,
        fulfilled_at: row.fulfilled_at?.toISOString() ?? null,
        cancelled_at: row.cancelled_at?.toISOString() ?? null,
        refund_eligible_until: row.refund_eligible_until?.toISOString() ?? null,
        refunded_at: row.refunded_at?.toISOString() ?? null,
      })),
    };
  }

  async merchantDashboard(merchantId: string): Promise<Record<string, unknown>> {
    await this.reconcilePendingPayouts(merchantId);
    const [merchant, offers, orders, journal, metrics, reconciliation, payouts, webhook, outbox, payoutConfig] = await Promise.all([
      this.pool.query<{
        id: string;
        name: string;
        server_id: string;
        currency: string;
        payable_minor: string;
        pending_payable_minor: string;
        reserve_minor: string;
        payout_pending_minor: string;
        gross_sales_minor: string;
        platform_fees_minor: string;
        net_sales_minor: string;
        completed_orders: string;
        refunded_orders: string;
        refunded_amount_minor: string;
        retained_refund_fees_minor: string;
        pending_orders: string;
        cancelled_orders: string;
      }>(
        `SELECT m.id, m.name, m.server_id, m.currency,
                COALESCE((
                  SELECT sum(l.amount_minor)::text
                  FROM ledger_accounts a
                  LEFT JOIN journal_lines l ON l.account_id = a.id
                  WHERE a.owner_type = 'merchant' AND a.owner_id = m.id
                    AND a.account_type = 'payable' AND a.currency = m.currency
                ), '0') AS payable_minor,
                COALESCE((
                  SELECT sum(l.amount_minor)::text
                  FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
                  WHERE a.owner_type = 'merchant' AND a.owner_id = m.id
                    AND a.account_type = 'pending_payable' AND a.currency = m.currency
                ), '0') AS pending_payable_minor,
                COALESCE((
                  SELECT sum(l.amount_minor)::text
                  FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
                  WHERE a.owner_type = 'merchant' AND a.owner_id = m.id
                    AND a.account_type = 'reserve' AND a.currency = m.currency
                ), '0') AS reserve_minor,
                COALESCE((
                  SELECT sum(l.amount_minor)::text
                  FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
                  WHERE a.owner_type = 'merchant' AND a.owner_id = m.id
                    AND a.account_type = 'payout_pending' AND a.currency = m.currency
                ), '0') AS payout_pending_minor,
                COALESCE(sum(o.captured_amount_minor) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS gross_sales_minor,
                COALESCE(sum(o.platform_fee_minor) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS platform_fees_minor,
                (COALESCE(sum(o.captured_amount_minor - o.platform_fee_minor) FILTER (WHERE o.status <> 'cancelled'), 0) -
                  COALESCE(sum(r.refunded_amount_minor), 0))::text AS net_sales_minor,
                count(o.id) FILTER (WHERE o.status IN ('fulfilled', 'refunded'))::text AS completed_orders,
                count(r.id)::text AS refunded_orders,
                COALESCE(sum(r.refunded_amount_minor), 0)::text AS refunded_amount_minor,
                COALESCE(sum(r.retained_fee_minor), 0)::text AS retained_refund_fees_minor,
                count(o.id) FILTER (WHERE o.status IN ('confirmed', 'fulfillment_failed'))::text AS pending_orders,
                count(o.id) FILTER (WHERE o.status = 'cancelled')::text AS cancelled_orders
         FROM merchants m
         LEFT JOIN orders o ON o.merchant_id = m.id
         LEFT JOIN refunds r ON r.order_id = o.id
         WHERE m.id = $1
         GROUP BY m.id, m.name, m.currency`,
        [merchantId],
      ),
      this.listMerchantOffers(merchantId),
      this.pool.query<{
        id: string;
        status: string;
        captured_amount_minor: string;
        currency: string;
        merchant_name: string;
        offer_id: string;
        offer_name: string;
        fulfillment_reference: string | null;
        fulfillment_deadline: Date | null;
        fulfilled_at: Date | null;
        cancelled_at: Date | null;
        cancellation_reason: string | null;
        refunded_at: Date | null;
        retained_fee_minor: string | null;
        created_at: Date;
      }>(
        `SELECT o.id, o.status, o.captured_amount_minor::text, o.currency,
                m.name AS merchant_name, f.id AS offer_id, f.name AS offer_name,
                o.fulfillment_reference, o.fulfillment_deadline, o.fulfilled_at,
                o.cancelled_at, o.cancellation_reason, o.refunded_at, o.service_intake_prompt, o.service_details,
                (SELECT file_name FROM delivery_assets WHERE id = o.delivery_asset_id) AS delivery_file_name,
                r.retained_fee_minor::text, o.created_at
         FROM orders o
         JOIN merchants m ON m.id = o.merchant_id
         JOIN quotes q ON q.id = o.quote_id
         JOIN offers f ON f.id = q.offer_id
         LEFT JOIN refunds r ON r.order_id = o.id
         WHERE o.merchant_id = $1
         ORDER BY o.created_at DESC LIMIT 50`,
        [merchantId],
      ),
      this.pool.query<{ entries: string; unbalanced_entries: string }>(
        `SELECT count(*)::text AS entries,
                count(*) FILTER (WHERE balance <> 0)::text AS unbalanced_entries
         FROM (
           SELECT e.id, COALESCE(sum(l.amount_minor), 0) AS balance
           FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
           GROUP BY e.id
        ) balances`,
      ),
      this.pilotMetrics(merchantId),
      this.reconciliationReport(merchantId),
      this.pool.query<PayoutRow>("SELECT * FROM payout_batches WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 25", [merchantId]),
      this.pool.query<{ id: string; url: string; active: boolean; updated_at: Date }>(
        "SELECT id, url, active, updated_at FROM merchant_webhook_endpoints WHERE merchant_id = $1",
        [merchantId],
      ),
      this.pool.query<{ status: string; count: string }>(
        "SELECT status, count(*)::text AS count FROM outbox_events WHERE merchant_id = $1 GROUP BY status",
        [merchantId],
      ),
      this.pool.query<{ paypal_payout_email: string | null }>(
        "SELECT paypal_payout_email FROM merchant_settlement_configs WHERE merchant_id = $1",
        [merchantId],
      ),
    ]);
    return {
      sandbox: true,
      paypal: { enabled: !!this.paypal, payoutEmail: payoutConfig.rows[0]?.paypal_payout_email ?? null },
      merchant: merchant.rows[0]
        ? {
            merchantId: merchant.rows[0].id,
            name: merchant.rows[0].name,
            serverId: merchant.rows[0].server_id,
            mcpUrl: new URL(`/mcp/merchants/${merchant.rows[0].id}`, this.config.publicBaseUrl).href,
            networkMcpUrl: new URL("/mcp/commerce", this.config.publicBaseUrl).href,
            currency: merchant.rows[0].currency,
            balances: {
              pendingFulfillment: merchant.rows[0].pending_payable_minor,
              payable: merchant.rows[0].payable_minor,
              reserve: merchant.rows[0].reserve_minor,
              payoutPending: merchant.rows[0].payout_pending_minor,
            },
            totals: {
              grossSalesMinor: merchant.rows[0].gross_sales_minor,
              platformFeesMinor: merchant.rows[0].platform_fees_minor,
              netSalesMinor: merchant.rows[0].net_sales_minor,
              completedOrders: merchant.rows[0].completed_orders,
              refundedOrders: merchant.rows[0].refunded_orders,
              refundedAmountMinor: merchant.rows[0].refunded_amount_minor,
              retainedRefundFeesMinor: merchant.rows[0].retained_refund_fees_minor,
              pendingOrders: merchant.rows[0].pending_orders,
              cancelledOrders: merchant.rows[0].cancelled_orders,
            },
          }
        : null,
      offers,
      orders: orders.rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        fulfillment_deadline: row.fulfillment_deadline?.toISOString() ?? null,
        fulfilled_at: row.fulfilled_at?.toISOString() ?? null,
        cancelled_at: row.cancelled_at?.toISOString() ?? null,
        refunded_at: row.refunded_at?.toISOString() ?? null,
      })),
      ledger: journal.rows[0] ?? { entries: "0", unbalanced_entries: "0" },
      metrics,
      reconciliation,
      payouts: payouts.rows.map((row) => this.payoutResult(row)),
      webhook: webhook.rows[0]
        ? { webhookId: webhook.rows[0].id, url: webhook.rows[0].url, active: webhook.rows[0].active, updatedAt: webhook.rows[0].updated_at.toISOString() }
        : null,
      outbox: Object.fromEntries(outbox.rows.map((row) => [row.status, row.count])),
    };
  }

  async demoState(): Promise<Record<string, unknown>> {
    const [consumer, merchant] = await Promise.all([
      this.consumerDashboard(this.config.sandboxConsumerId),
      this.merchantDashboard(this.config.sandboxMerchantId),
    ]);
    return { ...consumer, ...merchant };
  }

  private async loadOrderStatus(
    queryable: pg.Pool | pg.PoolClient,
    orderId: string,
    merchantId?: string,
  ): Promise<OrderStatus> {
    const row = requireValue(
      (await queryable.query<{
        id: string;
        merchant_id: string;
        payment_id: string;
        status: "confirmed" | "fulfilled" | "fulfillment_failed" | "cancelled" | "refunded";
        captured_amount_minor: string;
        platform_fee_minor: string;
        currency: string;
        fulfillment_deadline: Date | null;
        fulfillment_reference: string | null;
        fulfilled_at: Date | null;
        cancelled_at: Date | null;
        receipt_payload: unknown | null;
        receipt_jws: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, merchant_id, payment_id, status, captured_amount_minor::text,
                platform_fee_minor::text, currency, fulfillment_deadline, fulfillment_reference,
                fulfilled_at, cancelled_at, receipt_payload, receipt_jws, created_at, updated_at
         FROM orders WHERE id = $1 AND ($2::text IS NULL OR merchant_id = $2)`,
        [orderId, merchantId ?? null],
      )).rows[0],
      "ORDER_NOT_FOUND",
      "Order was not found",
    );
    return OrderStatusSchema.parse({
      orderId: row.id,
      merchantId: row.merchant_id,
      paymentId: row.payment_id,
      status: row.status,
      capturedAmountMinor: row.captured_amount_minor,
      platformFeeMinor: row.platform_fee_minor,
      currency: row.currency,
      fulfillmentDeadline: row.fulfillment_deadline?.toISOString() ?? null,
      fulfillmentReference: row.fulfillment_reference,
      fulfilledAt: row.fulfilled_at?.toISOString() ?? null,
      cancelledAt: row.cancelled_at?.toISOString() ?? null,
      receipt: row.receipt_payload && row.receipt_jws
        ? OrderReceiptSchema.parse({ payload: row.receipt_payload, jws: row.receipt_jws })
        : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }

  private async fulfillOrderLocked(
    client: pg.PoolClient,
    input: {
      merchantId: string;
      orderId: string;
      fulfillmentReference: string;
      idempotencyKey: string;
      actorType: "merchant" | "system";
    },
  ): Promise<void> {
    const order = requireValue(
      (await client.query<{
        id: string;
        merchant_id: string;
        quote_id: string;
        mandate_id: string;
        payment_id: string;
        consumer_id: string;
        status: "confirmed" | "fulfilled" | "fulfillment_failed" | "cancelled" | "refunded";
        captured_amount_minor: string;
        platform_fee_minor: string;
        currency: string;
        refundable: boolean;
        refund_window_minutes: number | null;
        fulfillment_deadline: Date | null;
        delivery_asset_id: string | null;
        service_intake_prompt: string | null;
        service_details: string | null;
      }>(
        `SELECT o.id, o.merchant_id, o.quote_id, o.mandate_id, o.payment_id, p.consumer_id,
                o.status, o.captured_amount_minor::text, o.platform_fee_minor::text, o.currency,
                o.refundable, o.refund_window_minutes, o.fulfillment_deadline,
                o.delivery_asset_id, o.service_intake_prompt, o.service_details
         FROM orders o JOIN payment_intents p ON p.id = o.payment_id
         WHERE o.id = $1 FOR UPDATE OF o, p`,
        [input.orderId],
      )).rows[0],
      "ORDER_NOT_FOUND",
      "Order was not found",
    );
    if (order.merchant_id !== input.merchantId) throw new DomainError("ORDER_FORBIDDEN", "Order belongs to another merchant", 403);
    if (order.status === "fulfilled" || order.status === "refunded") return;
    if (order.status === "cancelled") throw new DomainError("ORDER_CANCELLED", "Cancelled orders cannot be fulfilled", 409);
    if (order.fulfillment_deadline && order.fulfillment_deadline.getTime() <= Date.now()) {
      await this.cancelOrderLocked(client, {
        orderId: order.id,
        consumerId: order.consumer_id,
        idempotencyKey: `fulfillment-timeout:${order.id}`,
        reason: "Merchant fulfillment deadline expired",
        actorType: "system",
      });
      return;
    }

    if (!order.delivery_asset_id) {
      throw new DomainError("DELIVERY_REQUIRED", "Attach the purchased file or completed service result before fulfilling this order", 409);
    }
    if (order.service_intake_prompt && !order.service_details) {
      throw new DomainError("SERVICE_DETAILS_REQUIRED", "The buyer must submit the requested service requirements before fulfillment", 409);
    }

    const accounts = await client.query<{ id: string; account_type: "pending_payable" | "payable" }>(
      `SELECT id, account_type FROM ledger_accounts
       WHERE owner_type = 'merchant' AND owner_id = $1 AND currency = $2
         AND account_type IN ('pending_payable', 'payable')
       ORDER BY id FOR UPDATE`,
      [input.merchantId, order.currency],
    );
    const accountId = (type: "pending_payable" | "payable") => requireValue(
      accounts.rows.find((account) => account.account_type === type)?.id,
      "SETTLEMENT_ACCOUNT_MISSING",
      `Merchant ${type} account is missing`,
    );
    const merchantNet = asBigInt(order.captured_amount_minor) - asBigInt(order.platform_fee_minor);
    await postJournal(client, {
      eventType: "order_fulfillment",
      idempotencyKey: `fulfillment:${order.id}`,
      referenceType: "order",
      referenceId: order.id,
      lines: [
        { accountId: accountId("pending_payable"), amountMinor: -merchantNet },
        { accountId: accountId("payable"), amountMinor: merchantNet },
      ],
    });

    const fulfilledAt = new Date();
    const refundEligibleUntil = order.refundable && order.refund_window_minutes
      ? new Date(fulfilledAt.getTime() + order.refund_window_minutes * 60_000)
      : null;
    const receiptPayload = ReceiptPayloadSchema.parse({
      schemaVersion: "2026-07-19",
      merchantId: order.merchant_id,
      orderId: order.id,
      quoteId: order.quote_id,
      mandateId: order.mandate_id,
      paymentId: order.payment_id,
      capturedAmountMinor: order.captured_amount_minor,
      currency: order.currency,
      fulfillmentStatus: "fulfilled",
      fulfillmentReference: input.fulfillmentReference,
      refundable: order.refundable,
      refundEligibleUntil: refundEligibleUntil?.toISOString() ?? null,
      createdAt: fulfilledAt.toISOString(),
    });
    const receiptJws = await signPayload(receiptPayload, this.merchantKey(input.merchantId));
    await client.query(
      `UPDATE orders SET status = 'fulfilled', fulfillment_reference = $2,
         refund_eligible_until = $3, receipt_payload = $4::jsonb, receipt_jws = $5,
         fulfilled_at = $6, updated_at = $6 WHERE id = $1`,
      [order.id, input.fulfillmentReference, refundEligibleUntil, JSON.stringify(receiptPayload), receiptJws, fulfilledAt],
    );
    await this.audit(client, order.payment_id, input.actorType, input.actorType === "merchant" ? input.merchantId : "lifecycle_worker", "order.fulfilled", "order", order.id, {
      fulfillmentReference: input.fulfillmentReference,
      idempotencyKey: input.idempotencyKey,
      refundEligibleUntil: refundEligibleUntil?.toISOString() ?? null,
    });
    await this.enqueueOutbox(client, input.merchantId, "order.fulfilled", "order", order.id, {
      orderId: order.id,
      merchantId: order.merchant_id,
      fulfillmentReference: input.fulfillmentReference,
      fulfilledAt: fulfilledAt.toISOString(),
      receipt: { payload: receiptPayload, jws: receiptJws },
    }, `order-fulfilled:${order.id}`);
  }

  private async cancelOrderLocked(
    client: pg.PoolClient,
    input: {
      orderId: string;
      consumerId: string;
      idempotencyKey: string;
      reason: string;
      actorType: "consumer" | "system";
    },
  ): Promise<void> {
    const order = requireValue(
      (await client.query<{
        id: string; payment_id: string; merchant_id: string; consumer_id: string; status: string;
        captured_amount_minor: string; platform_fee_minor: string; currency: string;
      }>(
        `SELECT o.id, o.payment_id, o.merchant_id, p.consumer_id, o.status,
                o.captured_amount_minor::text, o.platform_fee_minor::text, o.currency
         FROM orders o JOIN payment_intents p ON p.id = o.payment_id
         WHERE o.id = $1 FOR UPDATE OF o, p`,
        [input.orderId],
      )).rows[0],
      "ORDER_NOT_FOUND",
      "Order was not found",
    );
    if (order.consumer_id !== input.consumerId) throw new DomainError("ORDER_FORBIDDEN", "Order belongs to another consumer", 403);
    if (order.status === "cancelled") return;
    if (order.status !== "confirmed" && order.status !== "fulfillment_failed") {
      throw new DomainError("ORDER_NOT_CANCELLABLE", `An order in ${order.status} status cannot be cancelled; use the refund flow after fulfillment`, 409);
    }
    const accounts = await client.query<{ id: string; owner_type: string; account_type: string }>(
      `SELECT id, owner_type, account_type FROM ledger_accounts
       WHERE currency = $1 AND (
         (owner_type = 'consumer' AND owner_id = $2 AND account_type = 'available') OR
         (owner_type = 'merchant' AND owner_id = $3 AND account_type = 'pending_payable') OR
         (owner_type = 'platform' AND owner_id = 'payl' AND account_type = 'fee_revenue')
       ) ORDER BY id FOR UPDATE`,
      [order.currency, input.consumerId, order.merchant_id],
    );
    const accountId = (ownerType: string, accountType: string) => requireValue(
      accounts.rows.find((account) => account.owner_type === ownerType && account.account_type === accountType)?.id,
      "CANCELLATION_ACCOUNT_MISSING",
      `${ownerType} ${accountType} account is missing`,
    );
    const amount = asBigInt(order.captured_amount_minor);
    const fee = asBigInt(order.platform_fee_minor);
    const merchantNet = amount - fee;
    const cancellationId = newId("order_cancel");
    await postJournal(client, {
      eventType: "order_cancellation",
      idempotencyKey: `order-cancel:${order.id}`,
      referenceType: "order_cancellation",
      referenceId: cancellationId,
      lines: [
        { accountId: accountId("consumer", "available"), amountMinor: amount },
        { accountId: accountId("merchant", "pending_payable"), amountMinor: -merchantNet },
        { accountId: accountId("platform", "fee_revenue"), amountMinor: -fee },
      ].filter((line) => line.amountMinor !== 0n),
    });
    const cancelledAt = new Date();
    await client.query(
      `INSERT INTO order_cancellations(
         id, order_id, payment_id, consumer_id, merchant_id, reversed_amount_minor,
         reversed_fee_minor, reason, idempotency_key, status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'cancelled', $10)
       ON CONFLICT (order_id) DO NOTHING`,
      [cancellationId, order.id, order.payment_id, input.consumerId, order.merchant_id, amount.toString(), fee.toString(), input.reason, input.idempotencyKey, cancelledAt],
    );
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancellation_reason = $3,
         updated_at = $2 WHERE id = $1`,
      [order.id, cancelledAt, input.reason],
    );
    await client.query("UPDATE payment_intents SET status = 'cancelled', updated_at = $2 WHERE id = $1", [order.payment_id, cancelledAt]);
    await this.audit(client, order.payment_id, input.actorType, input.actorType === "consumer" ? input.consumerId : "lifecycle_worker", "order.cancelled", "order", order.id, {
      reason: input.reason,
      reversedAmountMinor: amount.toString(),
      reversedFeeMinor: fee.toString(),
    });
    await this.enqueueOutbox(client, order.merchant_id, "order.cancelled", "order", order.id, {
      orderId: order.id,
      merchantId: order.merchant_id,
      reason: input.reason,
      reversedAmountMinor: amount.toString(),
      reversedFeeMinor: fee.toString(),
      cancelledAt: cancelledAt.toISOString(),
    }, `order-cancelled:${order.id}`);
  }

  private async releaseReservationLocked(
    client: pg.PoolClient,
    payment: PaymentRow,
    outcome: "released" | "expired",
  ): Promise<void> {
    const accounts = await client.query<{ id: string; account_type: "available" | "reserved" }>(
      `SELECT id, account_type FROM ledger_accounts
       WHERE owner_type = 'consumer' AND owner_id = $1 AND currency = $2
         AND account_type IN ('available', 'reserved') ORDER BY id FOR UPDATE`,
      [payment.consumer_id, payment.currency],
    );
    const accountId = (type: "available" | "reserved") => requireValue(
      accounts.rows.find((account) => account.account_type === type)?.id,
      "WALLET_ACCOUNTS_MISSING",
      `Consumer ${type} account is missing`,
    );
    const amount = asBigInt(payment.amount_minor);
    await postJournal(client, {
      eventType: "payment_release",
      idempotencyKey: `release:${payment.id}`,
      referenceType: "payment",
      referenceId: payment.id,
      lines: [
        { accountId: accountId("reserved"), amountMinor: -amount },
        { accountId: accountId("available"), amountMinor: amount },
      ],
    });
    if (payment.mandate_id) {
      await client.query("UPDATE payment_mandates SET status = $2 WHERE id = $1 AND status = 'reserved'", [payment.mandate_id, outcome]);
    }
    await client.query("UPDATE payment_intents SET status = $2, updated_at = now() WHERE id = $1", [payment.id, outcome]);
  }

  private async enqueueOutbox(
    client: pg.PoolClient,
    merchantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: unknown,
    dedupeKey: string,
  ): Promise<void> {
    const endpoint = (await client.query<{ id: string }>(
      "SELECT id FROM merchant_webhook_endpoints WHERE merchant_id = $1 AND active = true",
      [merchantId],
    )).rows[0];
    await client.query(
      `INSERT INTO outbox_events(
         id, merchant_id, endpoint_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [newId("event"), merchantId, endpoint?.id ?? null, eventType, aggregateType, aggregateId, JSON.stringify(payload), dedupeKey],
    );
  }

  private async accountBalance(queryable: pg.Pool | pg.PoolClient, accountId: string): Promise<bigint> {
    return asBigInt((await queryable.query<{ balance: string }>(
      "SELECT COALESCE(sum(amount_minor), 0)::text AS balance FROM journal_lines WHERE account_id = $1",
      [accountId],
    )).rows[0]?.balance ?? "0");
  }

  private payoutResult(row: PayoutRow): Record<string, unknown> {
    return {
      payoutId: row.id,
      status: row.status,
      currency: row.currency,
      sourcePayableMinor: row.source_payable_minor,
      reserveHeldMinor: row.reserve_held_minor,
      paidAmountMinor: row.paid_amount_minor,
      recipientEmail: row.paypal_recipient_email,
      paypalBatchId: row.paypal_batch_id,
      paypalItemId: row.paypal_item_id,
      providerFeeMinor: row.provider_fee_minor,
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  private async loadOffer(merchantId: string, offerId: string): Promise<OfferRow> {
    return requireValue(
      (await this.pool.query<OfferRow>(
        `SELECT o.id, o.merchant_id, m.name AS merchant_name, m.server_id, o.name, o.description,
                o.price_minor::text, o.currency, o.fulfillment_method, o.refundable, o.refund_window_minutes
         FROM offers o JOIN merchants m ON m.id = o.merchant_id
         WHERE o.id = $1 AND o.merchant_id = $2 AND o.active = true AND m.status = 'active'`,
        [offerId, merchantId],
      )).rows[0],
      "OFFER_NOT_FOUND",
      "Offer was not found",
    );
  }

  private async reserveAndIssue(
    client: pg.PoolClient,
    input: {
      paymentId: string;
      quoteId: string;
      quoteHash: string;
      consumerId: string;
      agentClientId: string;
      merchantId: string;
      amount: bigint;
      currency: string;
      approvalLevel: "policy_auto" | "human_mfa";
      expiresAt: Date;
    },
  ): Promise<PaymentMandate> {
    const accounts = await client.query<{ id: string; account_type: string }>(
      `SELECT id, account_type FROM ledger_accounts
       WHERE owner_type = 'consumer' AND owner_id = $1 AND currency = $2
       ORDER BY id FOR UPDATE`,
      [input.consumerId, input.currency],
    );
    const availableId = accounts.rows.find((row) => row.account_type === "available")?.id;
    const reservedId = accounts.rows.find((row) => row.account_type === "reserved")?.id;
    if (!availableId || !reservedId) throw new DomainError("WALLET_ACCOUNTS_MISSING", "Wallet ledger accounts are missing", 500);
    const available = asBigInt(
      (await client.query<{ balance: string }>(
        "SELECT COALESCE(sum(amount_minor), 0)::text AS balance FROM journal_lines WHERE account_id = $1",
        [availableId],
      )).rows[0]?.balance ?? "0",
    );
    if (available < input.amount) throw new DomainError("INSUFFICIENT_FUNDS", "Wallet has insufficient available sandbox funds");

    await postJournal(client, {
      eventType: "payment_reservation",
      idempotencyKey: `reserve:${input.paymentId}`,
      referenceType: "payment",
      referenceId: input.paymentId,
      lines: [
        { accountId: availableId, amountMinor: -input.amount },
        { accountId: reservedId, amountMinor: input.amount },
      ],
    });

    const mandateId = newId("mandate");
    const payload = MandatePayloadSchema.parse({
      schemaVersion: "2026-07-01",
      issuer: this.config.issuer,
      mandateId,
      antiReplayId: newId("replay"),
      consumerRef: input.consumerId,
      agentClientId: input.agentClientId,
      merchantId: input.merchantId,
      quoteHash: input.quoteHash,
      maxAmountMinor: input.amount.toString(),
      currency: input.currency,
      singleUse: true,
      approvalLevel: input.approvalLevel,
      createdAt: iso(),
      expiresAt: input.expiresAt.toISOString(),
      railMode: "sandbox_ledger",
    });
    const jws = await signPayload(payload, this.paylKey);
    const mandate = PaymentMandateSchema.parse({ payload, jws });
    await client.query(
      `INSERT INTO payment_mandates(
         id, payment_id, quote_id, consumer_id, merchant_id, quote_hash, max_amount_minor,
         currency, anti_replay_id, approval_level, status, payload, jws, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'reserved', $11::jsonb, $12, $13)`,
      [
        mandateId,
        input.paymentId,
        input.quoteId,
        input.consumerId,
        input.merchantId,
        input.quoteHash,
        input.amount.toString(),
        input.currency,
        payload.antiReplayId,
        input.approvalLevel,
        JSON.stringify(payload),
        jws,
        input.expiresAt,
      ],
    );
    await client.query(
      `UPDATE payment_intents
       SET status = 'reserved', approval_level = $2, mandate_id = $3, updated_at = now()
       WHERE id = $1`,
      [input.paymentId, input.approvalLevel, mandateId],
    );
    return mandate;
  }

  private async paymentPrepareResult(client: pg.PoolClient, payment: PaymentRow): Promise<PaymentPrepareResult> {
    if (payment.status === "pending_approval") {
      const approval = requireValue(
        (await client.query<{ id: string; expires_at: Date }>("SELECT id, expires_at FROM approval_challenges WHERE payment_id = $1", [payment.id])).rows[0],
        "APPROVAL_NOT_FOUND",
        "Approval challenge was not found",
      );
      return {
        paymentId: payment.id,
        status: "pending_approval",
        approvalId: approval.id,
        approvalUrl: `${this.config.approvalWebUrl}/approve/${approval.id}`,
        expiresAt: approval.expires_at.toISOString(),
      };
    }
    if (payment.status === "reserved" && payment.mandate_id) {
      const row = requireValue(
        (await client.query<{ payload: MandatePayload; jws: string }>("SELECT payload, jws FROM payment_mandates WHERE id = $1", [payment.mandate_id])).rows[0],
        "MANDATE_NOT_FOUND",
        "Mandate was not found",
      );
      return {
        paymentId: payment.id,
        status: "reserved",
        mandate: PaymentMandateSchema.parse({ payload: row.payload, jws: row.jws }),
        expiresAt: payment.expires_at.toISOString(),
      };
    }
    throw new DomainError("PAYMENT_NOT_PREPARABLE", `Existing payment is ${payment.status}`);
  }

  private async audit(
    queryable: pg.Pool | pg.PoolClient,
    correlationId: string,
    actorType: string,
    actorId: string,
    eventType: string,
    objectType: string,
    objectId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO audit_events(
         correlation_id, actor_type, actor_id, event_type, object_type, object_id, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [correlationId, actorType, actorId, eventType, objectType, objectId, JSON.stringify(metadata)],
    );
  }
}
