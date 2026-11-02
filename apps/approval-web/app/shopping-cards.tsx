"use client";

import { useId, useState, type FormEvent } from "react";

export type ShoppingBrief = {
  query: string; maxBudgetMinor: string | null; refundableOnly: boolean;
  fulfillmentMethod: string | null; preferences: string[]; confirmBeforePurchase: boolean;
};
export type ConsumerOrder = {
  orderId: string; offerName: string; merchantName: string; status: string; amountMinor: string; currency: string;
  fulfillmentDeadline: string | null; refundEligibleUntil: string | null; canCancel: boolean; canRefund: boolean;
  delivery: { fileName: string; downloadUrl: string } | null; serviceIntakePrompt: string | null; serviceDetails: string | null;
};
export type ChatDetails = {
  orders?: ConsumerOrder[];
  wallet?: { currency?: string; balances?: { available?: string; reserved?: string } };
  policy?: { autoApproveLimitMinor?: string; perTransactionLimitMinor?: string; dailyLimitMinor?: string };
};

function money(value: string | undefined, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value ?? "0") / 100);
}

export function ShoppingBriefCard({ brief, disabled, onReset }: { brief: ShoppingBrief | null; disabled: boolean; onReset: () => void }) {
  if (!brief || !(brief.query || brief.maxBudgetMinor || brief.refundableOnly || brief.fulfillmentMethod || brief.preferences.length || brief.confirmBeforePurchase)) return null;
  return <aside className="shopping-brief" aria-label="Saved shopping requirements">
    <div><strong>Your shopping brief</strong><button type="button" className="text-button" disabled={disabled} onClick={onReset}>Clear brief</button></div>
    <p>{[brief.query, brief.maxBudgetMinor ? `Budget: ${money(brief.maxBudgetMinor)}` : "", brief.refundableOnly ? "Refundable only" : "", brief.fulfillmentMethod?.replaceAll("_", " "), ...brief.preferences, brief.confirmBeforePurchase ? "Confirm before buying" : ""].filter(Boolean).join(" · ")}</p>
    <small>Saved for this chat. Tell me what to change.</small>
  </aside>;
}

function OrderCard({ order, disabled, onMessage, onDetails }: {
  order: ConsumerOrder; disabled: boolean; onMessage: (prompt: string) => void; onDetails: (orderId: string, details: string) => Promise<void>;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true); setError(null);
    try { await onDetails(order.orderId, draft); setDraft(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit requirements"); }
    finally { setSubmitting(false); }
  }
  return <article className="chat-order-card">
    <div className="chat-purchase-heading"><strong>{order.offerName}</strong><span>{money(order.amountMinor, order.currency)}</span></div>
    <p>{order.merchantName} · <strong>{order.status.replaceAll("_", " ")}</strong></p>
    <small className="shop-order-id">{order.orderId}</small>
    {order.status === "confirmed" && order.fulfillmentDeadline && <small>Merchant delivery due {new Date(order.fulfillmentDeadline).toLocaleString()}</small>}
    {order.delivery && <a className="primary-button" href={`/api/consumer/orders/${encodeURIComponent(order.orderId)}/download`}>Download {order.delivery.fileName}</a>}
    {order.status === "fulfilled" && !order.delivery && <small>No downloadable file was attached to this older order.</small>}
    {order.serviceDetails && <details><summary>Your submitted requirements</summary><p className="service-details-text">{order.serviceDetails}</p></details>}
    {order.status === "confirmed" && order.serviceIntakePrompt && !order.serviceDetails && <form className="service-intake" onSubmit={(event) => void submit(event)}>
      <label htmlFor={inputId}>{order.serviceIntakePrompt}</label>
      <textarea id={inputId} required minLength={3} maxLength={4000} rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Provide the details the merchant needs…" />
      <small>These details will be shared with this merchant. Check them before submitting.</small>
      <button className="primary-button" disabled={disabled || submitting || draft.trim().length < 3}>{submitting ? "Submitting…" : "Send requirements to merchant"}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <div className="chat-order-actions">
      {order.canCancel && <button className="secondary-button" disabled={disabled} onClick={() => onMessage(`Cancel order ${order.orderId}`)}>Cancel order</button>}
      {order.canRefund && <button className="secondary-button" disabled={disabled} onClick={() => onMessage(`Refund order ${order.orderId}`)}>Request refund</button>}
      <button className="text-button" disabled={disabled} onClick={() => onMessage(`Check order ${order.orderId}`)}>Refresh status</button>
    </div>
    {order.canRefund && order.refundEligibleUntil && <small>Refund available until {new Date(order.refundEligibleUntil).toLocaleString()}</small>}
  </article>;
}

export function ShoppingDetails({ details, disabled, onMessage, onDetails }: {
  details: ChatDetails | undefined; disabled: boolean; onMessage: (prompt: string) => void; onDetails: (orderId: string, details: string) => Promise<void>;
}) {
  return <>
    {details?.wallet && <article className="chat-wallet-card"><strong>Your Antspace wallet</strong>
      <dl><div><dt>Available</dt><dd>{money(details.wallet.balances?.available, details.wallet.currency)}</dd></div>
      <div><dt>Reserved</dt><dd>{money(details.wallet.balances?.reserved, details.wallet.currency)}</dd></div>
      {details.policy && <><div><dt>Automatic approval up to</dt><dd>{money(details.policy.autoApproveLimitMinor)}</dd></div>
      <div><dt>Per purchase limit</dt><dd>{money(details.policy.perTransactionLimitMinor)}</dd></div>
      <div><dt>Daily policy limit</dt><dd>{money(details.policy.dailyLimitMinor)}</dd></div></>}</dl>
      <small>Balance when checked. Antspace checks your available funds and limits again before payment.</small>
    </article>}
    {details?.orders?.map((order) => <OrderCard key={order.orderId} order={order} disabled={disabled} onMessage={onMessage} onDetails={onDetails} />)}
  </>;
}
