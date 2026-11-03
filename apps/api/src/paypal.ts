import type { Config } from "./config.js";
import { DomainError } from "./errors.js";

export type PayPalCapture = {
  orderId: string;
  captureId: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  merchantId: string | null;
  feeMinor: bigint;
  referenceId: string | null;
};

export type PayPalPayoutItem = {
  itemId: string | null;
  senderItemId: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  recipientEmail: string;
  feeMinor: bigint;
};

export type PayPalPayoutBatch = { batchId: string; status: string; items: PayPalPayoutItem[] };

export interface PayPalGateway {
  createOrder(input: { topupId: string; amountMinor: bigint }): Promise<string>;
  captureOrder(orderId: string, topupId: string): Promise<PayPalCapture | null>;
  getOrderCapture(orderId: string): Promise<PayPalCapture | null>;
  createPayout(input: { payoutId: string; amountMinor: bigint; recipientEmail: string }): Promise<string>;
  getPayoutBatch(batchId: string): Promise<PayPalPayoutBatch>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<boolean>;
}

function minor(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal returned an invalid amount", 502);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function major(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

type PayPalOrder = {
  id?: string;
  purchase_units?: Array<{
    reference_id?: string;
    payee?: { merchant_id?: string };
    payments?: { captures?: Array<{
      id?: string;
      status?: string;
      amount?: { currency_code?: string; value?: string };
      seller_receivable_breakdown?: { paypal_fee?: { currency_code?: string; value?: string } };
    }> };
  }>;
};

function captureFromOrder(order: PayPalOrder): PayPalCapture | null {
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!capture) return null;
  if (!order.id || !capture.id || !capture.status || !capture.amount?.currency_code) {
    throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal returned an incomplete capture", 502);
  }
  const captureCurrency = capture.amount.currency_code;
  const feeCurrency = capture.seller_receivable_breakdown?.paypal_fee?.currency_code;
  if (feeCurrency && feeCurrency !== captureCurrency) {
    throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal returned a capture fee in another currency", 502);
  }
  return {
    orderId: order.id,
    captureId: capture.id,
    status: capture.status,
    amountMinor: minor(capture.amount.value),
    currency: captureCurrency,
    merchantId: unit?.payee?.merchant_id ?? null,
    feeMinor: capture.seller_receivable_breakdown?.paypal_fee?.value
      ? minor(capture.seller_receivable_breakdown.paypal_fee.value)
      : 0n,
    referenceId: unit?.reference_id ?? null,
  };
}

type PayPalBatchResponse = {
  batch_header?: { payout_batch_id?: string; batch_status?: string };
  items?: Array<{
    payout_item_id?: string;
    transaction_status?: string;
    payout_item_fee?: { currency?: string; value?: string };
    payout_item?: {
      sender_item_id?: string;
      receiver?: string;
      amount?: { currency?: string; value?: string };
    };
  }>;
};

export class HttpPayPalGateway implements PayPalGateway {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly baseUrl = "https://api-m.sandbox.paypal.com";

