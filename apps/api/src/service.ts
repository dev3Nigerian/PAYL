import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  MandatePayloadSchema,
  OrderReceiptSchema,
  PaymentMandateSchema,
  QuotePayloadSchema,
  ReceiptPayloadSchema,
  SignedQuoteSchema,
  type MandatePayload,
  type OrderReceipt,
  type PaymentMandate,
  type PaymentPrepareResult,
  type QuotePayload,
  type SignedQuote,
} from "@payl/contracts";
import {
  createDeterministicDevKey,
  sha256Hex,
  signPayload,
  verifyPayload,
  type SigningKey,
} from "@payl/crypto";
import type { Config } from "./config.js";
import { inTransaction } from "./db.js";
import { DomainError, requireValue } from "./errors.js";

type JournalLine = { accountId: string; amountMinor: bigint };

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
};

type MerchantOfferRow = OfferRow & {
  active: boolean;
  created_at: Date;
};

type PaymentRow = {
  id: string;
  quote_id: string;
  consumer_id: string;
  agent_client_id: string;
  merchant_id: string;
  amount_minor: string;
  currency: string;
  status: "pending_approval" | "reserved" | "captured" | "declined" | "released" | "expired";
  mandate_id: string | null;
  expires_at: Date;
  approval_level: "policy_auto" | "human_mfa" | null;
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

export class PaylService {
  private readonly paylKey: SigningKey;

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
  ) {
    this.paylKey = createDeterministicDevKey("payl-mandate-issuer", "payl-sandbox-2026-01");
  }

  async assertReady(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private merchantKey(merchantId: string): SigningKey {
    return createDeterministicDevKey(`merchant:${merchantId}`, `${merchantId}-sandbox-2026-01`);
  }

  async seedSandbox(): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO merchants(id, name, server_id, currency, signing_key_id, status)
         VALUES ($1, 'Atlas Digital Market', 'merchant_server_demo', 'NGN', $2, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [this.config.sandboxMerchantId, `${this.config.sandboxMerchantId}-sandbox-2026-01`],
      );
      await client.query(
        `INSERT INTO consumers(id, display_name, status)
         VALUES ($1, 'Demo Consumer', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [this.config.sandboxConsumerId],
      );
      await client.query(
        `INSERT INTO offers(id, merchant_id, name, description, price_minor, currency, fulfillment_method)
         VALUES
           ('offer_research_pack', $1, 'Market Research Pack', 'A fixed-scope digital research brief delivered immediately.', 750000, 'NGN', 'digital_download'),
           ('offer_brand_review', $1, 'AI Brand Review', 'A deterministic ten-point brand review delivered as a PDF.', 1250000, 'NGN', 'digital_service')
         ON CONFLICT (id) DO NOTHING`,
        [this.config.sandboxMerchantId],
      );
      await client.query(
        `INSERT INTO spending_policies(
           consumer_id, version, auto_approve_limit_minor, per_transaction_limit_minor, daily_limit_minor, currency
         ) VALUES ($1, 1, 500000, 5000000, 10000000, 'NGN')
         ON CONFLICT (consumer_id) DO NOTHING`,
        [this.config.sandboxConsumerId],
      );

      const accounts = [
        ["acct_consumer_available", "consumer", this.config.sandboxConsumerId, "available", "NGN"],
        ["acct_consumer_reserved", "consumer", this.config.sandboxConsumerId, "reserved", "NGN"],
        ["acct_merchant_payable", "merchant", this.config.sandboxMerchantId, "payable", "NGN"],
        ["acct_platform_clearing", "platform", "payl", "clearing", "NGN"],
        ["acct_platform_fee", "platform", "payl", "fee_revenue", "NGN"],
      ] as const;
      for (const account of accounts) {
        await client.query(
          `INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [...account],
        );
      }

      await this.postJournal(client, {
        eventType: "sandbox_funding",
        idempotencyKey: `sandbox-funding:${this.config.sandboxConsumerId}`,
        referenceType: "consumer",
        referenceId: this.config.sandboxConsumerId,
        lines: [
          { accountId: "acct_consumer_available", amountMinor: 10_000_000n },
          { accountId: "acct_platform_clearing", amountMinor: -10_000_000n },
        ],
      });
    });
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
              o.price_minor::text, o.currency, o.fulfillment_method
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
              o.price_minor::text, o.currency, o.fulfillment_method
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
    }));
  }

  async getOffer(merchantId: string, offerId: string): Promise<Record<string, unknown>> {
    const offer = await this.loadOffer(merchantId, offerId);
    return {
      offerId: offer.id,
      merchantId: offer.merchant_id,
      name: offer.name,
      description: offer.description,
      priceMinor: offer.price_minor,
      currency: offer.currency,
      fulfillmentMethod: offer.fulfillment_method,
      termsUri: "https://sandbox.payl.local/terms/digital-goods-v1",
    };
  }

  async listMerchantOffers(merchantId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<MerchantOfferRow>(
      `SELECT o.id, o.merchant_id, m.name AS merchant_name, m.server_id, o.name, o.description,
              o.price_minor::text, o.currency, o.fulfillment_method, o.active, o.created_at
       FROM offers o JOIN merchants m ON m.id = o.merchant_id
       WHERE o.merchant_id = $1
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
      active: offer.active,
      createdAt: offer.created_at.toISOString(),
    }));
  }

  async createMerchantOffer(input: {
    merchantId: string;
    name: string;
    description: string;
    priceMinor: string;
    fulfillmentMethod: "digital_download" | "digital_service";
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
      `INSERT INTO offers(id, merchant_id, name, description, price_minor, currency, fulfillment_method, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [offerId, input.merchantId, name, description, price.toString(), merchant.currency, input.fulfillmentMethod],
    );
    await this.audit(this.pool, offerId, "merchant", input.merchantId, "offer.created", "offer", offerId, {
      priceMinor: price.toString(),
      currency: merchant.currency,
    });
    return requireValue(
      (await this.listMerchantOffers(input.merchantId)).find((offer) => offer.offerId === offerId),
      "OFFER_NOT_FOUND",
      "Created product could not be loaded",
    );
  }

  async setMerchantOfferActive(merchantId: string, offerId: string, active: boolean): Promise<Record<string, unknown>> {
    const updated = (await this.pool.query<{ id: string }>(
      `UPDATE offers SET active = $3 WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [offerId, merchantId, active],
    )).rows[0];
    requireValue(updated, "OFFER_NOT_FOUND", "Product was not found");
    await this.audit(this.pool, offerId, "merchant", merchantId, active ? "offer.activated" : "offer.deactivated", "offer", offerId, {});
    return requireValue(
      (await this.listMerchantOffers(merchantId)).find((offer) => offer.offerId === offerId),
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
    const unit = asBigInt(offer.price_minor);
    const total = unit * BigInt(quantity);
    const createdAt = iso();
    const payload = QuotePayloadSchema.parse({
      schemaVersion: "2026-07-01",
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
      estimatedCompletion: "immediate",
      termsUri: "https://sandbox.payl.local/terms/digital-goods-v1",
      termsHash: sha256Hex("PAYL sandbox digital goods terms v1"),
      createdAt,
      expiresAt: futureIso(this.config.sandboxQuoteTtlMinutes * 60_000),
    });
    const jws = await signPayload(payload, this.merchantKey(merchantId));
    const signedQuote = SignedQuoteSchema.parse({ payload, jws, hash: sha256Hex(jws) });
    await this.pool.query(
      `INSERT INTO quotes(
        id, merchant_id, offer_id, nonce, total_minor, currency, payload, jws, quote_hash, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'active', $10)`,
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
      currency: "NGN",
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
        [input.consumerId, input.idempotencyKey],
      )).rows[0];
      if (existing) return this.paymentPrepareResult(client, existing);

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
           WHERE consumer_id = $1 AND status = 'captured' AND created_at >= date_trunc('day', now())`,
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
          input.idempotencyKey,
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

  async commitOrder(input: {
    merchantId: string;
    signedQuote: SignedQuote;
    mandate: PaymentMandate;
    idempotencyKey: string;
  }): Promise<OrderReceipt> {
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
      const duplicate = (await client.query<{ receipt_payload: unknown; receipt_jws: string }>(
        "SELECT receipt_payload, receipt_jws FROM orders WHERE mandate_id = $1",
        [storedMandate.id],
      )).rows[0];
      if (duplicate) return OrderReceiptSchema.parse({ payload: duplicate.receipt_payload, jws: duplicate.receipt_jws });

      if (storedMandate.jws !== mandate.jws) throw new DomainError("MANDATE_TAMPERED", "Mandate does not match the PAYL record");
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
      const fulfillmentReference = newId("fulfillment");
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
        account_type: "reserved" | "payable" | "fee_revenue";
      }>(
        `SELECT id, owner_type, owner_id, account_type
         FROM ledger_accounts
         WHERE currency = $1 AND (
           (owner_type = 'consumer' AND owner_id = $2 AND account_type = 'reserved') OR
           (owner_type = 'merchant' AND owner_id = $3 AND account_type = 'payable') OR
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

      await this.postJournal(client, {
        eventType: "payment_capture",
        idempotencyKey: `capture:${storedMandate.id}`,
        referenceType: "order",
        referenceId: orderId,
        lines: [
          { accountId: accountId("consumer", "reserved"), amountMinor: -amount },
          { accountId: accountId("merchant", "payable"), amountMinor: merchantNet },
          { accountId: accountId("platform", "fee_revenue"), amountMinor: fee },
        ].filter((line) => line.amountMinor !== 0n),
      });

      const receiptPayload = ReceiptPayloadSchema.parse({
        schemaVersion: "2026-07-01",
        merchantId: input.merchantId,
        orderId,
        quoteId: storedMandate.quote_id,
        mandateId: storedMandate.id,
        paymentId: payment.id,
        capturedAmountMinor: amount.toString(),
        currency: storedMandate.currency,
        fulfillmentStatus: "fulfilled",
        fulfillmentReference,
        refundEligibleUntil: futureIso(7 * 24 * 60 * 60_000),
        createdAt: iso(),
      });
      const receiptJws = await signPayload(receiptPayload, this.merchantKey(input.merchantId));
      const receipt = OrderReceiptSchema.parse({ payload: receiptPayload, jws: receiptJws });

      await client.query(
        `INSERT INTO orders(
           id, merchant_id, quote_id, mandate_id, payment_id, status, captured_amount_minor,
           platform_fee_minor, currency, fulfillment_reference, receipt_payload, receipt_jws
         ) VALUES ($1, $2, $3, $4, $5, 'fulfilled', $6, $7, $8, $9, $10::jsonb, $11)`,
        [
          orderId,
          input.merchantId,
          storedMandate.quote_id,
          storedMandate.id,
          payment.id,
          amount.toString(),
          fee.toString(),
          storedMandate.currency,
          fulfillmentReference,
          JSON.stringify(receiptPayload),
          receiptJws,
        ],
      );
      await client.query("UPDATE payment_mandates SET status = 'consumed', consumed_at = now() WHERE id = $1", [storedMandate.id]);
      await client.query("UPDATE payment_intents SET status = 'captured', updated_at = now() WHERE id = $1", [payment.id]);
      await client.query("UPDATE quotes SET status = 'committed' WHERE id = $1", [storedMandate.quote_id]);
      await this.audit(client, payment.id, "merchant", input.merchantId, "order.fulfilled", "order", orderId, {
        idempotencyKey: input.idempotencyKey,
        capturedAmountMinor: amount.toString(),
      });
      return receipt;
    });
  }

  async getOrder(merchantId: string, orderId: string): Promise<OrderReceipt> {
    const row = requireValue(
      (await this.pool.query<{ receipt_payload: unknown; receipt_jws: string }>(
        "SELECT receipt_payload, receipt_jws FROM orders WHERE id = $1 AND merchant_id = $2",
        [orderId, merchantId],
      )).rows[0],
      "ORDER_NOT_FOUND",
      "Order was not found",
    );
    return OrderReceiptSchema.parse({ payload: row.receipt_payload, jws: row.receipt_jws });
  }

  async consumerDashboard(consumerId: string): Promise<Record<string, unknown>> {
    const [wallet, policy, orders] = await Promise.all([
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
        fulfillment_reference: string;
        created_at: Date;
      }>(
        `SELECT o.id, o.status, o.captured_amount_minor::text, o.currency,
                m.name AS merchant_name, f.id AS offer_id, f.name AS offer_name,
                o.fulfillment_reference, o.created_at
         FROM orders o
         JOIN payment_intents p ON p.id = o.payment_id
         JOIN merchants m ON m.id = o.merchant_id
         JOIN quotes q ON q.id = o.quote_id
         JOIN offers f ON f.id = q.offer_id
         WHERE p.consumer_id = $1
         ORDER BY o.created_at DESC LIMIT 50`,
        [consumerId],
      ),
    ]);
    return {
      sandbox: true,
      wallet,
      policy,
      orders: orders.rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() })),
    };
  }

  async merchantDashboard(merchantId: string): Promise<Record<string, unknown>> {
    const [merchant, offers, orders, journal] = await Promise.all([
      this.pool.query<{
        id: string;
        name: string;
        server_id: string;
        currency: string;
        payable_minor: string;
        gross_sales_minor: string;
        platform_fees_minor: string;
        net_sales_minor: string;
        completed_orders: string;
      }>(
        `SELECT m.id, m.name, m.server_id, m.currency,
                COALESCE((
                  SELECT sum(l.amount_minor)::text
                  FROM ledger_accounts a
                  LEFT JOIN journal_lines l ON l.account_id = a.id
                  WHERE a.owner_type = 'merchant' AND a.owner_id = m.id
                    AND a.account_type = 'payable' AND a.currency = m.currency
                ), '0') AS payable_minor,
                COALESCE(sum(o.captured_amount_minor), 0)::text AS gross_sales_minor,
                COALESCE(sum(o.platform_fee_minor), 0)::text AS platform_fees_minor,
                COALESCE(sum(o.captured_amount_minor - o.platform_fee_minor), 0)::text AS net_sales_minor,
                count(o.id)::text AS completed_orders
         FROM merchants m
         LEFT JOIN orders o ON o.merchant_id = m.id AND o.status IN ('confirmed', 'fulfilled')
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
        fulfillment_reference: string;
        created_at: Date;
      }>(
        `SELECT o.id, o.status, o.captured_amount_minor::text, o.currency,
                m.name AS merchant_name, f.id AS offer_id, f.name AS offer_name,
                o.fulfillment_reference, o.created_at
         FROM orders o
         JOIN merchants m ON m.id = o.merchant_id
         JOIN quotes q ON q.id = o.quote_id
         JOIN offers f ON f.id = q.offer_id
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
    ]);
    return {
      sandbox: true,
      merchant: merchant.rows[0]
        ? {
            merchantId: merchant.rows[0].id,
            name: merchant.rows[0].name,
            serverId: merchant.rows[0].server_id,
            mcpUrl: new URL(`/mcp/merchants/${merchant.rows[0].id}`, this.config.publicBaseUrl).href,
            currency: merchant.rows[0].currency,
            balances: { payable: merchant.rows[0].payable_minor },
            totals: {
              grossSalesMinor: merchant.rows[0].gross_sales_minor,
              platformFeesMinor: merchant.rows[0].platform_fees_minor,
              netSalesMinor: merchant.rows[0].net_sales_minor,
              completedOrders: merchant.rows[0].completed_orders,
            },
          }
        : null,
      offers,
      orders: orders.rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() })),
      ledger: journal.rows[0] ?? { entries: "0", unbalanced_entries: "0" },
    };
  }

  async demoState(): Promise<Record<string, unknown>> {
    const [consumer, merchant] = await Promise.all([
      this.consumerDashboard(this.config.sandboxConsumerId),
      this.merchantDashboard(this.config.sandboxMerchantId),
    ]);
    return { ...consumer, ...merchant };
  }

  private async loadOffer(merchantId: string, offerId: string): Promise<OfferRow> {
    return requireValue(
      (await this.pool.query<OfferRow>(
        `SELECT o.id, o.merchant_id, m.name AS merchant_name, m.server_id, o.name, o.description,
                o.price_minor::text, o.currency, o.fulfillment_method
         FROM offers o JOIN merchants m ON m.id = o.merchant_id
         WHERE o.id = $1 AND o.merchant_id = $2 AND o.active = true`,
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

    await this.postJournal(client, {
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

  private async postJournal(
    client: pg.PoolClient,
    input: {
      eventType: string;
      idempotencyKey: string;
      referenceType: string;
      referenceId: string;
      lines: JournalLine[];
    },
  ): Promise<string> {
    if (input.lines.length < 2) throw new DomainError("INVALID_JOURNAL", "Journal entry needs at least two lines", 500);
    const balance = input.lines.reduce((sum, line) => sum + line.amountMinor, 0n);
    if (balance !== 0n) throw new DomainError("UNBALANCED_JOURNAL", "Journal entry must balance to zero", 500);
    const existing = (await client.query<{ id: string }>("SELECT id FROM journal_entries WHERE idempotency_key = $1", [input.idempotencyKey])).rows[0];
    if (existing) return existing.id;
    const entryId = newId("journal");
    await client.query(
      `INSERT INTO journal_entries(id, event_type, idempotency_key, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, input.eventType, input.idempotencyKey, input.referenceType, input.referenceId],
    );
    for (const line of input.lines) {
      await client.query(
        "INSERT INTO journal_lines(entry_id, account_id, amount_minor) VALUES ($1, $2, $3)",
        [entryId, line.accountId, line.amountMinor.toString()],
      );
    }
    return entryId;
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
