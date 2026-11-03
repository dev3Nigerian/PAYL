"use client";

import { useState, type FormEvent } from "react";
import { AuthShell, Icon } from "@payl/ui";

export default function LoginForm({ demoEmail, demoPassword, prefilled, homeUrl, consumerLogin }: { demoEmail: string; demoPassword: string; prefilled: boolean; homeUrl: string; consumerLogin: string }) {
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
      window.location.assign(`/dashboard${window.location.hash}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return <AuthShell role="merchant" homeHref={homeUrl} switchHref={consumerLogin}><form className="auth-card" onSubmit={submit} aria-busy={busy}>
    <p className="eyebrow">Your merchant workspace</p><h1>Back to business.</h1>
    <p>Sign in to manage your products, deliver orders, and follow your earnings.</p>
    <label><span>Email address</span><input required aria-label="Email" type="email" autoComplete="username" placeholder="you@business.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label><span>Password</span><input required aria-label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <p className="form-notice error" role="alert">{error}</p>}
    {busy && <p className="fineprint" role="status">Connecting to Antspace. If the sandbox was asleep, this may take up to a minute.</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to your business"}<Icon name="arrow" size={16} /></button>
    <small>{prefilled ? "Sandbox credentials are prefilled for local testing." : "Use the email and password you registered for your business."}</small>
    <a className="auth-link" href="/register">New to Antspace? Create a merchant account</a>
  </form></AuthShell>;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return { error: { message: `Antspace did not return a response (${response.status})` } };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: "Antspace returned an invalid response. Please try again shortly." } };
  }
}
