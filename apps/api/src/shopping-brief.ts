import { z } from "zod";

export const ShoppingBriefSchema = z.object({
  query: z.string().max(300).default(""),
  maxBudgetMinor: z.string().regex(/^\d{1,12}$/).nullable().default(null),
  refundableOnly: z.boolean().default(false),
  fulfillmentMethod: z.enum(["digital_download", "digital_service"]).nullable().default(null),
  preferences: z.array(z.string().max(200)).max(8).default([]),
  confirmBeforePurchase: z.boolean().default(false),
});
export type ShoppingBrief = z.infer<typeof ShoppingBriefSchema>;

export function budgetFromMessage(message: string): string | null {
  const match = message.match(/\b(?:under|below|less than|up to|at most|no more than|budget(?: is| of)?|maximum(?: of)?)\s*\$?(\d{1,8})(?:\.(\d{1,2}))?/i)
    ?? message.match(/\$(\d{1,8})(?:\.(\d{1,2}))?\s*(?:budget|or less|or under|maximum)/i);
  return match ? (BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))).toString() : null;
}

export function purchaseNeedsConfirmation(message: string): boolean {
  return /\b(?:if|unless|after|before|until|when|provided|assuming|except|but|not|never|wait|hold|only|maybe|might)\b|\bdon['’]t\b|\bdo not\b|\?/.test(message.toLowerCase());
}

// Financial constraints come from the consumer's words. Model memory cannot silently relax them.
export function updateBrief(previous: ShoppingBrief, message: string): ShoppingBrief {
  if (/^(?:reset|clear|forget)(?: my| the)? (?:shopping )?(?:brief|requirements|preferences)[.!]?$/i.test(message.trim())) {
    return ShoppingBriefSchema.parse({});
  }
  const brief = { ...previous, preferences: [...previous.preferences] };
  const budget = budgetFromMessage(message);
  if (budget !== null) brief.maxBudgetMinor = budget;
  if (/\b(?:remove|clear|no) (?:the |my )?(?:budget|price limit)\b/i.test(message)) brief.maxBudgetMinor = null;
  const question = /^(?:can|is|are|does|do|will|would)\b/i.test(message.trim());
  if (!question && /\brefundable\b|\bwith refunds?\b/i.test(message) && !/\bnon[- ]refundable\b/i.test(message)) brief.refundableOnly = true;
  if (/\b(?:refunds? (?:don['’]t|doesn['’]t|do not|does not) matter|non[- ]refundable is (?:fine|okay|ok)|remove (?:the )?refund requirement)\b/i.test(message)) brief.refundableOnly = false;
  if (!question) {
    if (/\bdownloads?\b/i.test(message) && !/\bservices?\b/i.test(message)) brief.fulfillmentMethod = "digital_download";
    if (/\bservices?\b/i.test(message) && !/\bdownloads?\b/i.test(message)) brief.fulfillmentMethod = "digital_service";
  }
  if (/\b(?:either|both) (?:downloads? (?:and|or) services?|type|format)s?\b/i.test(message)) brief.fulfillmentMethod = null;
  if (/\b(?:don['’]t|do not|never) (?:buy|purchase|order)|\b(?:wait|ask me|confirm with me|only after I approve)\b/i.test(message)) brief.confirmBeforePurchase = true;
  return brief;
}
