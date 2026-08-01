"use client";

import { useState, type FormEvent } from "react";

export type Policy = {
  version: number;
  autoApproveLimitMinor: string;
  perTransactionLimitMinor: string;
  dailyLimitMinor: string;
  currency: string;
  humanApproval?: string;
};

export type WalletState = {
  wallet: {
    consumerRef: string;
    displayName: string;
    status: string;
    currency: string;
    balances: { available?: string; reserved?: string };
  };
  policy: Policy;
  orders: Array<{
    id: string;
    status: string;
    captured_amount_minor: string;
    currency: string;
    merchant_name: string;
    offer_name?: string;
    fulfillment_deadline: string | null;
    fulfilled_at: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    refundable: boolean;
    refund_eligible_until: string | null;
    refunded_at: string | null;
    retained_fee_minor: string | null;
    created_at: string;
  }>;
  connections: Array<{
    clientId: string;
    clientName: string;
    resource: string;
    scopes: string[];
    connectedAt: string;
  }>;
};

type Tab = "wallet" | "activity" | "permissions" | "security";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "wallet", label: "Wallet" },
  { id: "activity", label: "Activity" },
  { id: "permissions", label: "AI permissions" },
  { id: "security", label: "Security" },
];

function money(amountMinor: string | undefined, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(Number(amountMinor ?? "0") / 100);
}

function majorUnits(amountMinor: string): string {
  return (Number(amountMinor) / 100).toFixed(2);
}

function minorUnits(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid non-negative amount");
  return Math.round(amount * 100).toString();
}

function refundLabel(order: WalletState["orders"][number]): string {
  if (order.status === "confirmed") return order.fulfillment_deadline ? `Awaiting merchant fulfillment by ${new Date(order.fulfillment_deadline).toLocaleString("en-NG")}` : "Awaiting merchant fulfillment";
  if (order.status === "cancelled") return order.cancellation_reason ?? "Cancelled before fulfillment";
  if (order.status === "refunded") return `Refunded${order.refunded_at ? ` ${new Date(order.refunded_at).toLocaleString("en-NG")}` : ""}`;
  if (!order.refundable || !order.refund_eligible_until) return "Not refundable";
  if (new Date(order.refund_eligible_until).getTime() < Date.now()) return "Refund window ended";
  return `Refundable until ${new Date(order.refund_eligible_until).toLocaleString("en-NG")}`;
}

function ActivityList({
  state,
  onRefund,
  onCancel,
  refunding,
  cancelling,
}: {
  state: WalletState | null;
  onRefund: (order: WalletState["orders"][number]) => void;
  onCancel: (order: WalletState["orders"][number]) => void;
  refunding: string | null;
  cancelling: string | null;
}) {
  if (!state || state.orders.length === 0) return <p className="empty-state">No purchases yet. Connect an MCP client to create one.</p>;
  return <div className="activity-list">{state.orders.map((order) => (
    <div className="activity-row" key={order.id}>
      <div className={order.status === "refunded" || order.status === "cancelled" ? "activity-icon refunded" : "activity-icon"}>{order.status === "refunded" ? "RF" : order.status === "cancelled" ? "CX" : "AI"}</div>
      <div><strong>{order.offer_name ?? order.merchant_name}</strong><span>{order.merchant_name} · {new Date(order.created_at).toLocaleString("en-NG")}</span><small className="refund-detail">{refundLabel(order)}</small></div>
      <div className="activity-amount"><strong>{order.status === "refunded" || order.status === "cancelled" ? "+" : "-"}{money(order.captured_amount_minor, order.currency)}</strong><span>{order.status.replaceAll("_", " ")}</span>{order.status === "confirmed" && <button className="refund-button" type="button" disabled={cancelling === order.id} onClick={() => onCancel(order)}>{cancelling === order.id ? "Cancelling…" : "Cancel order"}</button>}{order.status === "fulfilled" && order.refundable && order.refund_eligible_until && new Date(order.refund_eligible_until).getTime() >= Date.now() && <button className="refund-button" type="button" disabled={refunding === order.id} onClick={() => onRefund(order)}>{refunding === order.id ? "Refunding…" : "Refund purchase"}</button>}</div>
    </div>
  ))}</div>;
}

