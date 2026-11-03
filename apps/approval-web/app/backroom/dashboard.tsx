"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Brand, Icon, StatusBadge, type IconName } from "@payl/ui";
import { dateTime, money, workerState, type Column, type Overview, type RecordRow, type RecordsResponse } from "./data";

const views = [
  { id: "overview", label: "Overview", icon: "grid", description: "A live view of your marketplace." },
  { id: "orders", label: "Orders", icon: "orders", description: "Purchases and their fulfillment status across every merchant." },
  { id: "topups", label: "Wallet funding", icon: "wallet", description: "PayPal captures, credited amounts, fees, and reversals." },
  { id: "payouts", label: "Withdrawals", icon: "settlement", description: "Merchant withdrawals, held reserves, and PayPal references." },
  { id: "consumers", label: "Shoppers", icon: "shield", description: "Registered shoppers and their available wallet balances." },
  { id: "merchants", label: "Merchants", icon: "box", description: "Businesses, live products, and earnings available for withdrawal." },
  { id: "ledger", label: "Ledger journals", icon: "wallet", description: "Balanced movements and their transaction references, grouped by currency." },
  { id: "events", label: "Audit trail", icon: "search", description: "Follow an order, payment, or account through recorded events." },
  { id: "webhooks", label: "Webhook deliveries", icon: "connect", description: "Outbound merchant notifications and delivery attempts." },
  { id: "paypal_events", label: "PayPal events", icon: "download", description: "Verified incoming PayPal events recorded by Antspace." },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName; description: string }>;
type View = typeof views[number]["id"];
const statuses: Partial<Record<View, string[]>> = {
  orders: ["confirmed", "fulfilled", "fulfillment_failed", "cancelled", "refunded"],
  topups: ["creating", "pending", "completed", "cancelled", "failed", "reversed"],
  payouts: ["pending", "paid", "failed"], consumers: ["active", "suspended"], merchants: ["active", "suspended"],
  webhooks: ["pending", "processing", "delivered", "dead"],
  ledger: ["balanced", "unbalanced"],
};
const attentionLabels: Record<string, string> = { overdue_orders: "Past fulfillment deadline", stale_payouts: "Pending longer than 30 minutes", failed_payouts: "Failed in the overview period", stale_topups: "Unfinished longer than 30 minutes" };

function useRemote<T>(path: string | null, revision: number) {
  const [result, setResult] = useState<{ path: string; data: T; updated: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (response.status === 401 || response.status === 403) { window.location.replace("/backroom/login"); return; }
        const body = await response.json() as T & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Could not load this view.");
        if (!controller.signal.aborted) setResult({ path, data: body, updated: Date.now() });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The request timed out. Please refresh.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [path, revision]);
  return { data: result?.path === path ? result.data : null, updated: result?.path === path ? result.updated : null, error, loading };
}

function valueCell(column: Column, row: RecordRow) {
  const value = row[column.key];
  if (column.format === "money") return money(value, row.currency ?? "USD");
  if (column.format === "date") return dateTime(value);
  if (column.format === "status") return <StatusBadge status={value ?? "unknown"} />;
  return value ?? "—";
}

