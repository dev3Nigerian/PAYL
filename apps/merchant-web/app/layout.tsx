import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "PAYL Merchant", description: "PAYL sandbox merchant console" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