export default function WalletDashboard({ initialState }: { initialState: WalletState | null }) {
  const [tab, setTab] = useState<Tab>("wallet");
  const [policy, setPolicy] = useState<Policy | null>(initialState?.policy ?? null);
  const [connections, setConnections] = useState(initialState?.connections ?? []);
  const [draft, setDraft] = useState(() => ({
    autoApprove: initialState ? majorUnits(initialState.policy.autoApproveLimitMinor) : "0.00",
    perTransaction: initialState ? majorUnits(initialState.policy.perTransactionLimitMinor) : "0.00",
    daily: initialState ? majorUnits(initialState.policy.dailyLimitMinor) : "0.00",
  }));
  const [saving, setSaving] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/wallet/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: policy.version,
          autoApproveLimitMinor: minorUnits(draft.autoApprove),
          perTransactionLimitMinor: minorUnits(draft.perTransaction),
          dailyLimitMinor: minorUnits(draft.daily),
        }),
      });
      const body = await response.json() as Policy & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Policy could not be saved");
      setPolicy(body);
      setNotice({ kind: "ok", message: `Policy version ${body.version} is now active for future agent payments.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Policy could not be saved" });
    } finally {
      setSaving(false);
    }
  }

  async function revokeConnection(clientId: string, resource: string) {
    setNotice(null);
    const response = await fetch("/api/oauth/grants", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, resource }),
    });
    if (!response.ok) {
      const body = await response.json() as { error?: { message?: string } };
      setNotice({ kind: "error", message: body.error?.message ?? "Connection could not be revoked" });
      return;
    }
    setConnections((current) => current.filter((connection) => connection.clientId !== clientId || connection.resource !== resource));
    setNotice({ kind: "ok", message: "AI client access was revoked immediately." });
  }

  async function refundOrder(order: WalletState["orders"][number]) {
    if (!window.confirm(`Refund ${money(order.captured_amount_minor, order.currency)} for ${order.offer_name ?? order.merchant_name}? This returns the full amount to your PAYL wallet.`)) return;
    setRefunding(order.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `dashboard-${order.id}-${crypto.randomUUID()}`.slice(0, 128),
          reason: "Consumer requested from the PAYL dashboard",
        }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Refund could not be completed");
      window.location.reload();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Refund could not be completed" });
      setRefunding(null);
    }
  }

  async function cancelOrder(order: WalletState["orders"][number]) {
    if (!window.confirm(`Cancel ${order.offer_name ?? order.merchant_name}? The full capture, including PAYL's fee, will be reversed.`)) return;
    setCancelling(order.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `dashboard-cancel-${order.id}-${crypto.randomUUID()}`.slice(0, 128),
          reason: "Consumer cancelled before merchant fulfillment",
        }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Order could not be cancelled");
      window.location.reload();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Order could not be cancelled" });
      setCancelling(null);
    }
  }

  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const body = await response.json() as { browserLogoutUrl?: string };
    window.location.assign(body.browserLogoutUrl ?? "/login");
  }

  const headings: Record<Tab, [string, string]> = {
    wallet: ["Consumer wallet", "Good to see you."],
    activity: ["Wallet activity", "Agent purchases"],
    permissions: ["AI permissions", "Set spending boundaries"],
    security: ["Wallet security", "How PAYL protects payment authority"],
  };

  return (
    <main className="dashboard-shell">
      <aside className="consumer-sidebar">
        <div className="brand brand-light">PAYL</div>
        <div className="profile-mark">DC</div>
        <strong>{initialState?.wallet.displayName ?? "Demo Consumer"}</strong>
        <span className="profile-ref">{initialState?.wallet.consumerRef ?? "consumer_demo"}</span>
        <nav className="consumer-nav" aria-label="Consumer dashboard">
          {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "nav-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>
        <div className="sandbox-note">Sandbox wallet<br />Simulated funds only<button className="logout-button" type="button" onClick={() => void logout()}>Sign out</button></div>
      </aside>

      <section className="dashboard-content">
        <div className="mobile-nav" aria-label="Consumer dashboard mobile navigation">
          {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "nav-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </div>
        <header className="dashboard-header">
          <div><p className="section-label">{headings[tab][0]}</p><h1>{headings[tab][1]}</h1></div>
          <span className={initialState ? "health-badge" : "health-badge health-bad"}>{initialState ? "Wallet active" : "API offline"}</span>
        </header>

        {tab === "wallet" && <>
          <section className="wallet-hero">
            <div><span>Available balance</span><strong>{money(initialState?.wallet.balances.available, initialState?.wallet.currency)}</strong><small>{initialState?.wallet.currency ?? "NGN"} · Sandbox ledger</small></div>
            <div className="reserved"><span>Reserved by agents</span><strong>{money(initialState?.wallet.balances.reserved, initialState?.wallet.currency)}</strong><small>Released if a mandate expires</small></div>
          </section>
          <section className="wallet-grid">
            <article className="dashboard-panel">
              <div className="panel-title"><div><p className="section-label">Recent activity</p><h2>Agent purchases</h2></div><button className="text-button" type="button" onClick={() => setTab("activity")}>View all</button></div>
              <ActivityList state={initialState} onRefund={(order) => void refundOrder(order)} onCancel={(order) => void cancelOrder(order)} refunding={refunding} cancelling={cancelling} />
            </article>
            <aside className="dashboard-panel policy-panel">
              <p className="section-label">AI spending policy</p><h2>Bounded authority</h2>
              <div className="policy-line"><span>Auto-approve up to</span><strong>{money(policy?.autoApproveLimitMinor, policy?.currency)}</strong></div>
              <div className="policy-line"><span>Per transaction</span><strong>{money(policy?.perTransactionLimitMinor, policy?.currency)}</strong></div>
              <div className="policy-line"><span>Daily limit</span><strong>{money(policy?.dailyLimitMinor, policy?.currency)}</strong></div>
              <button className="primary-button full-button" type="button" onClick={() => setTab("permissions")}>Edit policy</button>
            </aside>
          </section>
        </>}

        {tab === "activity" && <article className="dashboard-panel section-panel">
          <div className="panel-title"><div><p className="section-label">Ledger activity</p><h2>Completed purchases</h2></div><span>{initialState?.orders.length ?? 0} total</span></div>
          {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
          <ActivityList state={initialState} onRefund={(order) => void refundOrder(order)} onCancel={(order) => void cancelOrder(order)} refunding={refunding} cancelling={cancelling} />
        </article>}

        {tab === "permissions" && <><section className="settings-grid section-panel">
          <form className="dashboard-panel policy-form" onSubmit={savePolicy}>
            <p className="section-label">Effective policy · v{policy?.version ?? "—"}</p>
            <h2>Agent spending limits</h2>
            <p className="form-intro">These limits are enforced by the wallet before any funds are reserved. Changes apply to future payment requests.</p>
            <label><span>Auto-approve up to</span><div className="money-input"><b>₦</b><input aria-label="Auto-approve limit" inputMode="decimal" min="0" step="0.01" value={draft.autoApprove} onChange={(event) => setDraft({ ...draft, autoApprove: event.target.value })} /></div><small>Payments above this amount require your approval.</small></label>
            <label><span>Maximum per transaction</span><div className="money-input"><b>₦</b><input aria-label="Per-transaction limit" inputMode="decimal" min="0.01" step="0.01" value={draft.perTransaction} onChange={(event) => setDraft({ ...draft, perTransaction: event.target.value })} /></div><small>PAYL declines any single payment above this limit.</small></label>
            <label><span>Maximum per day</span><div className="money-input"><b>₦</b><input aria-label="Daily limit" inputMode="decimal" min="0.01" step="0.01" value={draft.daily} onChange={(event) => setDraft({ ...draft, daily: event.target.value })} /></div><small>Captured payments reset against this limit each day.</small></label>
            {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
            <button className="primary-button" type="submit" disabled={saving || !policy}>{saving ? "Saving…" : "Save policy"}</button>
          </form>
          <aside className="dashboard-panel policy-explainer">
            <p className="section-label">Policy hierarchy</p><h2>What happens at checkout</h2>
            <ol><li><strong>Policy check</strong><span>Currency, daily, and transaction limits are verified.</span></li><li><strong>Approval decision</strong><span>Small payments can auto-approve; larger ones wait for you.</span></li><li><strong>Bound mandate</strong><span>Authority is locked to the exact quote, amount, and merchant.</span></li></ol>
          </aside>
        </section>
        <article className="dashboard-panel connections-panel">
          <div className="panel-title"><div><p className="section-label">OAuth grants</p><h2>Connected AI clients</h2></div><span>{connections.length} active</span></div>
          {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
          {connections.length === 0 ? <p className="empty-state">No AI clients are connected. Add PAYL through an OAuth-capable MCP client to create a scoped grant.</p> : <div className="connection-list">{connections.map((connection) => <div className="connection-row" key={`${connection.clientId}:${connection.resource}`}><div><strong>{connection.clientName}</strong><span>{connection.scopes.join(" · ")}</span><small>Connected {new Date(connection.connectedAt).toLocaleString("en-NG")}</small></div><button className="secondary-button" type="button" onClick={() => void revokeConnection(connection.clientId, connection.resource)}>Revoke</button></div>)}</div>}
        </article></>}

        {tab === "security" && <section className="security-grid section-panel">
          <article className="dashboard-panel security-card"><span className="security-icon">01</span><h2>Quote-bound</h2><p>An agent cannot change the merchant, items, or amount after the merchant signs the quote.</p></article>
          <article className="dashboard-panel security-card"><span className="security-icon">02</span><h2>Single-use</h2><p>Each mandate can fund exactly one matching order and expires automatically.</p></article>
          <article className="dashboard-panel security-card"><span className="security-icon">03</span><h2>No reusable credential</h2><p>MCP clients see scoped wallet tools, never an underlying card or bank credential.</p></article>
          <article className="dashboard-panel security-card"><span className="security-icon">04</span><h2>MFA approval</h2><p>Human-approved payments require a fresh six-digit authenticator code before funds can be reserved.</p></article>
        </section>}
      </section>
    </main>
  );
}
