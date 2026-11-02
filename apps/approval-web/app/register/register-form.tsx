"use client";

import { useState, type FormEvent } from "react";
import { AuthShell, Icon } from "@payl/ui";

export default function RegisterForm({ merchantLogin }: { merchantLogin: string }) {
  const [form, setForm] = useState({ displayName: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (form.password !== form.confirmPassword) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: form.displayName, email: form.email, password: form.password }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Account could not be created");
      setForm({ displayName: "", email: "", password: "", confirmPassword: "" });
      setCreated(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account setup could not be confirmed. Try signing in before registering again.");
    } finally { setBusy(false); }
  }

  return <AuthShell role="consumer" homeHref="/" switchHref={merchantLogin}>
    {created ? <section className="card login-card signup-success" aria-labelledby="welcome-heading">
      <span className="signup-symbol"><Icon name="check" size={26} /></span>
      <p className="eyebrow">You’re signed in</p><h1 id="welcome-heading">Your first $100 is ready.</h1>
      <p className="muted">Your wallet has been credited with $100 in virtual USD. Try your first sandbox purchase with Antspace AI.</p>
      <a className="primary-button login-button" href="/dashboard">Start shopping <Icon name="arrow" size={16} /></a>
      <a className="auth-link" href="/dashboard#security">Set up my payment authenticator</a>
      <p className="fineprint">Your default auto-approval limit is $50. Larger purchases require an authenticator code. This welcome credit is for sandbox use and has no cash value.</p>
    </section> : <form className="card login-card signup-card" onSubmit={submit} aria-busy={busy}>
      <p className="eyebrow">Your first find starts here</p><h1>Create your account.</h1>
      <p className="muted">Meet your AI shopping companion. Sign up and get $100 to explore the Antspace sandbox.</p>
      <div className="signup-credit"><Icon name="wallet" size={24} /><div><strong>$100 welcome credit</strong><span>Virtual USD · One-time credit per new account</span></div></div>
      <label className="login-field"><span>Your name</span><input required minLength={2} maxLength={120} autoComplete="name" placeholder="Your name" value={form.displayName} disabled={busy} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
      <label className="login-field"><span>Email address</span><input required type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" value={form.email} disabled={busy} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label className="login-field"><span>Password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="signup-password-hint" placeholder="Create a password" value={form.password} disabled={busy} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
      <p className="signup-hint" id="signup-password-hint">Use 12–128 characters.</p>
      <label className="login-field"><span>Confirm password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="Repeat your password" value={form.confirmPassword} disabled={busy} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary-button login-button" type="submit" disabled={busy}>{busy ? "Creating your account…" : "Create account & get $100"}<Icon name="arrow" size={16} /></button>
      <p className="fineprint">Sandbox credit has no cash value. No payment is needed to create an account.</p>
      <a className="auth-link" href="/login">Already have an account? Sign in</a>
    </form>}
  </AuthShell>;
}
