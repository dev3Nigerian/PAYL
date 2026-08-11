"use client";

import { useState, type FormEvent } from "react";

export default function LoginForm({ demoEmail, demoPassword, prefilled }: { demoEmail: string; demoPassword: string; prefilled: boolean }) {
  const [email, setEmail] = useState(demoEmail);
  const [password, setPassword] = useState(demoPassword);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await readJson(response) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Sign-in failed");
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return <main className="auth-shell"><form className="auth-card" onSubmit={submit}>
    <div className="brand">PAYL</div><p className="eyebrow">Merchant identity</p><h1>Sign in to your business</h1>
    <p>Catalog, orders, and settlement information are scoped to this merchant account.</p>
    <label><span>Email</span><input aria-label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label><span>Password</span><input aria-label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <p className="form-notice error">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <small>{prefilled ? "Sandbox credentials are prefilled for local testing." : "Use the credentials supplied by the sandbox owner."}</small>
    <a className="auth-link" href="/register">Register another merchant</a>
  </form></main>;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return { error: { message: `PAYL did not return a response (${response.status})` } };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: "PAYL returned an invalid response. Please try again shortly." } };
  }
}
