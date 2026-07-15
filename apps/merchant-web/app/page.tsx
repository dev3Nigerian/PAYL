type State = {
  orders: Array<{ id: string; status: string; captured_amount_minor: string; currency: string; created_at: string }>;
  ledger: { entries: string; unbalanced_entries: string };
};

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  let state: State = { orders: [], ledger: { entries: "0", unbalanced_entries: "0" } };
  let offline = false;
  try {
    const response = await fetch(`${apiUrl}/api/demo/state`, { cache: "no-store" });
    if (!response.ok) throw new Error("API unavailable");
    state = await response.json() as State;
  } catch { offline = true; }

  return (
    <main>
      <aside><div className="brand">PAYL</div><div className="merchant">Atlas Digital Market</div><nav><span className="active">Overview</span><span>Orders</span><span>Offers</span><span>Settlement</span></nav><div className="sandbox">Sandbox ledger<br />No real funds</div></aside>
      <section className="content">
        <header><div><p>Merchant operations</p><h1>Agent commerce overview</h1></div><span className={offline ? "status bad" : "status"}>{offline ? "API offline" : "System healthy"}</span></header>
        <div className="metrics"><article><span>Completed orders</span><strong>{state.orders.length}</strong></article><article><span>Journal entries</span><strong>{state.ledger.entries}</strong></article><article><span>Unbalanced entries</span><strong>{state.ledger.unbalanced_entries}</strong></article></div>
        <article className="panel"><div className="panelhead"><h2>Latest AI orders</h2><span>Signed receipts</span></div>{state.orders.length === 0 ? <p className="empty">Run the reference agent to create the first order.</p> : <div className="table">{state.orders.map((order) => <div className="row" key={order.id}><span className="mono">{order.id}</span><span>{new Intl.NumberFormat("en-NG", { style: "currency", currency: order.currency }).format(Number(order.captured_amount_minor) / 100)}</span><span className="complete">{order.status}</span></div>)}</div>}</article>
      </section>
    </main>
  );
}
