"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DeliveryUpload, ServiceIntakeEditor } from "./delivery-editor";

type Offer = {
  offerId: string;
  merchantId: string;
  name: string;
  description: string;
  priceMinor: string;
  currency: string;
  fulfillmentMethod: "digital_download" | "digital_service";
  refundable: boolean;
  refundWindowMinutes: number | null;
  active: boolean;
  createdAt: string;
  deliveryFileName?: string | null;
  serviceIntakePrompt?: string | null;
};

export type MerchantState = {
  merchant: {
    merchantId: string;
    name: string;
    serverId: string;
    mcpUrl: string;
    networkMcpUrl: string;
    currency: string;
    balances: { pendingFulfillment: string; payable: string; reserve: string; payoutPending: string };
    totals: {
      grossSalesMinor: string;
      platformFeesMinor: string;
      netSalesMinor: string;
      completedOrders: string;
      refundedOrders: string;
      refundedAmountMinor: string;
      retainedRefundFeesMinor: string;
      pendingOrders: string;
      cancelledOrders: string;
    };
  } | null;
  offers: Offer[];
  orders: Array<{
    id: string;
    status: string;
    captured_amount_minor: string;
    currency: string;
    offer_id?: string;
    offer_name?: string;
    delivery_file_name?: string | null;
    service_intake_prompt?: string | null;
    service_details?: string | null;
    fulfillment_reference: string | null;
    fulfillment_deadline: string | null;
    fulfilled_at: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    refunded_at?: string | null;
    retained_fee_minor?: string | null;
    created_at: string;
  }>;
  ledger: { entries: string; unbalanced_entries: string };
  metrics: {
    funnel: { quotes: string; orders: string; quoteToOrderPercent: number; terminalSuccessPercent: number; cancelledOrders: string; refundedOrders: string; refundRatePercent: number };
    approvals: { requested: string; completed: string; medianSeconds: string | null };
    fulfillment: { pending: string; failed: string; averageSeconds: string | null };
    operations: { pending_webhooks: string; dead_webhooks: string; payouts: string; audit_coverage: string };
  };
  reconciliation: { differenceMinor: string; reconciled: boolean; expectedPositionMinor: string; actualPositionMinor: string; unbalancedJournalEntries: string };
  payouts: Array<{ payoutId: string; status: string; currency: string; sourcePayableMinor: string; reserveHeldMinor: string; paidAmountMinor: string; recipientEmail: string | null; paypalBatchId: string | null; paypalItemId: string | null; providerFeeMinor: string; createdAt: string }>;
  paypal: { enabled: boolean; payoutEmail: string | null };
  webhook: { webhookId: string; url: string; active: boolean; updatedAt: string } | null;
  outbox: Record<string, string>;
};

type Tab = "overview" | "orders" | "products" | "settlement";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "orders", label: "Orders" },
  { id: "products", label: "Products" },
  { id: "settlement", label: "Settlement" },
];

function money(amountMinor: string | undefined, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amountMinor ?? "0") / 100);
}

function minorUnits(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a product price greater than zero");
  return Math.round(amount * 100).toString();
}

function refundMinutes(refundable: boolean, value: string, unit: "hours" | "days"): number | null {
  if (!refundable) return null;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration <= 0) throw new Error("Enter a whole-number refund duration");
  const minutes = duration * (unit === "days" ? 24 * 60 : 60);
  if (minutes < 60 || minutes > 365 * 24 * 60) throw new Error("Refund window must be between 1 hour and 365 days");
  return minutes;
}

function policyDuration(minutes: number | null): { value: string; unit: "hours" | "days" } {
  if (!minutes) return { value: "7", unit: "days" };
  if (minutes && minutes % (24 * 60) === 0) return { value: String(minutes / (24 * 60)), unit: "days" };
  return { value: String(minutes / 60), unit: "hours" };
}

function refundTerms(offer: Offer): string {
  if (!offer.refundable || !offer.refundWindowMinutes) return "Non-refundable";
  const duration = policyDuration(offer.refundWindowMinutes);
  return `Refundable for ${duration.value} ${duration.unit}`;
}