  constructor(private readonly config: NonNullable<Config["paypal"]>) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DomainError("PAYPAL_UNAVAILABLE", "PayPal Sandbox is temporarily unavailable", 503, true);
    }
    if (!response.ok) throw new DomainError("PAYPAL_AUTH_FAILED", "PayPal Sandbox credentials or access are invalid", 503);
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal returned an invalid access token", 502);
    this.token = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown, requestId?: string): Promise<T> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(path.startsWith("/v2/checkout/orders/") && method === "POST" ? { prefer: "return=representation" } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new DomainError("PAYPAL_UNAVAILABLE", "PayPal Sandbox is temporarily unavailable", 503, true);
    }
    const payload = await response.json().catch(() => ({})) as T;
    if (!response.ok) {
      if (path === "/v1/payments/payouts" && method === "POST") {
        const duplicate = payload as {
          name?: string;
          details?: Array<{ issue?: string }>;
          links?: Array<{ href?: string; rel?: string; method?: string }>;
        };
        if (duplicate.name === "DUPLICATE_BATCH_ID" || duplicate.details?.some((detail) => detail.issue === "DUPLICATE_BATCH_ID")) {
          for (const link of duplicate.links ?? []) {
            if (link.method !== "GET" || !link.href) continue;
            let url: URL;
            try { url = new URL(link.href); } catch { continue; }
            const match = /^\/v1\/payments\/payouts\/([^/]+)$/.exec(url.pathname);
            if ([this.baseUrl, "https://api.sandbox.paypal.com"].includes(url.origin) && match?.[1]) {
              return { batch_header: { payout_batch_id: decodeURIComponent(match[1]) } } as T;
            }
          }
        }
      }
      throw new DomainError("PAYPAL_REQUEST_FAILED", `PayPal Sandbox rejected the ${method} request (${response.status})`, 502, response.status >= 500);
    }
    return payload;
  }

  async createOrder(input: { topupId: string; amountMinor: bigint }): Promise<string> {
    const result = await this.request<{ id?: string }>("/v2/checkout/orders", "POST", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: input.topupId,
        custom_id: input.topupId,
        description: "Antspace sandbox wallet funding",
        payee: { merchant_id: this.config.merchantId },
        amount: { currency_code: "USD", value: major(input.amountMinor) },
      }],
    }, `topup-create-${input.topupId}`);
    if (!result.id) throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal did not return an order ID", 502);
    return result.id;
  }

  async captureOrder(orderId: string, topupId: string): Promise<PayPalCapture | null> {
    try {
      const result = await this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, "POST", {}, `topup-capture-${topupId}`);
      return captureFromOrder(result);
    } catch (error) {
      const captured = await this.getOrderCapture(orderId).catch(() => null);
      if (captured) return captured;
      throw error;
    }
  }

  async getOrderCapture(orderId: string): Promise<PayPalCapture | null> {
    return captureFromOrder(await this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, "GET"));
  }

  async createPayout(input: { payoutId: string; amountMinor: bigint; recipientEmail: string }): Promise<string> {
    const result = await this.request<PayPalBatchResponse>("/v1/payments/payouts", "POST", {
      sender_batch_header: {
        sender_batch_id: input.payoutId,
        email_subject: "Your Antspace sandbox merchant payout",
      },
      items: [{
        recipient_type: "EMAIL",
        amount: { value: major(input.amountMinor), currency: "USD" },
        receiver: input.recipientEmail,
        sender_item_id: input.payoutId,
        note: "Antspace sandbox merchant settlement",
      }],
    }, `payout-create-${input.payoutId}`);
    const batchId = result.batch_header?.payout_batch_id;
    if (!batchId) throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal did not return a payout batch ID", 502);
    return batchId;
  }

  async getPayoutBatch(batchId: string): Promise<PayPalPayoutBatch> {
    const result = await this.request<PayPalBatchResponse>(`/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=10`, "GET");
    if (!result.batch_header?.payout_batch_id || !result.batch_header.batch_status) {
      throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal returned an incomplete payout batch", 502);
    }
    return {
      batchId: result.batch_header.payout_batch_id,
      status: result.batch_header.batch_status,
      items: (result.items ?? []).map((item) => {
        if (item.payout_item_fee?.currency && item.payout_item_fee.currency !== item.payout_item?.amount?.currency) {
          throw new DomainError("PAYPAL_INVALID_RESPONSE", "PayPal returned a payout fee in another currency", 502);
        }
        return {
        itemId: item.payout_item_id ?? null,
        senderItemId: item.payout_item?.sender_item_id ?? "",
        status: item.transaction_status ?? "PENDING",
        amountMinor: minor(item.payout_item?.amount?.value),
        currency: item.payout_item?.amount?.currency ?? "",
        recipientEmail: item.payout_item?.receiver ?? "",
        feeMinor: item.payout_item_fee?.value ? minor(item.payout_item_fee.value) : 0n,
        };
      }),
    };
  }

  async verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<boolean> {
    const value = (name: string) => {
      const header = headers[name];
      return Array.isArray(header) ? header[0] : header;
    };
    const transmissionId = value("paypal-transmission-id");
    const transmissionTime = value("paypal-transmission-time");
    const certUrl = value("paypal-cert-url");
    const authAlgo = value("paypal-auth-algo");
    const transmissionSig = value("paypal-transmission-sig");
    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return false;
    const metadata = JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: this.config.webhookId,
    });
    const body = `${metadata.slice(0, -1)},"webhook_event":${rawBody.toString("utf8")}}`;
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new DomainError("PAYPAL_UNAVAILABLE", "PayPal Sandbox is temporarily unavailable", 503, true);
    }
    if (!response.ok) throw new DomainError("PAYPAL_REQUEST_FAILED", "PayPal could not verify its webhook", 502, response.status >= 500);
    const result = await response.json() as { verification_status?: string };
    return result.verification_status === "SUCCESS";
  }
}
