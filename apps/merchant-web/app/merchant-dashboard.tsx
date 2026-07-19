"use client";

import { useState, type FormEvent } from "react";

type Offer = {
  offerId: string;
  merchantId: string;
  name: string;
  description: string;
  priceMinor: string;
  currency: string;
  fulfillmentMethod: "digital_download" | "digital_service";
  active: boolean;
  createdAt: string;
};

export type MerchantState = {
  merchant: {
    merchantId: string;
    name: string;
    serverId: string;
    mcpUrl: string;
    currency: string;
    balances: { payable: string };
    totals: { grossSalesMinor: string; platformFeesMinor: string; netSalesMinor: string; completedOrders: string };
  } | null;
  offers: Offer[];
  orders: Array<{
    id: string;
    status: string;
    captured_amount_minor: string;
    currency: string;
    offer_id?: string;
    offer_name?: string;
    fulfillment_reference: string;
    created_at: string;
  }>;
  ledger: { entries: string; unbalanced_entries: string };
};

type Tab = "overview" | "orders" | "products" | "settlement";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "orders", label: "Orders" },
  { id: "products", label: "Products" },
  { id: "settlement", label: "Settlement" },
];

function money(amountMinor: string | undefined, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(Number(amountMinor ?? "0") / 100);
}

function minorUnits(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a product price greater than zero");
  return Math.round(amount * 100).toString();
}

function OrderTable({ state }: { state: MerchantState }) {
  if (state.orders.length === 0) return <p className="empty">No paid orders yet. Products become orders after an AI checkout completes.</p>;
  return <div className="table">{state.orders.map((order) => <div className="row" key={order.id}>
    <div><strong>{order.offer_name ?? "Digital product"}</strong><span className="mono">{order.id}</span><small>{new Date(order.created_at).toLocaleString("en-NG")}</small></div>
    <span>{money(order.captured_amount_minor, order.currency)}</span><span className="complete">{order.status}</span>
  </div>)}</div>;
}

export default function MerchantDashboard({ initialState, offline }: { initialState: MerchantState; offline: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [offers, setOffers] = useState(initialState.offers ?? []);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", price: "", fulfillmentMethod: "digital_service" as Offer["fulfillmentMethod"] });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const currency = initialState.merchant?.currency ?? "NGN";

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/merchant/offers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: draft.name, description: draft.description, priceMinor: minorUnits(draft.price), fulfillmentMethod: draft.fulfillmentMethod }),
      });
      const body = await response.json() as Offer & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Product could not be created");
      setOffers((current) => [body, ...current]);
      setDraft({ name: "", description: "", price: "", fulfillmentMethod: "digital_service" });
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
        <section className="merchant-balance"><div><span>Available for settlement</span><strong>{money(initialState.merchant?.balances.payable, currency)}</strong><small>Net merchant payable balance</small></div><div><span>Gross AI sales</span><strong>{money(initialState.merchant?.totals.grossSalesMinor, currency)}</strong><small>Before PAYL fees</small></div></section>
        <div className="metrics"><article><span>Completed orders</span><strong>{initialState.merchant?.totals.completedOrders ?? "0"}</strong></article><article><span>Active products</span><strong>{offers.filter((offer) => offer.active).length}</strong></article><article><span>Net sales</span><strong>{money(initialState.merchant?.totals.netSalesMinor, currency)}</strong></article><article><span>Ledger integrity</span><strong>{initialState.ledger.unbalanced_entries === "0" ? "Balanced" : "Review"}</strong></article></div>
        <article className="mcp-card"><div><p className="eyebrow">PAYL commerce network</p><h2>Your catalog is automatically available to connected AI buyers</h2><code>http://localhost:4100/mcp/commerce</code><small>Optional direct endpoint: {initialState.merchant?.mcpUrl ?? "unavailable"} · Merchant ID: {initialState.merchant?.merchantId ?? "unavailable"}</small></div><button className="secondary-button" type="button" onClick={() => void copyMcpUrl()}>{copied ? "Copied" : "Copy direct endpoint"}</button></article>
        <article className="panel"><div className="panelhead"><h2>Latest AI orders</h2><button className="text-button" type="button" onClick={() => setTab("orders")}>View all</button></div><OrderTable state={initialState} /></article>
      </>}

      {tab === "orders" && <section className="orders-layout section-space">
        <article className="panel"><div className="panelhead"><div><p className="eyebrow">Signed receipts</p><h2>Completed checkout orders</h2></div><span>{initialState.orders.length} total</span></div><OrderTable state={initialState} /></article>
        <aside className="workflow-card"><p className="eyebrow">Why merchants do not type in paid orders</p><h2>Orders follow authorization</h2><p>A merchant creates products. PAYL creates the paid order only when a consumer-authorized, quote-bound mandate is committed.</p><ol><li><b>1</b><span>AI finds a product and requests a signed quote.</span></li><li><b>2</b><span>The consumer wallet applies policy and approval.</span></li><li><b>3</b><span>The merchant commits the mandate and receives the order.</span></li></ol></aside>
      </section>}

      {tab === "products" && <section className="section-space">
        <div className="section-actions"><div><p className="eyebrow">{offers.length} catalog items</p><h2>Products exposed to AI clients</h2></div><button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add product"}</button></div>
        {showCreate && <form className="product-form" onSubmit={createProduct}>
          <label><span>Product name</span><input required minLength={2} maxLength={120} placeholder="e.g. Campaign Audit" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="wide"><span>Description</span><textarea required minLength={5} maxLength={500} placeholder="Describe exactly what the buyer receives." value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label><span>Price</span><div className="money-input"><b>₦</b><input required inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></div></label>
          <label><span>Fulfillment</span><select value={draft.fulfillmentMethod} onChange={(event) => setDraft({ ...draft, fulfillmentMethod: event.target.value as Offer["fulfillmentMethod"] })}><option value="digital_service">Digital service</option><option value="digital_download">Digital download</option></select></label>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating…" : "Create product"}</button>
        </form>}
        {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
        <div className="product-grid">{offers.map((offer) => <article className={`product-card ${offer.active ? "" : "inactive"}`} key={offer.offerId}>
          <div className="product-top"><span className={offer.active ? "product-status live" : "product-status"}>{offer.active ? "Live" : "Hidden"}</span><strong>{money(offer.priceMinor, offer.currency)}</strong></div>
          <h3>{offer.name}</h3><p>{offer.description}</p><small>{offer.fulfillmentMethod.replaceAll("_", " ")} · <span className="mono">{offer.offerId}</span></small>
          <button className="secondary-button" type="button" onClick={() => void toggleProduct(offer)}>{offer.active ? "Hide from agents" : "Publish product"}</button>
        </article>)}</div>
      </section>}

      {tab === "settlement" && <section className="settlement-grid section-space">
        <article className="settlement-hero"><span>Merchant payable</span><strong>{money(initialState.merchant?.balances.payable, currency)}</strong><small>Sandbox balance · no bank payout configured</small></article>
        <article className="panel settlement-detail"><div><span>Gross sales</span><strong>{money(initialState.merchant?.totals.grossSalesMinor, currency)}</strong></div><div><span>PAYL fees</span><strong>-{money(initialState.merchant?.totals.platformFeesMinor, currency)}</strong></div><div><span>Net sales</span><strong>{money(initialState.merchant?.totals.netSalesMinor, currency)}</strong></div></article>
      </section>}
    </section>
  </main>;
}
