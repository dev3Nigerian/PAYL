"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginForm({ demoEmail, demoPassword }: { demoEmail: string; demoPassword: string }) {
  const search = useSearchParams();
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
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Sign-in failed");
      const requested = search.get("returnTo");
      const returnTo = requested && safeReturnTo(requested) ? requested : "/";
      window.location.assign(returnTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return <main className="shell"><form className="card login-card" onSubmit={submit}>
    <div className="brand">PAYL</div><p className="eyebrow">Consumer identity</p><h1>Sign in to your wallet</h1>
    <p className="muted">Your dashboard, policies, approvals, and MCP grants are isolated to this account.</p>
    <label className="login-field"><span>Email</span><input aria-label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="login-field"><span>Password</span><input aria-label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <p className="error">{error}</p>}
    <button className="primary-button login-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <p className="fineprint">Sandbox credentials are prefilled. Payment approval separately requires your six-digit authenticator code.</p>
  </form></main>;
}

function safeReturnTo(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.hostname === "localhost" && ["3000", "4100"].includes(url.port);
  } catch {
    return false;
  }
}
