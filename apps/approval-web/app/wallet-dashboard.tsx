"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon, StatusBadge } from "@payl/ui";
import { DashboardNavigation, useDashboardTab, type NavigationItem } from "@payl/ui/navigation";
import ShopWithAi from "./shop-with-ai";
import PayPalTopup, { type Topup } from "./paypal-topup";
import MfaSetup from "./mfa-setup";
import MyDownloads from "./my-downloads";

export type Policy = {
  version: number;
  autoApproveLimitMinor: string;
  perTransactionLimitMinor: string;
  dailyLimitMinor: string;
  currency: string;
  humanApproval?: string;
};

export type WalletState = {
  paypal: { enabled: boolean; clientId: string | null };
  topups: Topup[];
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
    delivery?: { fileName: string } | null;
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
  connections: Connection[];
};

export type Connection = {
  clientId: string;
  clientName: string;
  resource: string;
  scopes: string[];
  connectedAt: string;
};

export type McpEndpoints = { consumer: string };

type Tab = "wallet" | "shop" | "connect" | "activity" | "downloads" | "permissions" | "security";

const tabs: NavigationItem<Tab>[] = [
  { id: "shop", label: "Shop with AI", icon: "sparkles" },
  { id: "wallet", label: "My wallet", icon: "wallet" },
  { id: "activity", label: "Orders & activity", icon: "orders" },
  { id: "downloads", label: "My downloads", icon: "download" },
  { id: "permissions", label: "Spending controls", icon: "settings" },
  { id: "connect", label: "Connected AI", icon: "connect" },
  { id: "security", label: "Security", icon: "shield" },
];

function money(amountMinor: string | undefined, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amountMinor ?? "0") / 100);
}

function majorUnits(amountMinor: string): string {
  return (Number(amountMinor) / 100).toFixed(2);
}

function minorUnits(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid non-negative amount");
  return Math.round(amount * 100).toString();
}

function codexConfig(endpoint: string): string {
  return `# Antspace consumer MCP connection\n[mcp_servers.antspace]\nurl = "${endpoint}"\nenabled = true\nrequired = false\ntool_timeout_sec = 90\ndefault_tools_approval_mode = "writes"\nenabled_tools = [\n  "wallet.get_summary",\n  "wallet.get_policy",\n  "payment.prepare",\n  "payment.get_status",\n  "payment.cancel",\n  "payment.request_refund",\n  "commerce.list_merchants",\n  "commerce.search_offers",\n  "commerce.get_offer",\n  "commerce.create_quote",\n  "commerce.commit_order",\n  "commerce.get_order",\n  "commerce.cancel_order",\n]`;
}

function cursorConfig(endpoint: string): string {
  return JSON.stringify({ mcpServers: { antspace: { url: endpoint } } }, null, 2);
}

function cascadeConfig(endpoint: string): string {
  return JSON.stringify({ mcpServers: { antspace: { serverUrl: endpoint } } }, null, 2);
}