function OrderTable({ state, onFulfill, fulfilling }: { state: MerchantState; onFulfill: (order: MerchantState["orders"][number]) => void; fulfilling: string | null }) {
  const router = useRouter();
  if (state.orders.length === 0) return <p className="empty">No paid orders yet. Products become orders after an AI checkout completes.</p>;
  return <div className="table">{state.orders.map((order) => <div className="row" key={order.id}>
    <div><strong>{order.offer_name ?? "Digital product"}</strong><span className="mono">{order.id}</span><small>{new Date(order.created_at).toLocaleString("en-US")}</small>
      {order.service_intake_prompt && <details><summary>Buyer requirements</summary><p>{order.service_intake_prompt}</p><p className="service-details-text">{order.service_details ?? "Waiting for the buyer to submit details in chat."}</p></details>}
      {order.status === "confirmed" && <DeliveryUpload target="orders" id={order.id} fileName={order.delivery_file_name ?? null} onSaved={() => router.refresh()} />}
      {order.status === "fulfilled" && order.delivery_file_name && <small>Delivered: {order.delivery_file_name}</small>}
    </div>
    <span>{money(order.captured_amount_minor, order.currency)}{order.status === "refunded" && <small>PAYL fee retained: {money(order.retained_fee_minor ?? "0", order.currency)}</small>}{order.status === "confirmed" && order.fulfillment_deadline && <small>Due {new Date(order.fulfillment_deadline).toLocaleString("en-US")}</small>}</span><span className={order.status === "refunded" || order.status === "cancelled" ? "complete refunded" : "complete"}>{order.status.replaceAll("_", " ")}{order.status === "confirmed" && <button className="secondary-button" type="button" disabled={fulfilling === order.id || !order.delivery_file_name || (!!order.service_intake_prompt && !order.service_details)} onClick={() => onFulfill(order)}>{fulfilling === order.id ? "Fulfilling…" : "Deliver to buyer"}</button>}</span>
  </div>)}</div>;
}

