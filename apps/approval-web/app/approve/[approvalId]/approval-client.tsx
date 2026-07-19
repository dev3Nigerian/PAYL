"use client";

import { useEffect, useState } from "react";

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

function money(amountMinor: string, currency: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(Number(amountMinor) / 100);
}

export default function ApprovalClient({ approvalId }: { approvalId: string }) {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/approvals/${encodeURIComponent(approvalId)}`)
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign(`/login?returnTo=${encodeURIComponent(`/approve/${approvalId}`)}`);
          throw new Error("Sign in required");
        }
        if (!response.ok) throw new Error((await response.json() as { error?: { message?: string } }).error?.message ?? "Approval could not be loaded");
        return response.json() as Promise<Approval>;
      })
      .then(setApproval)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Approval could not be loaded"));
  }, [approvalId]);

  async function decide(decision: "approve" | "decline") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, mfaCode: decision === "approve" ? mfaCode : undefined }),
      });
      const body = await response.json() as Approval & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Decision failed");
      setApproval((current) => current ? { ...current, status: decision === "approve" ? "approved" : "declined" } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !approval) return <main className="shell"><section className="card"><div className="brand">PAYL</div><h1>Approval unavailable</h1><p className="error">{error}</p></section></main>;
  if (!approval) return <main className="shell"><section className="card"><div className="brand">PAYL</div><p>Loading the signed quote…</p></section></main>;
  const final = approval.status !== "pending";

  return <main className="shell"><section className="card">
    <header className="topline"><div className="brand">PAYL</div><span className="pill">Authenticated sandbox</span></header>
    <p className="eyebrow">Agent-initiated payment</p><h1>{final ? `Payment ${approval.status}` : "Review this payment"}</h1>
    <div className="amount">{money(approval.amountMinor, approval.currency)}</div><p className="merchant">to {approval.merchantName}</p>
    <div className="details">{approval.items.map((item) => <div className="line" key={item.description}><span>{item.quantity} × {item.description}</span><strong>{money(item.lineTotalMinor, approval.currency)}</strong></div>)}<div className="line"><span>Authorization</span><strong>Single-use mandate</strong></div><div className="line"><span>Expires</span><strong>{new Date(approval.expiresAt).toLocaleTimeString()}</strong></div></div>
    {!final && <><label className="mfa-field"><span>Authenticator code</span><input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /><small>Required only when approving payment.</small></label><div className="actions"><button className="secondary" disabled={busy} onClick={() => void decide("decline")}>Decline</button><button className="primary" disabled={busy || mfaCode.length !== 6} onClick={() => void decide("approve")}>{busy ? "Authorizing…" : "Approve with MFA"}</button></div></>}
    {error && <p className="error">{error}</p>}<p className="fineprint">The merchant cannot change the amount after approval. PAYL binds authorization to the signed quote and merchant.</p>
  </section></main>;
}