function refundLabel(order: WalletState["orders"][number]): string {
  if (order.status === "confirmed") return order.fulfillment_deadline ? `Awaiting merchant fulfillment by ${new Date(order.fulfillment_deadline).toLocaleString("en-US")}` : "Awaiting merchant fulfillment";
  if (order.status === "cancelled") return order.cancellation_reason ?? "Cancelled before fulfillment";
  if (order.status === "refunded") return `Refunded${order.refunded_at ? ` ${new Date(order.refunded_at).toLocaleString("en-US")}` : ""}`;
  if (!order.refundable || !order.refund_eligible_until) return "Not refundable";
  if (new Date(order.refund_eligible_until).getTime() < Date.now()) return "Refund window ended";
  return `Refundable until ${new Date(order.refund_eligible_until).toLocaleString("en-US")}`;
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
  if (!state || state.orders.length === 0) return <div className="empty-illustration"><Icon name="box" /><h3>Your next find starts here</h3><p>Once you make a purchase, you can follow its progress and manage it here.</p><a className="primary-button" href="#shop">Find something with AI <Icon name="arrow" size={16} /></a></div>;
  return <div className="activity-list">{state.orders.map((order) => (
    <div className="activity-row" key={order.id}>
      <div className={order.status === "refunded" || order.status === "cancelled" ? "activity-icon refunded" : "activity-icon"}>{order.status === "refunded" ? "RF" : order.status === "cancelled" ? "CX" : "AI"}</div>
      <div className="activity-product"><strong>{order.offer_name ?? order.merchant_name}</strong><span>{order.merchant_name} · {new Date(order.created_at).toLocaleString("en-US")}</span><small className="refund-detail">{refundLabel(order)}</small>
        {order.status === "fulfilled" && order.delivery && <a className="secondary-button order-download" href={`/api/consumer/orders/${encodeURIComponent(order.id)}/download`} download={order.delivery.fileName} aria-label={`Download ${order.offer_name ?? order.merchant_name} (${order.delivery.fileName})`}><Icon name="download" size={15} />Download file</a>}
        {order.status === "fulfilled" && !order.delivery && <small className="delivery-unavailable">No downloadable file attached to this order.</small>}
      </div>
      <div className="activity-amount"><strong>{order.status === "refunded" || order.status === "cancelled" ? "+" : "-"}{money(order.captured_amount_minor, order.currency)}</strong><StatusBadge status={order.status} />{order.status === "confirmed" && <button className="refund-button" type="button" disabled={cancelling === order.id} onClick={() => onCancel(order)}>{cancelling === order.id ? "Cancelling…" : "Cancel order"}</button>}{order.status === "fulfilled" && order.refundable && order.refund_eligible_until && new Date(order.refund_eligible_until).getTime() >= Date.now() && <button className="refund-button" type="button" disabled={refunding === order.id} onClick={() => onRefund(order)}>{refunding === order.id ? "Refunding…" : "Refund purchase"}</button>}</div>
    </div>
  ))}</div>;
}

