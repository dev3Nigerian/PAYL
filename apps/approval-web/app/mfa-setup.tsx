"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@payl/ui";

type Enrollment = { secret: string; account: string; issuer: string };

export default function MfaSetup() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/consumer/mfa", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { configured: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Authenticator status could not be loaded");
      if (active) setConfigured(body.configured);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load authenticator status"); });
    return () => { active = false; };
  }, []);

  async function update(action: "start" | "confirm") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/consumer/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...(action === "confirm" ? { mfaCode: code } : {}) }) });
      const body = await response.json() as Enrollment & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Authenticator setup failed");
      if (action === "start") { setConfigured(false); setEnrollment(body); }
      else { setConfigured(true); setEnrollment(null); setCode(""); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Authenticator setup failed"); }
    finally { setBusy(false); }
  }

  async function copySecret() {
    if (!enrollment) return;
    try { await navigator.clipboard.writeText(enrollment.secret); setCopied(true); }
    catch { setError("Copy the setup key manually from the field above."); }
  }

  return <article className="dashboard-panel mfa-setup" aria-busy={busy}>
    <div className="panel-title"><div><p className="section-label">Payment approvals</p><h2>Your authenticator</h2></div><Icon name="shield" size={24} /></div>
    {configured === true ? <p className="form-notice ok" role="status">Your authenticator is ready. Use its six-digit authenticator code when a purchase needs approval.</p> : <>
      <p className="form-intro">Purchases above your auto-approval limit need a six-digit code. Set up your own authenticator to approve them.</p>
      {configured === null && !error && <p role="status">Checking your setup…</p>}
      {!enrollment && (configured === false || error) && <button className="primary-button" disabled={busy} onClick={() => void update("start")}>{busy ? "Preparing…" : "Set up authenticator"}</button>}
      {enrollment && <form onSubmit={(event: FormEvent) => { event.preventDefault(); void update("confirm"); }}>
        <ol className="mfa-instructions"><li>In your authenticator app, add an account using a setup key.</li><li>Name it <strong>{enrollment.issuer}: {enrollment.account}</strong> and choose a <strong>time-based</strong> code.</li><li>Copy the key below into the app, then enter the generated code.</li></ol>
        <label className="login-field"><span>Authenticator setup key</span><input className="mfa-secret" readOnly value={enrollment.secret} autoComplete="off" spellCheck={false} /></label>
        <button className="secondary-button mfa-copy" type="button" onClick={() => void copySecret()}>{copied ? "Key copied" : "Copy setup key"}</button>
        <label className="login-field"><span>Six-digit authenticator code</span><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <button className="primary-button mfa-confirm" type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify & enable"}</button>
      </form>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </article>;
}
