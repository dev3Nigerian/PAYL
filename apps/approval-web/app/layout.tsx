import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PAYL Approval",
  description: "Human authorization for agent-initiated PAYL sandbox payments",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
