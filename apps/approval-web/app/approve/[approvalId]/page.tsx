"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Approval = {
  approvalId: string;
  paymentId: string;
  status: string;
  merchantName: string;
  amountMinor: string;
  currency: string;
  items: Array<{ description: string; quantity: number; lineTotalMinor: string }>;
  expiresAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_PAYL_API_URL ?? "http://localhost:4100";

function money(amountMinor: string, currency: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(Number(amountMinor) / 100);
}

export default function ApprovalPage() {
  const parameters = useParams<{ approvalId: string }>();
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`${apiUrl}/api/approvals/${parameters.approvalId}`, {
      headers: { "x-payl-consumer-id": "consumer_demo" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<Approval>;
      })
      .then(setApproval)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Approval could not be loaded"));
  }, [parameters.approvalId]);

  async function decide(decision: "approve" | "decline") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/approvals/${parameters.approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-payl-consumer-id": "consumer_demo" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error(await response.text());
      setApproval((current) => (current ? { ...current, status: decision === "approve" ? "approved" : "declined" } : current));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !approval) return <main className="shell"><section className="card"><div className="brand">PAYL</div><h1>Approval unavailable</h1><p className="error">{error}</p></section></main>;
  if (!approval) return <main className="shell"><section className="card"><div className="brand">PAYL</div><p>Loading the signed quote…</p></section></main>;
  const final = approval.status !== "pending";

  return (
    <main className="shell">
      <section className="card">
        <header className="topline"><div className="brand">PAYL</div><span className="pill">Sandbox</span></header>
        <p className="eyebrow">Agent-initiated payment</p>
        <h1>{final ? `Payment ${approval.status}` : "Review this payment"}</h1>
        <div className="amount">{money(approval.amountMinor, approval.currency)}</div>
        <p className="merchant">to {approval.merchantName}</p>
        <div className="details">
          {approval.items.map((item) => (
            <div className="line" key={item.description}><span>{item.quantity} × {item.description}</span><strong>{money(item.lineTotalMinor, approval.currency)}</strong></div>
          ))}
          <div className="line"><span>Authorization</span><strong>Single-use mandate</strong></div>
          <div className="line"><span>Expires</span><strong>{new Date(approval.expiresAt).toLocaleTimeString()}</strong></div>
        </div>
        {!final && <div className="actions"><button className="secondary" disabled={busy} onClick={() => void decide("decline")}>Decline</button><button className="primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Authorizing…" : "Approve payment"}</button></div>}
        {error && <p className="error">{error}</p>}
        <p className="fineprint">The merchant cannot change the amount after approval. PAYL binds authorization to the signed quote and merchant.</p>
      </section>
    </main>
  );
}
