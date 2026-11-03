import type { Metadata } from "next";
import "./globals.css";
import "@payl/ui/styles.css";
import "./workspace.css";

export const metadata: Metadata = { applicationName: "Antspace", title: "Antspace — Merchant workspace", description: "Sell digital products to AI shoppers. Manage your Antspace catalog, orders, deliveries, and sandbox earnings." };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
