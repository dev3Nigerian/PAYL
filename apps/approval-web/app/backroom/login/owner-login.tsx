"use client";

import { useState, type FormEvent } from "react";

export function OwnerLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/backroom/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.get("email"), password: data.get("password"), mfaCode: data.get("mfaCode") }), signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to sign in. Please try again.");
      window.location.replace("/backroom");
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Sign-in timed out. Please try again with a new authenticator code."); setBusy(false); }
  }
  return <form className="br-login-form" onSubmit={submit}>
    <label>Owner email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
    <label>Authenticator code<input className="br-code" name="mfaCode" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" aria-describedby="br-code-help" placeholder="000000" required /><small id="br-code-help">The six-digit code from your authenticator app.</small></label>
    {error && <p className="br-error" role="alert">{error}</p>}
    <button className="br-button br-button-primary" disabled={busy} type="submit">{busy ? "Signing in…" : "Open backroom"}</button>
  </form>;
}
