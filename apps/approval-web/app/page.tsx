export default function Home() {
  return (
    <main className="shell">
      <section className="card intro">
        <div className="brand">PAYL</div>
        <p className="eyebrow">Consumer authorization surface</p>
        <h1>Your AI can prepare a payment. Only you can approve it.</h1>
        <p className="muted">Open the approval link returned by the reference consumer agent to review the exact merchant, items, amount, and expiry.</p>
        <div className="safety">Sandbox only · No real funds · Approval remains outside the agent</div>
      </section>
    </main>
  );
}