export function BackroomDashboard({ ownerEmail, expiresAt }: { ownerEmail: string; expiresAt: string }) {
  const [view, setView] = useState<View>("overview");
  const [days, setDays] = useState("7");
  const [recordDays, setRecordDays] = useState("30");
  const [status, setStatus] = useState("");
  const [attention, setAttention] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [selected, setSelected] = useState<{ row: RecordRow; columns: Column[] } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = views.find((item) => item.id === view)!;
  const overview = useRemote<Overview>(`/api/backroom/overview?days=${days}`, revision);
  const search = new URLSearchParams({ kind: view, days: recordDays, page: String(page), status, q: query, attention, attentionDays: days });
  const records = useRemote<RecordsResponse>(view === "overview" ? null : `/api/backroom/records?${search}`, revision);
  const current = view === "overview" ? overview : records;

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") setRevision((value) => value + 1); }, 30_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);

  function navigate(next: View, filter = "", q = "", attentionFilter = "") {
    setView(next); setStatus(filter); setQuery(q); setDraftSearch(q); setPage(1); setSelected(null);
    setAttention(attentionFilter);
    setRecordDays(next === "consumers" || next === "merchants" || filter || q || attentionFilter ? "3650" : "30");
  }
  function applySearch(event: FormEvent) { event.preventDefault(); setQuery(draftSearch.trim()); setPage(1); }
  async function signOut() {
    setSigningOut(true); setLogoutError("");
    try {
      const response = await fetch("/api/backroom/logout", { method: "POST", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("Could not end the session. Please try again.");
      window.location.replace("/backroom/login");
    } catch { setLogoutError("Could not end the session. Please try again."); setSigningOut(false); }
  }

  return <div className="br-shell">
    <a href="#br-content" className="br-skip">Skip to content</a>
    <aside className="br-sidebar"><Brand light /><span className="br-workspace-name">Backroom <span>Owner</span></span>
      <nav aria-label="Backroom sections">{views.map((item, index) => <div key={item.id}>{index === 4 && <p className="br-nav-label">People</p>}{index === 6 && <p className="br-nav-label">Monitoring</p>}<button type="button" className={view === item.id ? "br-nav-active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={19} />{item.label}{item.id === "payouts" && Number(overview.data?.counts.pending_payouts) > 0 && <span className="br-nav-count">{overview.data?.counts.pending_payouts}</span>}</button></div>)}</nav>
      <div className="br-owner"><span className="br-avatar">A</span><div><strong>Platform owner</strong><span title={ownerEmail}>{ownerEmail}</span></div></div>
      <button className="br-signout" disabled={signingOut} onClick={() => void signOut()}><Icon name="logout" size={17} />{signingOut ? "Signing out…" : "Sign out"}</button>{logoutError && <p className="br-error" role="alert">{logoutError}</p>}
    </aside>
    <div className="br-workspace">
      <div className="br-topbar"><span><span className="br-environment-dot" />Sandbox operations</span><span className="br-readonly"><Icon name="shield" size={15} />Read-only access</span></div>
      <main id="br-content" className="br-content">
        <header className="br-heading"><div><span className="br-kicker">Antspace / Backroom</span><h1>{active.label}</h1><p>{active.description}</p></div><div className="br-heading-controls">
          {view === "overview" && <label className="br-period"><span className="br-sr-only">Overview period</span><select value={days} onChange={(event) => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>}
          <button className="br-button" disabled={current.loading} onClick={() => setRevision((value) => value + 1)}><Icon name="down" size={16} />{current.loading ? "Refreshing…" : "Refresh"}</button>
        </div></header>
        <div className="br-update-line"><span role="status">{current.updated ? `Updated ${dateTime(new Date(current.updated).toISOString())}` : "Waiting for data…"}{current.error && current.updated ? " · Showing last successful snapshot" : ""}</span><label><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />Refresh every 30 seconds</label></div>
        {current.error && <div className="br-error" role="alert">{current.error} <button onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
        {view === "overview" ? overview.data ? <OverviewPanels data={overview.data} navigate={navigate} stale={Boolean(overview.error)} /> : <div className="br-empty">{overview.loading ? "Loading platform activity…" : "Platform data is unavailable. Refresh to try again."}</div> : <section className="br-panel br-records">
          <form className="br-filters" onSubmit={applySearch}><label className="br-search"><Icon name="search" size={18} /><span className="br-sr-only">Search records by name, email, or reference</span><input type="search" value={draftSearch} maxLength={120} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search a name or reference…" /></label><button type="submit" className="br-button">Search</button>
            {statuses[view] && <label><span className="br-sr-only">Status filter</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statuses[view]!.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>}
            <label><span className="br-sr-only">Created date range</span><select value={recordDays} onChange={(event) => { setRecordDays(event.target.value); setPage(1); }}><option value="7">Created in 7 days</option><option value="30">Created in 30 days</option><option value="90">Created in 90 days</option><option value="3650">Created in 10 years</option></select></label>
            {(query || status || attention) && <button className="br-text-button" type="button" onClick={() => { setDraftSearch(""); setQuery(""); setStatus(""); setAttention(""); setPage(1); }}>Clear filters</button>}
          </form>
          {attention && <p className="br-attention-filter">Attention filter: {attentionLabels[attention]}{attention === "failed_payouts" ? ` (last ${days} days)` : ""}</p>}
          {records.data ? <><div className="br-table-scroll" tabIndex={0} aria-label={`${active.label} table. Scroll horizontally for more columns.`}><table className="br-table"><thead><tr>{records.data.columns.slice(0, 6).map((column) => <th scope="col" key={column.key}>{column.label}</th>)}<th scope="col">Details</th></tr></thead><tbody>{records.data.rows.map((row, index) => <tr key={`${row.id ?? index}:${row.currency ?? ""}`}>{records.data!.columns.slice(0, 6).map((column) => <td className={column.key.endsWith("minor") ? "br-amount" : ""} key={column.key} title={typeof row[column.key] === "string" ? row[column.key]! : undefined}>{valueCell(column, row)}</td>)}<td><button className="br-inspect" aria-label={`Inspect ${row.id ?? "record"}`} onClick={() => setSelected({ row, columns: records.data!.columns })}>Inspect <Icon name="chevron" size={14} /></button></td></tr>)}</tbody></table></div>
            {records.data.rows.length === 0 && <div className="br-empty"><Icon name="search" size={28} /><h2>No matching records</h2><p>Try another search, status, or date range.</p></div>}
            <footer className="br-pagination"><span>Page {page} · {records.data.rows.length} records · Times in UTC</span><div><button className="br-button" disabled={page <= 1 || records.loading} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="br-button" disabled={!records.data.hasMore || records.loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer></> : <div className="br-empty">{records.loading ? "Loading records…" : "Records could not be loaded."}</div>}
        </section>}
        <footer className="br-footer"><span>Virtual transactions · Financial positions reflect the Antspace ledger.</span><span>Session ends {dateTime(expiresAt)}</span></footer>
      </main>
    </div>
    {selected && <dialog ref={dialog} className="br-dialog" aria-labelledby="br-detail-title" onCancel={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div className="br-detail-header"><div><span className="br-kicker">{active.label}</span><h2 id="br-detail-title">Record details</h2></div><button className="br-button" autoFocus onClick={() => setSelected(null)}>Close</button></div><dl>{selected.columns.map((column) => <div key={column.key}><dt>{column.label}</dt><dd>{valueCell(column, selected.row)}</dd></div>)}</dl>{!["events", "paypal_events"].includes(view) && <button className="br-button br-button-primary" onClick={() => navigate("events", "", (view === "ledger" ? selected.row.reference_id : view === "webhooks" ? selected.row.aggregate_id : selected.row.id) ?? "")}>Find in audit trail <Icon name="arrow" size={16} /></button>}<p className="br-detail-note">Reference values can be selected and copied for investigation.</p></dialog>}
  </div>;
}

function OverviewPanels({ data, navigate, stale }: { data: Overview; navigate: (view: View, status?: string, query?: string, attention?: string) => void; stale: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const c = data.counts;
  const worker = workerState(data.health.worker, now);
  const attention = [
    { label: "Overdue deliveries", detail: "Confirmed orders past their fulfillment deadline.", count: c.overdue_orders, view: "orders" as const, status: "confirmed", filter: "overdue_orders" },
    { label: "Withdrawals pending over 30 min", detail: "Review PayPal references and provider events.", count: c.stale_payouts, view: "payouts" as const, status: "pending", filter: "stale_payouts" },
    { label: "Failed withdrawals", detail: `Failures updated in the last ${data.days} days.`, count: c.failed_payouts, view: "payouts" as const, status: "failed", filter: "failed_payouts" },
    { label: "Unfinished funding over 30 min", detail: "Includes checkouts the shopper may have abandoned.", count: c.stale_topups, view: "topups" as const, status: "", filter: "stale_topups" },
    { label: "Undelivered merchant webhooks", detail: "Deliveries that exhausted their retry attempts.", count: c.dead_webhooks, view: "webhooks" as const, status: "dead", filter: "" },
  ];
  const attentionTotal = attention.reduce((sum, item) => sum + Number(item.count ?? 0), 0) + Number(c.unbalanced_journals ?? 0);
  const max = Math.max(1, ...data.daily.flatMap((day) => [day.orders, day.signups]));
  const balances = [
    ["consumer_available", "Shopper balances"], ["consumer_reserved", "Reserved for purchases"], ["merchant_pending", "Awaiting fulfillment"], ["merchant_payable", "Merchant payable"],
    ["merchant_reserve", "Merchant reserve"], ["payout_pending", "Pending withdrawals"], ["fee_revenue", "Platform fee balance"], ["provider_fees", "Provider fee expense"],
  ];
  return <>
    <div className="br-stats">{[
      { label: "Orders", value: c.orders, detail: `Last ${data.days} days`, icon: "orders" as const, view: "orders" as const },
      { label: "Shoppers", value: c.consumers, detail: `${c.new_consumers} joined in this period`, icon: "shield" as const, view: "consumers" as const },
      { label: "Merchants", value: c.merchants, detail: `${c.products} active products`, icon: "box" as const, view: "merchants" as const },
      { label: "Pending withdrawals", value: c.pending_payouts, detail: "Awaiting a final payout result", icon: "settlement" as const, view: "payouts" as const },
    ].map((item) => <button className="br-stat" key={item.label} onClick={() => navigate(item.view, item.view === "payouts" ? "pending" : "")}><div><span>{item.label}</span><Icon name={item.icon} size={19} /></div><strong>{Number(item.value ?? 0).toLocaleString("en-US")}</strong><small>{item.detail}</small></button>)}</div>
    <div className="br-overview-grid">
      <section className="br-panel br-trend"><div className="br-panel-heading"><div><h2>Marketplace activity</h2><p>Orders and new shoppers, by UTC calendar day.</p></div><div className="br-legend"><span>Orders</span><span>Sign-ups</span></div></div>
        <div className="br-chart" role="img" aria-label={`Daily orders and sign-ups over ${data.days} days. Exact counts are available in the daily breakdown below.`}>{data.daily.map((day) => <div className="br-chart-day" key={day.day} title={`${day.day}: ${day.orders} orders, ${day.signups} sign-ups`}><div className="br-bars"><span style={{ height: `${day.orders / max * 100}%`, minHeight: day.orders ? 3 : 0 }} /><span style={{ height: `${day.signups / max * 100}%`, minHeight: day.signups ? 3 : 0 }} /></div></div>)}</div>
        <div className="br-chart-axis"><span>{data.daily[0]?.day}</span><span>{data.daily.at(-1)?.day}</span></div>
        <details className="br-daily-details"><summary>Daily breakdown</summary><div className="br-daily-scroll"><table className="br-table"><thead><tr><th>Date (UTC)</th><th>Orders</th><th>New shoppers</th></tr></thead><tbody>{data.daily.map((day) => <tr key={day.day}><td>{day.day}</td><td>{day.orders}</td><td>{day.signups}</td></tr>)}</tbody></table></div></details>
        <div className="br-ai-activity"><Icon name="sparkles" size={21} /><div><strong>{c.conversations} active AI conversations</strong><span>{c.chat_messages} shopper messages in the last {data.days} days</span></div><span className="br-subtle">Activity only</span></div>
      </section>
      <section className="br-panel br-attention"><div className="br-panel-heading"><div><h2>Needs attention</h2><p>{attentionTotal ? "Records worth a closer look." : "No flagged records in this snapshot."}</p></div><span className={`br-total ${attentionTotal ? "warning" : "success"}`}>{attentionTotal}</span></div>
        {Number(c.unbalanced_journals) > 0 && <div className="br-error"><strong>{c.unbalanced_journals} unbalanced journal groups</strong><p>Financial reconciliation needs investigation before relying on ledger totals.</p><button onClick={() => navigate("ledger", "unbalanced")}>Inspect journals</button></div>}
        <div className="br-attention-list">{attention.map((item) => <button key={item.label} onClick={() => navigate(item.view, item.status, "", item.filter)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className={Number(item.count) ? "br-attention-count flagged" : "br-attention-count"}>{item.count ?? "0"}<Icon name="chevron" size={14} /></span></button>)}</div>
      </section>
      <section className="br-panel br-balances"><div className="br-panel-heading"><div><h2>Where funds sit</h2><p>Current balances across the full ledger, grouped by currency.</p></div><Icon name="wallet" size={22} /></div>{data.balances.length ? data.balances.map((balance) => <div key={balance.currency} className="br-currency-balances"><span className="br-currency">{balance.currency}</span><dl>{balances.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{money(balance[key!], balance.currency)}</dd></div>)}</dl></div>) : <p className="br-subtle">No ledger accounts yet.</p>}<p className={`br-ledger-note ${Number(c.unbalanced_journals) ? "flagged" : ""}`}><Icon name="shield" size={16} />{Number(c.unbalanced_journals) ? "Journal balance check needs attention" : "Journal debits and credits balance by currency"}</p></section>
      <section className="br-panel br-health"><div className="br-panel-heading"><div><h2>Service signals</h2><p>Configuration and the last observed worker cycle.</p></div><Icon name="connect" size={21} /></div><dl>
        <div><dt>Database</dt><dd><span className={`br-signal ${stale ? "warning" : "success"}`}>{stale ? "Last snapshot only" : "Responding"}</span></dd></div>
        <div><dt>Background worker</dt><dd><span className={`br-signal ${stale ? "warning" : worker.tone}`}>{stale ? "Last snapshot only" : worker.label}</span></dd></div>
        <div><dt>PayPal Sandbox</dt><dd><span className="br-signal neutral">{data.health.paypal === "configured" ? "Configured" : "Not configured"}</span></dd></div>
        <div><dt>DeepSeek chat</dt><dd><span className="br-signal neutral">{data.health.ai === "configured" ? "Configured" : "Not configured"}</span></dd></div>
      </dl><p className="br-health-note">Last successful worker cycle<br /><strong>{dateTime(data.health.worker?.last_success_at)}</strong></p><div className="br-queue-note"><span><strong>{c.awaiting_delivery}</strong> orders awaiting delivery</span><span><strong>{c.pending_webhooks}</strong> merchant notifications queued</span></div><p className="br-subtle">Configured credentials do not confirm provider availability. This view does not measure AI token usage or costs.</p></section>
    </div>
  </>;
}
