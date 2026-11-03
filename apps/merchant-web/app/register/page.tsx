import RegisterForm from "./register-form";
import { webUrls } from "@payl/ui/urls";
import { hasActiveWebSession } from "@payl/ui/auth-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await hasActiveWebSession(process.env.PAYL_API_URL ?? "http://localhost:4100", (await cookies()).get("payl_merchant_session")?.value, "merchant_admin")) redirect("/dashboard");
  const urls = webUrls();
  return <RegisterForm homeUrl={urls.home} consumerLogin={urls.consumerLogin} />;
}
