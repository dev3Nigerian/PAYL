import type { ReactNode } from "react";

const paths = {
  sparkles: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z M20 2v4m-2-2h4",
  wallet: "M20 8V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V6m17 6h-5v4h5m-3-2h.01",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  box: "m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10v9M3 8l9 5 9-5M7.5 5.5l9 5V15",
  settlement: "M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5",
  download: "M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5",
  shield: "m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Zm-4 9 3 3 5-6",
  connect: "m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  logout: "M9 4H4v16h5m5-13 5 5-5 5m-6-5h11",
  plus: "M12 5v14M5 12h14",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  send: "m21 3-6 18-4-8-8-4 18-6Zm0 0L11 13",
  chevron: "m9 5 7 7-7 7",
  copy: "M9 9h12v12H9V9ZM5 15H3V3h12v2",
  down: "M12 4v16m-6-6 6 6 6-6",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`payl-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Brand({ href = "/", light = false }: { href?: string; light?: boolean }) {
  return <a className={`payl-brand${light ? " light" : ""}`} href={href} aria-label="Antspace home"><span className="payl-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 5-3-3m7 3 3-3M13 13l-5-3m5 7-6 1m6 4-4 6m10-15 5-3m-5 7 6 1m-6 4 4 6" /><circle cx="16" cy="8" r="3.5" /><ellipse cx="16" cy="15" rx="2.7" ry="3" /><ellipse cx="16" cy="24" rx="4.5" ry="5.5" /></svg></span>antspace</a>;
}

export function AuthShell({ children, role, homeHref, switchHref }: { children: ReactNode; role: "consumer" | "merchant"; homeHref: string; switchHref: string }) {
  const consumer = role === "consumer";
  return <main className="access-shell">
    <aside className="access-story"><Brand href={homeHref} light /><div className="access-story-content"><span className="overline">{consumer ? "A little less searching" : "Your next customer is an AI"}</span><h2>{consumer ? <>Your next find.<br />One conversation<br />away.</> : <>Great products.<br />Meet a new way<br />to sell.</>}</h2><p>{consumer ? "Tell Antspace what you need. Compare digital products, buy within your limits, and keep every order in one place." : "Put your digital products in reach of AI shoppers. Manage your catalog, deliver orders, and withdraw earnings through PayPal Sandbox."}</p><div className="access-assurance"><Icon name="shield" /><span>{consumer ? "Your wallet. Your spending limits." : "From first listing to final delivery."}</span></div></div><small>Antspace Sandbox · Virtual USD transactions</small></aside>
    <section className="access-form-area"><div className="access-top"><a href={homeHref}>← Back to home</a><span>{consumer ? "For shoppers" : "For merchants"}</span></div><div className="access-form-wrap">{children}<p className="access-switch">{consumer ? "Here to sell?" : "Here to shop?"} <a href={switchHref}>{consumer ? "Merchant sign in" : "Consumer sign in"}<Icon name="arrow" size={15} /></a></p></div><p className="access-footer">A simpler way to shop. A new way to be discovered.</p></section>
  </main>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ["fulfilled", "paid", "completed", "active"].includes(status) ? "success" : ["failed", "returned", "denied", "reversed"].includes(status) ? "danger" : ["pending", "confirmed", "pending_approval", "processing"].includes(status) ? "pending" : "neutral";
  return <span className={`state-badge ${tone}`}><span />{status.replaceAll("_", " ")}</span>;
}
