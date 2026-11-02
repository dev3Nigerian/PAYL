import type { Metadata } from "next";
import "./globals.css";
import "@payl/ui/styles.css";
import "./workspace.css";

export const metadata: Metadata = {
  applicationName: "Antspace",
  title: "Antspace — Your personal workspace",
  description: "Shop with AI, manage your Antspace wallet, and keep control of your purchases.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