function ConnectAiPanel({
  endpoint,
  connections,
  onRevoke,
}: {
  endpoint: string;
  connections: Connection[];
  onRevoke: (clientId: string, resource: string) => void;
}) {
  const [copied, setCopied] = useState<"config" | "endpoint" | "cursor" | "cascade" | null>(null);
  const config = codexConfig(endpoint);
  const cursorMcpConfig = cursorConfig(endpoint);
  const cascadeMcpConfig = cascadeConfig(endpoint);

  async function copy(value: string, kind: "config" | "endpoint" | "cursor" | "cascade") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  function downloadConfig() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([config], { type: "text/plain" }));
    link.download = "antspace-mcp.toml";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <section className="connect-layout">
    <article className="dashboard-panel connect-hero">
      <div>
        <p className="section-label">One-time setup</p>
        <h2>Connect your AI to Antspace</h2>
        <p className="form-intro">Add one Antspace connection to your MCP client. It gives your AI access to your wallet and every registered merchant without another setup for each store.</p>
        <div className="connect-actions"><button className="primary-button" type="button" onClick={() => void copy(config, "config")}>{copied === "config" ? "Copied setup" : "Copy Codex setup"}</button><button className="secondary-button" type="button" onClick={downloadConfig}>Download config</button></div>
      </div>
      <div className="connect-trust"><span className="connect-trust-icon">01</span><div><strong>Your password stays with Antspace</strong><small>OAuth opens a secure Antspace sign-in and permission screen. Your AI receives scoped tools, not your password or wallet secret.</small></div></div>
    </article>

    <article className="dashboard-panel connect-steps-panel">
      <div className="panel-title"><div><p className="section-label">How to connect</p><h2>Three simple steps</h2></div><span>{connections.length ? `${connections.length} connected` : "Not connected yet"}</span></div>
      <ol className="connect-steps"><li><strong>Add Antspace to your AI client</strong><span>In Codex, open <b>/mcp</b> or MCP settings and paste the copied setup. Other clients should add the Streamable HTTP URL below.</span></li><li><strong>Sign in and allow</strong><span>Antspace opens automatically. Sign in as the consumer, review the wallet and commerce permissions, then choose <b>Allow connection</b>.</span></li><li><strong>Start shopping</strong><span>Ask your AI to check your Antspace balance or compare offers. The same connection works across all merchants.</span></li></ol>
    </article>

    <article className="dashboard-panel connection-guides-panel">
      <div className="panel-title"><div><p className="section-label">Client guides</p><h2>Connect from your AI IDE</h2></div><span>One URL · OAuth</span></div>
      <p className="form-intro guides-intro">Choose the client you use below. Antspace uses the same connection for your wallet and every merchant, so you only authorize it once. Do not add an API key or bearer token.</p>
      <div className="connection-guides">
        <details className="connection-guide" open>
          <summary><span>Cursor</span><small>Project or global <code>mcp.json</code></small></summary>
          <div className="connection-guide-body">
            <ol className="guide-steps"><li>Open <code>.cursor/mcp.json</code> in your project, or <code>%USERPROFILE%\\.cursor\\mcp.json</code> for all projects.</li><li>Paste the JSON below, save, then reload Cursor.</li><li>Select Antspace and choose <b>Connect</b>. Sign in and choose <b>Allow and connect</b>.</li></ol>
            <div className="guide-code-title"><span>Cursor configuration</span><button className="text-button" type="button" onClick={() => void copy(cursorMcpConfig, "cursor")}>{copied === "cursor" ? "Copied" : "Copy JSON"}</button></div>
            <pre className="guide-code"><code>{cursorMcpConfig}</code></pre>
          </div>
        </details>

        <details className="connection-guide">
          <summary><span>Devin</span><small>Custom MCP server</small></summary>
          <div className="connection-guide-body">
            <ol className="guide-steps"><li>Open <b>Settings → Connections → MCP servers</b> and choose <b>Add a custom MCP</b>.</li><li>Choose <b>HTTP</b>, enter the Antspace URL below, select <b>OAuth</b>, and choose <b>Personal</b> access.</li><li>Save, choose <b>Test listing tools</b>, sign in, and choose <b>Allow and connect</b>.</li></ol>
            <div className="guide-fields"><span><b>Transport:</b> HTTP</span><span><b>Authentication:</b> OAuth</span><span><b>Access:</b> Personal</span></div>
            <code className="guide-url">{endpoint}</code>
          </div>
        </details>

        <details className="connection-guide">
          <summary><span>Windsurf / Cascade</span><small><code>mcp_config.json</code></small></summary>
          <div className="connection-guide-body">
            <ol className="guide-steps"><li>Open your Cascade MCP configuration file.</li><li>Paste the JSON below and save.</li><li>Restart Windsurf/Cascade, select Antspace, then complete the OAuth login and consent.</li></ol>
            <div className="guide-code-title"><span>Cascade configuration</span><button className="text-button" type="button" onClick={() => void copy(cascadeMcpConfig, "cascade")}>{copied === "cascade" ? "Copied" : "Copy JSON"}</button></div>
            <pre className="guide-code"><code>{cascadeMcpConfig}</code></pre>
          </div>
        </details>

        <details className="connection-guide">
          <summary><span>Claude</span><small>Claude, Claude Desktop, or Claude Code</small></summary>
          <div className="connection-guide-body">
            <p className="guide-subtitle">Claude web or Claude Desktop</p>
            <ol className="guide-steps"><li>Open <b>Customize → Connectors</b>, click <b>+</b>, then choose <b>Add custom connector</b>.</li><li>Enter <b>Antspace</b> and the URL below. Leave OAuth client ID and secret empty.</li><li>Click <b>Add</b>, then <b>Connect</b>. Enable Antspace from the chat <b>+</b> menu.</li></ol>
            <p className="guide-subtitle">Claude Code</p>
            <pre className="guide-code"><code>{`claude mcp add --transport http antspace ${endpoint}`}</code></pre>
            <p className="guide-note">Then run <code>/mcp</code>, select Antspace, and complete the browser OAuth flow. Use Claude’s Connectors settings for remote Antspace; do not put this hosted URL in <code>claude_desktop_config.json</code>.</p>
          </div>
        </details>

        <details className="connection-guide">
          <summary><span>Any other MCP client</span><small>Remote Streamable HTTP</small></summary>
          <div className="connection-guide-body">
            <ol className="guide-steps"><li>Add a new remote MCP server using <b>Streamable HTTP</b>.</li><li>Paste the Antspace URL below and choose <b>OAuth</b> authentication.</li><li>Sign in as the consumer and choose <b>Allow and connect</b> when Antspace displays the permission screen.</li></ol>
            <code className="guide-url">{endpoint}</code>
          </div>
        </details>
      </div>
    </article>

    <article className="dashboard-panel endpoint-panel">
      <div className="panel-title"><div><p className="section-label">Streamable HTTP</p><h2>Antspace connection URL</h2></div><button className="secondary-button" type="button" onClick={() => void copy(endpoint, "endpoint")}>{copied === "endpoint" ? "Copied" : "Copy URL"}</button></div>
      <code className="endpoint-value">{endpoint}</code>
      <p className="form-intro endpoint-help">Use this single URL for both wallet and commerce. OAuth discovery is automatic; you do not need to paste a client ID, secret, or merchant URL.</p>
    </article>

    <article className="dashboard-panel connection-status-panel">
      <div className="panel-title"><div><p className="section-label">Access control</p><h2>Connected AI clients</h2></div><span>{connections.length} active</span></div>
      {connections.length === 0 ? <p className="empty-state">No AI client has been authorized yet. Add the URL above to begin.</p> : <div className="connection-list">{connections.map((connection) => <div className="connection-row" key={`${connection.clientId}:${connection.resource}`}><div><strong>{connection.clientName}</strong><span>{connection.scopes.join(" · ")}</span><small>Connected {new Date(connection.connectedAt).toLocaleString("en-US")}</small></div><button className="secondary-button" type="button" onClick={() => onRevoke(connection.clientId, connection.resource)}>Revoke</button></div>)}</div>}
    </article>
  </section>;
}

