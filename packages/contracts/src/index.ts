import { z } from "zod";

export const IdentifierSchema = z.string().min(3).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const CurrencySchema = z.string().length(3).regex(/^[A-Z]{3}$/);
export const MinorAmountSchema = z.string().regex(/^\d+$/, "minor amount must be a non-negative integer string");

export const QuoteLineSchema = z.object({
  offerId: IdentifierSchema,
  description: z.string().min(1).max(500),
  quantity: z.number().int().positive().max(100),
  unitPriceMinor: MinorAmountSchema,
  lineTotalMinor: MinorAmountSchema,
});

const QuotePayloadBaseSchema = z.object({
  merchantId: IdentifierSchema,
  merchantServerId: IdentifierSchema,
  quoteId: IdentifierSchema,
  nonce: IdentifierSchema,
  items: z.array(QuoteLineSchema).min(1).max(25),
  subtotalMinor: MinorAmountSchema,
  discountMinor: MinorAmountSchema,
  taxMinor: MinorAmountSchema,
  feeMinor: MinorAmountSchema,
  totalMinor: MinorAmountSchema,
  currency: CurrencySchema,
  fulfillmentMethod: z.enum(["digital_download", "digital_service"]),
  estimatedCompletion: z.string().min(1).max(100),
  termsUri: z.string().url(),
  termsHash: z.string().length(64),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const RefundPolicySchema = z.discriminatedUnion("refundable", [
  z.object({
    refundable: z.literal(false),
    refundWindowMinutes: z.null(),
  }),
  z.object({
    refundable: z.literal(true),
    refundWindowMinutes: z.number().int().min(60).max(365 * 24 * 60),
  }),
]);
export type RefundPolicy = z.infer<typeof RefundPolicySchema>;

export const QuotePayloadSchema = z.discriminatedUnion("schemaVersion", [
  QuotePayloadBaseSchema.extend({ schemaVersion: z.literal("2026-07-01") }),
  QuotePayloadBaseSchema.extend({
    schemaVersion: z.literal("2026-07-19"),
    refundPolicy: RefundPolicySchema,
  }),
]);
export type QuotePayload = z.infer<typeof QuotePayloadSchema>;

export const SignedQuoteSchema = z.object({
  payload: QuotePayloadSchema,
  jws: z.string().min(20),
  hash: z.string().length(64),
});
export type SignedQuote = z.infer<typeof SignedQuoteSchema>;

export const MandatePayloadSchema = z.object({
  schemaVersion: z.literal("2026-07-01"),
  issuer: z.string().url(),
  mandateId: IdentifierSchema,
  antiReplayId: IdentifierSchema,
  consumerRef: IdentifierSchema,
  agentClientId: IdentifierSchema,
  merchantId: IdentifierSchema,
  quoteHash: z.string().length(64),
  maxAmountMinor: MinorAmountSchema,
  currency: CurrencySchema,
  singleUse: z.literal(true),
  approvalLevel: z.enum(["policy_auto", "human_mfa"]),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  railMode: z.literal("sandbox_ledger"),
});
export type MandatePayload = z.infer<typeof MandatePayloadSchema>;

export const PaymentMandateSchema = z.object({
  payload: MandatePayloadSchema,
  jws: z.string().min(20),
});
export type PaymentMandate = z.infer<typeof PaymentMandateSchema>;

const ReceiptPayloadBaseSchema = z.object({
  merchantId: IdentifierSchema,
  orderId: IdentifierSchema,
  quoteId: IdentifierSchema,
  mandateId: IdentifierSchema,
  paymentId: IdentifierSchema,
  capturedAmountMinor: MinorAmountSchema,
  currency: CurrencySchema,
  fulfillmentStatus: z.literal("fulfilled"),
  fulfillmentReference: IdentifierSchema,
  createdAt: z.string().datetime(),
});

export const ReceiptPayloadSchema = z.discriminatedUnion("schemaVersion", [
  ReceiptPayloadBaseSchema.extend({
    schemaVersion: z.literal("2026-07-01"),
    refundEligibleUntil: z.string().datetime(),
  }),
  ReceiptPayloadBaseSchema.extend({
    schemaVersion: z.literal("2026-07-19"),
    refundable: z.boolean(),
    refundEligibleUntil: z.string().datetime().nullable(),
  }),
]);
export type ReceiptPayload = z.infer<typeof ReceiptPayloadSchema>;

export const OrderReceiptSchema = z.object({
  payload: ReceiptPayloadSchema,
  jws: z.string().min(20),
});
export type OrderReceipt = z.infer<typeof OrderReceiptSchema>;

export const RefundReceiptPayloadSchema = z.object({
  schemaVersion: z.literal("2026-07-19"),
  refundId: IdentifierSchema,
  orderId: IdentifierSchema,
  paymentId: IdentifierSchema,
  consumerRef: IdentifierSchema,
  merchantId: IdentifierSchema,
  refundedAmountMinor: MinorAmountSchema,
  retainedFeeMinor: MinorAmountSchema,
  currency: CurrencySchema,
  status: z.literal("refunded"),
  reason: z.string().min(1).max(500).optional(),
  createdAt: z.string().datetime(),
});
export type RefundReceiptPayload = z.infer<typeof RefundReceiptPayloadSchema>;

export const RefundReceiptSchema = z.object({
  payload: RefundReceiptPayloadSchema,
  jws: z.string().min(20),
});
export type RefundReceipt = z.infer<typeof RefundReceiptSchema>;

export const PaymentPrepareResultSchema = z.discriminatedUnion("status", [
  z.object({
    paymentId: IdentifierSchema,
    status: z.literal("pending_approval"),
    approvalId: IdentifierSchema,
    approvalUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  }),
  z.object({
    paymentId: IdentifierSchema,
    status: z.literal("reserved"),
    mandate: PaymentMandateSchema,
    expiresAt: z.string().datetime(),
  }),
]);
export type PaymentPrepareResult = z.infer<typeof PaymentPrepareResultSchema>;

export const ToolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const JournalLineInputSchema = z.object({
  accountId: IdentifierSchema,
  amountMinor: z.bigint(),
});

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
