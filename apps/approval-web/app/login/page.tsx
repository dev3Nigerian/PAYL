import { Suspense } from "react";
import LoginForm from "./login-form";
import { webUrls } from "@payl/ui/urls";
import { hasActiveWebSession } from "@payl/ui/auth-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const prefilled = process.env.PAYL_PREFILL_DEMO_CREDENTIALS === "true" ||
    (process.env.NODE_ENV !== "production" && process.env.PAYL_PREFILL_DEMO_CREDENTIALS !== "false");
  const apiOrigin = process.env.PAYL_API_URL ??
    (process.env.NODE_ENV === "production" ? "https://payl-api-dev3nigerian.onrender.com" : "http://localhost:4100");
  // Approval links and OAuth browser handoffs still use the existing return flow.
  if (!(await searchParams).returnTo && await hasActiveWebSession(apiOrigin, (await cookies()).get("payl_consumer_session")?.value, "consumer")) redirect("/dashboard");
  return <Suspense fallback={<main className="shell"><div className="card login-card">Loading sign-in…</div></main>}>
    <LoginForm
      demoEmail={prefilled ? process.env.SANDBOX_CONSUMER_EMAIL ?? "consumer@payl.local" : ""}
      demoPassword={prefilled ? process.env.SANDBOX_CONSUMER_PASSWORD ?? "ConsumerDemo!2026" : ""}
      apiOrigin={apiOrigin}
      prefilled={prefilled}
      merchantLogin={webUrls().merchantLogin}
    />
  </Suspense>;
}
