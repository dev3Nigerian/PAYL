"use client";

import { useState, type FormEvent } from "react";

export default function RegisterForm() {
  const [form, setForm] = useState({ businessName: "", adminName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Merchant account could not be created");
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Merchant account could not be created");
      setBusy(false);
    }
  }

  return <main className="auth-shell"><form className="auth-card" onSubmit={submit}>
    <div className="brand">PAYL</div><p className="eyebrow">Merchant onboarding</p><h1>Create your sandbox business</h1>
    <p>Registration provisions an isolated merchant, payable ledger, and product catalog that automatically appears through the shared PAYL commerce MCP connection.</p>
    <label><span>Business name</span><input required minLength={2} maxLength={120} autoComplete="organization" value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></label>
    <label><span>Administrator name</span><input required minLength={2} maxLength={120} autoComplete="name" value={form.adminName} onChange={(event) => setForm({ ...form, adminName: event.target.value })} /></label>
    <label><span>Work email</span><input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
    <label><span>Password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
    {error && <p className="form-notice error">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating merchant…" : "Create merchant"}</button>
    <small>Sandbox only · USD ledger · no real settlement or identity verification.</small>
    <a className="auth-link" href="/login">Already registered? Sign in</a>
  </form></main>;
}
