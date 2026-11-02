import LoginForm from "./login-form";
import { webUrls } from "@payl/ui/urls";
import { hasActiveWebSession } from "@payl/ui/auth-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasActiveWebSession(process.env.PAYL_API_URL ?? "http://localhost:4100", (await cookies()).get("payl_merchant_session")?.value, "merchant_admin")) redirect("/dashboard");
  const prefilled = process.env.PAYL_PREFILL_DEMO_CREDENTIALS === "true" ||
    (process.env.NODE_ENV !== "production" && process.env.PAYL_PREFILL_DEMO_CREDENTIALS !== "false");
  return <LoginForm
    demoEmail={prefilled ? process.env.SANDBOX_MERCHANT_EMAIL ?? "merchant@payl.local" : ""}
    demoPassword={prefilled ? process.env.SANDBOX_MERCHANT_PASSWORD ?? "MerchantDemo!2026" : ""}
    prefilled={prefilled}
    homeUrl={webUrls().home}
    consumerLogin={webUrls().consumerLogin}
  />;
}
