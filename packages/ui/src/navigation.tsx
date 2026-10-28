"use client";

import { useEffect, useState } from "react";
import { Brand, Icon, type IconName } from "./index.js";

export type NavigationItem<T extends string = string> = { id: T; label: string; icon: IconName };

export function useDashboardTab<T extends string>(items: readonly NavigationItem<T>[], initial: T) {
  const [tab, updateTab] = useState<T>(initial);
  useEffect(() => {
    const sync = () => {
      const value = window.location.hash.slice(1);
      const selected = items.find((item) => item.id === value);
      if (selected) updateTab(selected.id);
      else if (!value) updateTab(initial);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [items, initial]);
  function setTab(value: T) {
    updateTab(value);
    window.location.hash = value;
  }
  return [tab, setTab] as const;
}

export function DashboardNavigation<T extends string>({ items, tab, name, role, homeHref, switchHref, onLogout }: { items: readonly NavigationItem<T>[]; tab: T; name: string; role: "consumer" | "merchant"; homeHref: string; switchHref: string; onLogout: () => void | Promise<void> }) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setLeaving(true);
    setError("");
    try { await onLogout(); }
    catch { setError("Could not sign out. Please try again."); }
    finally { setLeaving(false); }
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "P";
  return <>
    <a className="skip-link" href="#dashboard-main" onClick={(event) => { event.preventDefault(); document.getElementById("dashboard-main")?.focus(); }}>Skip to content</a>
    <aside className="app-sidebar">
      <div className="sidebar-brand"><Brand href={homeHref} /><span className="workspace-label">{role === "consumer" ? "Personal workspace" : "Merchant workspace"}</span></div>
      <nav className="app-nav" aria-label={`${role === "consumer" ? "Consumer" : "Merchant"} dashboard`}>{items.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={tab === item.id ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span>{tab === item.id && <span className="nav-indicator" />}</a>)}</nav>
      <div className="sidebar-bottom">{error && <p className="navigation-error" role="alert">{error}</p>}<div className="sandbox-card"><span className="sandbox-dot" /><div><strong>Sandbox workspace</strong><small>Explore with virtual USD.</small></div></div><a className="workspace-switch" href={switchHref}>{role === "consumer" ? "Merchant dashboard" : "Consumer dashboard"}<Icon name="arrow" size={16} /></a><div className="account-row"><span className="account-avatar">{initials}</span><div><strong title={name}>{name}</strong><small>{role === "consumer" ? "Personal account" : "Business account"}</small></div><button type="button" className="icon-button" aria-label="Sign out" disabled={leaving} onClick={() => void logout()}><Icon name="logout" size={18} /></button></div></div>
    </aside>
    <div className="mobile-app-bar"><Brand href={homeHref} /><span>{role === "consumer" ? "Personal" : "Merchant"}</span><a href={switchHref} className="mobile-switch">Switch workspace<Icon name="arrow" size={14} /></a><button type="button" className="icon-button" aria-label="Sign out" disabled={leaving} onClick={() => void logout()}><Icon name="logout" size={18} /></button></div>
    {error && <p className="mobile-navigation-error" role="alert">{error}</p>}<nav className="mobile-app-nav" aria-label="Mobile dashboard">{items.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={tab === item.id ? "page" : undefined}><Icon name={item.icon} size={18} /><span>{item.label}</span></a>)}</nav>
  </>;
}
