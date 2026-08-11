"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginForm({ demoEmail, demoPassword, apiOrigin, prefilled }: { demoEmail: string; demoPassword: string; apiOrigin: string; prefilled: boolean }) {
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
      const requested = search.get("returnTo");
      const oauthHandoff = Boolean(requested && isOAuthReturnTo(requested, apiOrigin));
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, oauthHandoff }),
      });
      const body = await readJson(response) as { handoffUrl?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Sign-in failed");
      if (requested && isOAuthReturnTo(requested, apiOrigin) && body.handoffUrl) {
        const handoff = new URL(body.handoffUrl);
        handoff.searchParams.set("returnTo", requested);
        window.location.assign(handoff);
      } else {
        window.location.assign(requested && isLocalReturnTo(requested) ? requested : "/");
      }
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
    <p className="fineprint">{prefilled ? "Local sandbox credentials are prefilled." : "Use the credentials supplied by the sandbox owner."} Payment approval separately requires your six-digit authenticator code.</p>
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

function isLocalReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function isOAuthReturnTo(value: string, apiOrigin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(apiOrigin).origin && url.pathname === "/authorize";
  } catch {
    return false;
  }
}