export default function WalletDashboard({ initialState, mcpEndpoints, merchantUrl }: { initialState: WalletState | null; mcpEndpoints: McpEndpoints; merchantUrl: string }) {
  const [tab, setTab] = useDashboardTab(tabs, "shop");
  const router = useRouter();
  const [refreshingOrders, startRefresh] = useTransition();
  useEffect(() => {
    if (tab === "activity") startRefresh(() => router.refresh());
  }, [tab, router]);
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
    if (!window.confirm(`Refund ${money(order.captured_amount_minor, order.currency)} for ${order.offer_name ?? order.merchant_name}? This returns the full amount to your Antspace wallet.`)) return;
    setRefunding(order.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `dashboard-${order.id}-${crypto.randomUUID()}`.slice(0, 128),
          reason: "Consumer requested from the Antspace dashboard",
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
    if (!window.confirm(`Cancel ${order.offer_name ?? order.merchant_name}? The full capture, including Antspace's fee, will be reversed.`)) return;
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
    if (!response.ok) throw new Error("Sign-out failed");
    const body = await response.json() as { browserLogoutUrl?: string };
    window.location.assign(body.browserLogoutUrl ?? "/login");
  }

  const headings: Record<Tab, [string, string]> = {
    wallet: ["Your money, your move", "My wallet"],
    shop: ["Your personal shopping companion", "A good find starts here."],
    connect: ["Bring your own assistant", "Connected AI"],
    activity: ["Every purchase, in one place", "Orders & activity"],
    downloads: ["Good finds, ready to use", "My downloads"],
    permissions: ["A little autonomy. A lot of control.", "Your spending rules"],
    security: ["Built around your control", "Wallet security"],
  };

  return (
    <div className="dashboard-shell">
      <DashboardNavigation items={tabs} tab={tab} role="consumer" name={initialState?.wallet.displayName ?? "Your account"} homeHref="/" switchHref={merchantUrl} onLogout={logout} />
      <main className="dashboard-content" data-section={tab} id="dashboard-main" tabIndex={-1}>
        <header className="dashboard-header">
          <div><p className="section-label">{headings[tab][0]}</p><h1>{headings[tab][1]}</h1></div>
          <div className="header-actions"><div className="header-balance"><small>Available · Sandbox USD</small><strong>{initialState ? money(initialState.wallet.balances.available, initialState.wallet.currency) : "Unavailable"}</strong></div><button className="secondary-button" type="button" onClick={() => setTab("wallet")}><Icon name="plus" size={16} /> Add funds</button></div>
        </header>
        {!initialState && <div className="offline-banner" role="alert">Your wallet is temporarily unavailable. Please reconnect before shopping or adding funds.<button className="text-button" type="button" onClick={() => window.location.reload()}>Try again</button></div>}
        {notice && tab !== "permissions" && tab !== "activity" && <p role="status" className={`form-notice ${notice.kind}`}>{notice.message}</p>}

        {tab === "wallet" && <>
          <section className="wallet-hero">
            <div><span>Available balance</span><strong>{money(initialState?.wallet.balances.available, initialState?.wallet.currency)}</strong><small>{initialState?.wallet.currency ?? "USD"} · Sandbox ledger</small></div>
            <div className="reserved"><span>Reserved by agents</span><strong>{money(initialState?.wallet.balances.reserved, initialState?.wallet.currency)}</strong><small>Released if a mandate expires</small></div>
          </section>
          <PayPalTopup clientId={initialState?.paypal.clientId ?? null} topups={initialState?.topups ?? []} offline={!initialState} />
          <section className="wallet-grid">
            <article className="dashboard-panel">
              <div className="panel-title"><div><p className="section-label">Recent activity</p><h2>Agent purchases</h2></div><button className="text-button" type="button" onClick={() => setTab("activity")}>View all</button></div>
              <ActivityList state={initialState} onRefund={(order) => void refundOrder(order)} onCancel={(order) => void cancelOrder(order)} refunding={refunding} cancelling={cancelling} />
            </article>
            <aside className="dashboard-panel policy-panel">
              <p className="section-label">Your safety net</p><h2>Spending controls</h2>
              <div className="policy-line"><span>Auto-approve up to</span><strong>{money(policy?.autoApproveLimitMinor, policy?.currency)}</strong></div>
              <div className="policy-line"><span>Per transaction</span><strong>{money(policy?.perTransactionLimitMinor, policy?.currency)}</strong></div>
              <div className="policy-line"><span>Daily limit</span><strong>{money(policy?.dailyLimitMinor, policy?.currency)}</strong></div>
              <button className="primary-button full-button" type="button" onClick={() => setTab("permissions")}>Edit policy</button>
            </aside>
          </section>
          <article className="dashboard-panel connect-callout"><div><p className="section-label">Shop your way</p><h2>Explore Antspace with AI</h2><p>Chat here to compare live offers and review a purchase, or connect your own AI client through MCP.</p></div><div className="connect-actions"><button className="primary-button" type="button" onClick={() => setTab("shop")}>Open AI chat</button><button className="secondary-button" type="button" onClick={() => setTab("connect")}>Connect an AI client</button></div></article>
        </>}

        {tab === "shop" && <ShopWithAi consumerRef={initialState?.wallet.consumerRef ?? "consumer_demo"} offline={!initialState} onAddFunds={() => setTab("wallet")} />}

        {tab === "downloads" && <MyDownloads />}

        {tab === "connect" && <ConnectAiPanel endpoint={mcpEndpoints.consumer} connections={connections} onRevoke={(clientId, resource) => void revokeConnection(clientId, resource)} />}

        {tab === "activity" && <article className="dashboard-panel section-panel">
          <div className="panel-title orders-heading"><div><p className="section-label">Your purchase history</p><h2>Recent orders</h2></div><div className="orders-toolbar"><a className="secondary-button" href="#downloads"><Icon name="download" size={16} />My downloads</a><button className="text-button" type="button" disabled={refreshingOrders} onClick={() => startRefresh(() => router.refresh())}>{refreshingOrders ? "Refreshing…" : "Refresh orders"}</button></div></div>
          <p className="orders-help">Ready files can be downloaded below. Find older downloads in <a href="#downloads">My downloads</a>.</p>
          {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
          <ActivityList state={initialState} onRefund={(order) => void refundOrder(order)} onCancel={(order) => void cancelOrder(order)} refunding={refunding} cancelling={cancelling} />
          <div className="paypal-topup-history"><h3>PayPal funding</h3>
            {(initialState?.topups.length ?? 0) === 0 ? <p className="empty-state">No PayPal top-ups yet.</p> : initialState?.topups.map((topup) => <div className="paypal-topup-row" key={topup.topupId}><div><strong>{money(topup.amountMinor, topup.currency)}</strong><span>{topup.status.replaceAll("_", " ")} · {new Date(topup.createdAt).toLocaleString("en-US")}</span>{topup.paypalCaptureId && <small>PayPal capture {topup.paypalCaptureId}</small>}{Number(topup.reversedAmountMinor) > 0 && <small>Reversed: {money(topup.reversedAmountMinor, topup.currency)}</small>}{Number(topup.providerFeeMinor) > 0 && <small>PayPal fee paid by Antspace: {money(topup.providerFeeMinor, topup.currency)}</small>}</div></div>)}
          </div>
        </article>}

        {tab === "permissions" && <><section className="settings-grid section-panel">
          <form className="dashboard-panel policy-form" onSubmit={savePolicy}>
            <p className="section-label">Effective policy · v{policy?.version ?? "—"}</p>
            <h2>Agent spending limits</h2>
            <p className="form-intro">These limits are enforced by the wallet before any funds are reserved. Changes apply to future payment requests.</p>
            <label><span>Auto-approve up to</span><div className="money-input"><b>$</b><input aria-label="Auto-approve limit" inputMode="decimal" min="0" step="0.01" value={draft.autoApprove} onChange={(event) => setDraft({ ...draft, autoApprove: event.target.value })} /></div><small>Payments above this amount require your approval.</small></label>
            <label><span>Maximum per transaction</span><div className="money-input"><b>$</b><input aria-label="Per-transaction limit" inputMode="decimal" min="0.01" step="0.01" value={draft.perTransaction} onChange={(event) => setDraft({ ...draft, perTransaction: event.target.value })} /></div><small>Antspace declines any single payment above this limit.</small></label>
            <label><span>Maximum per day</span><div className="money-input"><b>$</b><input aria-label="Daily limit" inputMode="decimal" min="0.01" step="0.01" value={draft.daily} onChange={(event) => setDraft({ ...draft, daily: event.target.value })} /></div><small>Captured payments reset against this limit each day.</small></label>
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
          {connections.length === 0 ? <p className="empty-state">No AI clients are connected. Add Antspace through an OAuth-capable MCP client to create a scoped grant.</p> : <div className="connection-list">{connections.map((connection) => <div className="connection-row" key={`${connection.clientId}:${connection.resource}`}><div><strong>{connection.clientName}</strong><span>{connection.scopes.join(" · ")}</span><small>Connected {new Date(connection.connectedAt).toLocaleString("en-US")}</small></div><button className="secondary-button" type="button" onClick={() => void revokeConnection(connection.clientId, connection.resource)}>Revoke</button></div>)}</div>}
        </article></>}

        {tab === "security" && <section className="security-grid section-panel">
          <MfaSetup />
          <article className="dashboard-panel security-card"><span className="security-icon">01</span><h2>Quote-bound</h2><p>An agent cannot change the merchant, items, or amount after the merchant signs the quote.</p></article>
          <article className="dashboard-panel security-card"><span className="security-icon">02</span><h2>Single-use</h2><p>Each mandate can fund exactly one matching order and expires automatically.</p></article>
          <article className="dashboard-panel security-card"><span className="security-icon">03</span><h2>No reusable credential</h2><p>MCP clients see scoped wallet tools, never an underlying card or bank credential.</p></article>
          <article className="dashboard-panel security-card"><span className="security-icon">04</span><h2>MFA approval</h2><p>Human-approved payments require a fresh six-digit authenticator code before funds can be reserved.</p></article>
        </section>}
      </main>
    </div>
  );
}
