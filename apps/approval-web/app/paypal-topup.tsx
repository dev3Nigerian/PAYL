"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

export type Topup = {
  topupId: string;
  amountMinor: string;
  currency: string;
  status: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  providerFeeMinor: string;
  reversedAmountMinor: string;
  createdAt: string;
};

type Buttons = { render: (container: HTMLElement) => Promise<void>; close?: () => void };
type PayPalSdk = { Buttons: (options: {
  createOrder: () => Promise<string>;
  onApprove: () => Promise<void>;
  onCancel: () => Promise<void>;
  onError: (error: Error) => void;
}) => Buttons };

function cents(value: string): string {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a dollar amount between $0.01 and $10,000");
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor < 1n || minor > 1_000_000n) throw new Error("Enter a dollar amount between $0.01 and $10,000");
  return minor.toString();
}

function money(minor: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(minor) / 100);
}

async function jsonRequest<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) } : {}),
    cache: "no-store",
  });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? "PayPal funding could not be completed");
  return data;
}

export default function PayPalTopup({ clientId, topups, offline }: { clientId: string | null; topups: Topup[]; offline: boolean }) {
  const [amount, setAmount] = useState("25.00");
  const [lockedMinor, setLockedMinor] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const buttonContainer = useRef<HTMLDivElement>(null);
  const topupId = useRef<string | null>(null);
  const paypalOrderId = useRef<string | null>(null);
  const createKey = useRef<string | null>(null);

  useEffect(() => {
    if (!clientId || !lockedMinor || !buttonContainer.current) return;
    let active = true;
    let buttons: Buttons | null = null;
    const render = async () => {
      const sdk = (window as Window & { paypal?: PayPalSdk }).paypal;
      if (!active || !sdk || !buttonContainer.current) return;
      buttons = sdk.Buttons({
        createOrder: async () => {
          if (paypalOrderId.current) return paypalOrderId.current;
          const reply = await jsonRequest<Topup>("/api/consumer/topups", "POST", {
            amountMinor: lockedMinor,
            idempotencyKey: createKey.current,
          });
          if (!reply.paypalOrderId) throw new Error("PayPal did not create an order");
          topupId.current = reply.topupId;
          paypalOrderId.current = reply.paypalOrderId;
          return reply.paypalOrderId;
        },
        onApprove: async () => {
          if (!topupId.current) throw new Error("Top-up reference is missing");
          const reply = await jsonRequest<Topup>(`/api/consumer/topups/${encodeURIComponent(topupId.current)}/capture`, "POST");
          if (reply.status === "completed") {
            window.location.reload();
            return;
          }
          setNotice({ kind: "ok", message: "PayPal is processing this top-up. Check its status below." });
        },
        onCancel: async () => {
          if (topupId.current) {
            await jsonRequest<Topup>(`/api/consumer/topups/${encodeURIComponent(topupId.current)}/cancel`, "POST").catch(() => undefined);
          }
          setLockedMinor(null);
          setNotice({ kind: "ok", message: "PayPal funding was cancelled. Your Antspace balance was not changed." });
        },
        onError: (error) => setNotice({ kind: "error", message: error.message || "PayPal funding could not be completed" }),
      });
      await buttons.render(buttonContainer.current);
    };
    const scriptId = "payl-paypal-sdk";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
      script.async = true;
      script.onload = () => void render().catch(() => setNotice({ kind: "error", message: "PayPal checkout could not be loaded" }));
      script.onerror = () => setNotice({ kind: "error", message: "PayPal checkout could not be loaded" });
      document.head.appendChild(script);
    } else if ((window as Window & { paypal?: PayPalSdk }).paypal) {
      void render().catch(() => setNotice({ kind: "error", message: "PayPal checkout could not be loaded" }));
    } else {
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      active = false;
      buttons?.close?.();
      script?.removeEventListener("load", render);
    };
  }, [clientId, lockedMinor]);

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const amountMinor = cents(amount);
      topupId.current = null;
      paypalOrderId.current = null;
      createKey.current = `wallet-topup-${crypto.randomUUID()}`;
      setNotice(null);
      setLockedMinor(amountMinor);
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Enter a valid amount" });
    }
  }

  async function checkStatus(id: string) {
    setChecking(id);
    try {
      const result = await jsonRequest<Topup>(`/api/consumer/topups/${encodeURIComponent(id)}`, "GET");
      if (result.status === "completed") window.location.reload();
      else setNotice({ kind: "ok", message: `Top-up is ${result.status}. Antspace will credit your balance after PayPal confirms capture.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Status could not be checked" });
    } finally { setChecking(null); }
  }

  return <article className="dashboard-panel paypal-topup-panel">
    <p className="section-label">PayPal Sandbox</p>
    <h2>Add funds to Antspace</h2>
    <p className="form-intro">Pay with a PayPal Sandbox buyer account. Antspace credits the full captured amount to your sandbox wallet.</p>
    {!clientId || offline ? <p className="empty-state">PayPal funding is unavailable until the sandbox account is configured.</p> : <>
      <form onSubmit={start} className="paypal-topup-form">
        <label htmlFor="paypal-topup-amount">Amount in USD</label>
        <div className="money-input"><b>$</b><input id="paypal-topup-amount" inputMode="decimal" value={amount} disabled={!!lockedMinor} onChange={(event) => setAmount(event.target.value)} /></div>
        {!lockedMinor && <button className="primary-button" type="submit">Continue with PayPal</button>}
      </form>
      {lockedMinor && <div className="paypal-button-section"><strong>Funding {money(lockedMinor)}</strong><div ref={buttonContainer} /><button className="text-button" type="button" onClick={() => setLockedMinor(null)}>Start a different amount</button></div>}
    </>}
    {notice && <p className={`form-notice ${notice.kind}`}>{notice.message}</p>}
    <div className="paypal-topup-history"><h3>Funding history</h3>
      {topups.length === 0 ? <p className="empty-state">No PayPal top-ups yet.</p> : topups.map((topup) => <div className="paypal-topup-row" key={topup.topupId}>
        <div><strong>{money(topup.amountMinor)}</strong><span>{topup.status.replaceAll("_", " ")} · {new Date(topup.createdAt).toLocaleString("en-US")}</span>{topup.paypalCaptureId && <small>PayPal capture {topup.paypalCaptureId}</small>}{Number(topup.reversedAmountMinor) > 0 && <small>Reversed: {money(topup.reversedAmountMinor)}</small>}{Number(topup.providerFeeMinor) > 0 && <small>PayPal fee paid by Antspace: {money(topup.providerFeeMinor)}</small>}</div>
        {topup.status === "pending" && <button className="secondary-button" type="button" disabled={checking === topup.topupId} onClick={() => void checkStatus(topup.topupId)}>{checking === topup.topupId ? "Checking…" : "Check status"}</button>}
      </div>)}
    </div>
  </article>;
}