export default function MerchantDashboard({ initialState, offline }: { initialState: MerchantState; offline: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [offers, setOffers] = useState(initialState.offers ?? []);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    price: "",
    fulfillmentMethod: "digital_service" as Offer["fulfillmentMethod"],
    refundable: false,
    refundValue: "7",
    refundUnit: "days" as "hours" | "days",
  });
  const [policyDraft, setPolicyDraft] = useState<{
    offerId: string;
    name: string;
    refundable: boolean;
    refundValue: string;
    refundUnit: "hours" | "days";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [fulfilling, setFulfilling] = useState<string | null>(null);
  const [payoutWorking, setPayoutWorking] = useState(false);
  const [payoutEmail, setPayoutEmail] = useState(initialState.paypal?.payoutEmail ?? "");
  const [payoutEmailSaving, setPayoutEmailSaving] = useState(false);
  const [checkingPayout, setCheckingPayout] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState(initialState.webhook?.url ?? "");
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const currency = initialState.merchant?.currency ?? "USD";
  const merchantOwes = Number(initialState.merchant?.balances.payable ?? "0") < 0;

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/merchant/offers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          priceMinor: minorUnits(draft.price),
          fulfillmentMethod: draft.fulfillmentMethod,
          refundable: draft.refundable,
          refundWindowMinutes: refundMinutes(draft.refundable, draft.refundValue, draft.refundUnit),
        }),
      });
      const body = await response.json() as Offer & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Product could not be created");
      setOffers((current) => [body, ...current]);
      setDraft({ name: "", description: "", price: "", fulfillmentMethod: "digital_service", refundable: false, refundValue: "7", refundUnit: "days" });
      setShowCreate(false);
      setNotice({ kind: "ok", message: `${body.name} is live and discoverable through the merchant MCP.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Product could not be created" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleProduct(offer: Offer) {
    setNotice(null);
    try {
      const response = await fetch(`/api/merchant/offers/${encodeURIComponent(offer.offerId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !offer.active }),
      });
      const body = await response.json() as Offer & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Product status could not be changed");
      setOffers((current) => current.map((item) => item.offerId === body.offerId ? body : item));
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Product status could not be changed" });
    }
  }

  function editRefundPolicy(offer: Offer) {
    const duration = policyDuration(offer.refundWindowMinutes);
    setPolicyDraft({
      offerId: offer.offerId,
      name: offer.name,
      refundable: offer.refundable,
      refundValue: duration.value,
      refundUnit: duration.unit,
    });
    setNotice(null);
  }

  async function saveRefundPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyDraft) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/merchant/offers/${encodeURIComponent(policyDraft.offerId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refundable: policyDraft.refundable,
          refundWindowMinutes: refundMinutes(policyDraft.refundable, policyDraft.refundValue, policyDraft.refundUnit),
        }),
      });
      const body = await response.json() as Offer & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Refund policy could not be saved");
      setOffers((current) => current.map((item) => item.offerId === body.offerId ? body : item));
      setPolicyDraft(null);
      setNotice({ kind: "ok", message: `${body.name} now uses the updated refund policy for future quotes.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Refund policy could not be saved" });
    } finally {
      setSaving(false);
    }
  }

  async function fulfillOrder(order: MerchantState["orders"][number]) {
    const reference = `delivery_${order.id.replaceAll("-", "_")}`;
    setFulfilling(order.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/merchant/orders/${encodeURIComponent(order.id)}/fulfill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fulfillmentReference: reference, idempotencyKey: `dashboard-fulfill-${order.id}`.slice(0, 128) }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Order could not be fulfilled");
      router.refresh();
      setNotice({ kind: "ok", message: "Delivered. The buyer can now download the result in chat." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Order could not be fulfilled" });
      setFulfilling(null);
    }
  }

  async function createPayout() {
    const recipient = initialState.paypal?.payoutEmail;
    if (!recipient) { setNotice({ kind: "error", message: "Save a PayPal payout email before withdrawing." }); return; }
    if (!window.confirm(`Withdraw the full ${money(initialState.merchant?.balances.payable, currency)} payable balance to ${recipient} through PayPal Sandbox? PAYL retains 10% as merchant reserve. The withdrawal will remain pending until PayPal confirms it.`)) return;
    setPayoutWorking(true);
    setNotice(null);
    try {
      const response = await fetch("/api/merchant/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `dashboard-payout-${crypto.randomUUID()}` }),
      });
      const body = await response.json() as { error?: { message?: string }; paidAmountMinor?: string };
      if (!response.ok) throw new Error(body.error?.message ?? "Payout could not be created");
      window.location.reload();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Payout could not be created" });
      setPayoutWorking(false);
    }
  }

  async function savePayoutEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(`Use ${payoutEmail.trim()} for future PayPal Sandbox withdrawals? Existing pending withdrawals keep their original recipient.`)) return;
    setPayoutEmailSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/merchant/payout-account", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: payoutEmail.trim() }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "PayPal payout email could not be saved");
      window.location.reload();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "PayPal payout email could not be saved" });
      setPayoutEmailSaving(false);
    }
  }

  async function checkPayout(payoutId: string) {
    setCheckingPayout(payoutId);
    try {
      const response = await fetch(`/api/merchant/payouts/${encodeURIComponent(payoutId)}`, { cache: "no-store" });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Payout status could not be checked");
      window.location.reload();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Payout status could not be checked" });
      setCheckingPayout(null);
    }
  }

  async function saveWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/merchant/webhook", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      });
      const body = await response.json() as { error?: { message?: string }; signingSecret?: string };
      if (!response.ok) throw new Error(body.error?.message ?? "Webhook could not be saved");
      setNotice({ kind: "ok", message: `Webhook active. Save this signing secret now: ${body.signingSecret ?? "unavailable"}` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Webhook could not be saved" });
    } finally {
      setSaving(false);
    }
  }

  async function saveReconciliation() {
    setNotice(null);
    const response = await fetch("/api/merchant/reconciliation", { method: "POST" });
    const body = await response.json() as { reconciled?: boolean; differenceMinor?: string; error?: { message?: string } };
    if (!response.ok) {
      setNotice({ kind: "error", message: body.error?.message ?? "Reconciliation could not be generated" });
      return;
    }
    setNotice({ kind: body.reconciled ? "ok" : "error", message: body.reconciled ? "Reconciliation snapshot saved with zero difference." : `Reconciliation difference: ${body.differenceMinor ?? "unknown"} minor units.` });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function copyMcpUrl() {
    const mcpUrl = initialState.merchant?.mcpUrl;
    if (!mcpUrl) return;
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const headings: Record<Tab, [string, string]> = {
    overview: ["Merchant operations", "Agent commerce overview"],
    orders: ["Paid orders", "Orders created by AI checkout"],
    products: ["Product catalog", "What can agents buy?"],
    settlement: ["Settlement", "Merchant payable balance"],
  };

  return <main className="merchant-shell">
    <aside className="merchant-sidebar">
      <div className="brand">PAYL</div><div className="merchant-name">{initialState.merchant?.name ?? "Atlas Digital Market"}</div>
      <nav aria-label="Merchant dashboard">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
      <div className="sandbox">Sandbox merchant<br />No real settlement<button className="logout-button" type="button" onClick={() => void logout()}>Sign out</button></div>
    </aside>
    <section className="content">
      <div className="mobile-nav" aria-label="Merchant dashboard mobile navigation">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
      <header><div><p>{headings[tab][0]}</p><h1>{headings[tab][1]}</h1></div><span className={offline ? "status bad" : "status"}>{offline ? "API offline" : "System healthy"}</span></header>

      {tab === "overview" && <>
        <section className={`merchant-balance ${merchantOwes ? "liability" : ""}`}><div><span>{merchantOwes ? "Amount owed to PAYL" : "Available for settlement"}</span><strong>{money(initialState.merchant?.balances.payable, currency)}</strong><small>{merchantOwes ? "Refunded purchase plus retained PAYL fee" : "Net merchant payable balance"}</small></div><div><span>Gross AI sales</span><strong>{money(initialState.merchant?.totals.grossSalesMinor, currency)}</strong><small>Before refunds and PAYL fees</small></div></section>
        <div className="metrics"><article><span>Completed orders</span><strong>{initialState.merchant?.totals.completedOrders ?? "0"}</strong></article><article><span>Awaiting fulfillment</span><strong>{initialState.merchant?.totals.pendingOrders ?? "0"}</strong></article><article><span>Quote conversion</span><strong>{initialState.metrics?.funnel.quoteToOrderPercent ?? 0}%</strong></article><article><span>Median approval</span><strong>{initialState.metrics?.approvals.medianSeconds ? `${Number(initialState.metrics.approvals.medianSeconds).toFixed(0)}s` : "—"}</strong></article><article><span>Ledger integrity</span><strong>{initialState.reconciliation?.reconciled ? "Reconciled" : "Review"}</strong></article></div>
        <article className="mcp-card"><div><p className="eyebrow">PAYL commerce network</p><h2>Your catalog is automatically available to connected AI buyers</h2><code>{initialState.merchant?.networkMcpUrl ?? "unavailable"}</code><small>Optional direct endpoint: {initialState.merchant?.mcpUrl ?? "unavailable"} · Merchant ID: {initialState.merchant?.merchantId ?? "unavailable"}</small></div><button className="secondary-button" type="button" onClick={() => void copyMcpUrl()}>{copied ? "Copied" : "Copy direct endpoint"}</button></article>
        <article className="panel"><div className="panelhead"><h2>Latest AI orders</h2><button className="text-button" type="button" onClick={() => setTab("orders")}>View all</button></div><OrderTable state={initialState} onFulfill={(order) => void fulfillOrder(order)} fulfilling={fulfilling} /></article>
      </>}

      {tab === "orders" && <section className="orders-layout section-space">
        <article className="panel"><div className="panelhead"><div><p className="eyebrow">Fulfillment lifecycle</p><h2>Captured merchant orders</h2></div><span>{initialState.orders.length} total</span></div>{notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}<OrderTable state={initialState} onFulfill={(order) => void fulfillOrder(order)} fulfilling={fulfilling} /></article>
        <aside className="workflow-card"><p className="eyebrow">Why merchants do not type in paid orders</p><h2>Orders follow authorization</h2><p>A merchant creates products. PAYL creates the paid order only when a consumer-authorized, quote-bound mandate is committed.</p><ol><li><b>1</b><span>AI finds a product and requests a signed quote.</span></li><li><b>2</b><span>The consumer wallet applies policy and approval.</span></li><li><b>3</b><span>The merchant commits the mandate and receives the order.</span></li></ol></aside>
      </section>}

      {tab === "products" && <section className="section-space">
        <div className="section-actions"><div><p className="eyebrow">{offers.length} catalog items</p><h2>Products exposed to AI clients</h2></div><button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add product"}</button></div>
        {showCreate && <form className="product-form" onSubmit={createProduct}>
          <label><span>Product name</span><input required minLength={2} maxLength={120} placeholder="e.g. Campaign Audit" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="wide"><span>Description</span><textarea required minLength={5} maxLength={500} placeholder="Describe exactly what the buyer receives." value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label><span>Price</span><div className="money-input"><b>$</b><input required inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></div></label>
          <label><span>Fulfillment</span><select value={draft.fulfillmentMethod} onChange={(event) => setDraft({ ...draft, fulfillmentMethod: event.target.value as Offer["fulfillmentMethod"] })}><option value="digital_service">Digital service</option><option value="digital_download">Digital download</option></select></label>
          <label className="wide checkbox-field"><input type="checkbox" checked={draft.refundable} onChange={(event) => setDraft({ ...draft, refundable: event.target.checked })} /><span>Consumers can refund this product</span></label>
          {draft.refundable && <><label><span>Refund window</span><input required type="number" min="1" step="1" value={draft.refundValue} onChange={(event) => setDraft({ ...draft, refundValue: event.target.value })} /></label><label><span>Window unit</span><select value={draft.refundUnit} onChange={(event) => setDraft({ ...draft, refundUnit: event.target.value as "hours" | "days" })}><option value="hours">Hours after purchase</option><option value="days">Days after purchase</option></select></label></>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating…" : "Create product"}</button>
        </form>}
        {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
        {policyDraft && <form className="product-form policy-editor" onSubmit={saveRefundPolicy}>
          <div className="wide"><p className="eyebrow">Refund policy</p><h3>{policyDraft.name}</h3><small>Changes apply only to future signed quotes.</small></div>
          <label className="wide checkbox-field"><input type="checkbox" checked={policyDraft.refundable} onChange={(event) => setPolicyDraft({ ...policyDraft, refundable: event.target.checked })} /><span>Consumers can refund this product</span></label>
          {policyDraft.refundable && <><label><span>Refund window</span><input required type="number" min="1" step="1" value={policyDraft.refundValue} onChange={(event) => setPolicyDraft({ ...policyDraft, refundValue: event.target.value })} /></label><label><span>Window unit</span><select value={policyDraft.refundUnit} onChange={(event) => setPolicyDraft({ ...policyDraft, refundUnit: event.target.value as "hours" | "days" })}><option value="hours">Hours after purchase</option><option value="days">Days after purchase</option></select></label></>}
          <div className="form-actions wide"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save refund policy"}</button><button className="secondary-button" type="button" onClick={() => setPolicyDraft(null)}>Cancel</button></div>
        </form>}
        <div className="product-grid">{offers.map((offer) => <article className={`product-card ${offer.active ? "" : "inactive"}`} key={offer.offerId}>
          <div className="product-top"><span className={offer.active ? "product-status live" : "product-status"}>{offer.active ? "Live" : "Hidden"}</span><strong>{money(offer.priceMinor, offer.currency)}</strong></div>
          <h3>{offer.name}</h3><p>{offer.description}</p><div className={offer.refundable ? "refund-policy refundable" : "refund-policy"}>{refundTerms(offer)}</div><small>{offer.fulfillmentMethod.replaceAll("_", " ")} · <span className="mono">{offer.offerId}</span></small>
          {offer.fulfillmentMethod === "digital_download" ? <DeliveryUpload target="offers" id={offer.offerId} fileName={offer.deliveryFileName ?? null} onSaved={(fileName) => setOffers((current) => current.map((item) => item.offerId === offer.offerId ? { ...item, deliveryFileName: fileName } : item))} />
            : <ServiceIntakeEditor offerId={offer.offerId} prompt={offer.serviceIntakePrompt ?? null} onSaved={(prompt) => setOffers((current) => current.map((item) => item.offerId === offer.offerId ? { ...item, serviceIntakePrompt: prompt } : item))} />}
          <div className="product-actions"><button className="secondary-button" type="button" onClick={() => editRefundPolicy(offer)}>Edit refund policy</button><button className="secondary-button" type="button" onClick={() => void toggleProduct(offer)}>{offer.active ? "Hide from agents" : "Publish product"}</button></div>
        </article>)}</div>
      </section>}

      {tab === "settlement" && <section className="settlement-grid section-space">
        <article className={`settlement-hero ${merchantOwes ? "liability" : ""}`}><span>{merchantOwes ? "Amount owed to PAYL" : "Merchant payable"}</span><strong>{money(initialState.merchant?.balances.payable, currency)}</strong><small>{merchantOwes ? "Future sales and reserve offset this liability" : "Only fulfilled revenue is payout eligible"}</small><button className="primary-button" type="button" disabled={payoutWorking || !initialState.paypal?.enabled || !initialState.paypal?.payoutEmail || Number(initialState.merchant?.balances.payable ?? "0") <= 0} onClick={() => void createPayout()}>{payoutWorking ? "Submitting…" : "Withdraw through PayPal"}</button></article>
        <form className="panel product-form" onSubmit={savePayoutEmail}><div className="wide"><p className="eyebrow">PayPal Sandbox</p><h2>Withdrawal account</h2><small>Save a separate PayPal recipient email. PAYL snapshots it for each withdrawal.</small></div><label className="wide"><span>PayPal payout email</span><input type="email" required value={payoutEmail} onChange={(event) => setPayoutEmail(event.target.value)} placeholder="merchant-sandbox@example.com" /></label><button className="primary-button" type="submit" disabled={payoutEmailSaving || !initialState.paypal?.enabled}>{payoutEmailSaving ? "Saving…" : "Save and confirm email"}</button>{!initialState.paypal?.enabled && <small>Configure PayPal Sandbox on the API to enable withdrawals.</small>}</form>
        <article className="panel settlement-detail"><div><span>Pending fulfillment</span><strong>{money(initialState.merchant?.balances.pendingFulfillment, currency)}</strong></div><div><span>Pending PayPal withdrawal</span><strong>{money(initialState.merchant?.balances.payoutPending, currency)}</strong></div><div><span>Merchant reserve</span><strong>{money(initialState.merchant?.balances.reserve, currency)}</strong></div><div><span>Consumer refunds</span><strong>-{money(initialState.merchant?.totals.refundedAmountMinor, currency)}</strong></div><div><span>PAYL fees retained</span><strong>-{money(initialState.merchant?.totals.platformFeesMinor, currency)}</strong></div><div><span>Net sales</span><strong>{money(initialState.merchant?.totals.netSalesMinor, currency)}</strong></div></article>
        <article className="panel settlement-detail"><div><span>Expected merchant position</span><strong>{money(initialState.reconciliation?.expectedPositionMinor, currency)}</strong></div><div><span>Actual ledger position</span><strong>{money(initialState.reconciliation?.actualPositionMinor, currency)}</strong></div><div><span>Difference</span><strong>{money(initialState.reconciliation?.differenceMinor, currency)}</strong></div><div><span>Webhook queue</span><strong>{initialState.metrics?.operations.pending_webhooks ?? "0"} pending · {initialState.metrics?.operations.dead_webhooks ?? "0"} dead</strong></div><button className="secondary-button" type="button" onClick={() => void saveReconciliation()}>Save reconciliation snapshot</button></article>
        <form className="panel product-form" onSubmit={saveWebhook}><div className="wide"><p className="eyebrow">Signed operational callbacks</p><h2>Merchant webhook</h2><small>PAYL signs each JSON delivery with HMAC-SHA256 in x-payl-signature and retries failures up to eight times.</small></div><label className="wide"><span>HTTPS endpoint</span><input type="url" required placeholder="https://merchant.example/payl/events" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : initialState.webhook ? "Rotate secret and update" : "Enable webhook"}</button></form>
        {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
        <article className="panel"><div className="panelhead"><div><p className="eyebrow">Withdrawal history</p><h2>PayPal Sandbox payouts</h2></div><span>{initialState.payouts?.length ?? 0} total</span></div>{(initialState.payouts?.length ?? 0) === 0 ? <p className="empty">No withdrawals yet.</p> : <div className="table">{initialState.payouts.map((payout) => <div className="row" key={payout.payoutId}><div><strong>{payout.payoutId}</strong><small>{new Date(payout.createdAt).toLocaleString("en-US")}</small><small>To {payout.recipientEmail ?? "—"}</small>{payout.paypalBatchId && <small>PayPal batch {payout.paypalBatchId}</small>}{payout.paypalItemId && <small>PayPal item {payout.paypalItemId}</small>}</div><span>{money(payout.paidAmountMinor, payout.currency)}<small>Reserve held: {money(payout.reserveHeldMinor, payout.currency)}</small><small>PayPal fee paid by PAYL: {money(payout.providerFeeMinor, payout.currency)}</small></span><span className="complete">{payout.status}{payout.status === "pending" && <button className="secondary-button" type="button" disabled={checkingPayout === payout.payoutId} onClick={() => void checkPayout(payout.payoutId)}>{checkingPayout === payout.payoutId ? "Checking…" : "Check status"}</button>}</span></div>)}</div>}</article>
      </section>}
    </section>
  </main>;
}
