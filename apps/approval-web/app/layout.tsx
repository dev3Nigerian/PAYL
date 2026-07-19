import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PAYL Consumer Wallet",
  description: "Consumer wallet, policy, and human authorization for PAYL sandbox payments",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
