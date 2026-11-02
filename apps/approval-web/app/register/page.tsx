import type { Metadata } from "next";
import { webUrls } from "@payl/ui/urls";
import { hasActiveWebSession } from "@payl/ui/auth-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account — PAYL Sandbox" };

export default async function RegisterPage() {
  if (await hasActiveWebSession(process.env.PAYL_API_URL ?? "http://localhost:4100", (await cookies()).get("payl_consumer_session")?.value, "consumer")) redirect("/dashboard");
  return <RegisterForm merchantLogin={webUrls().merchantLogin} />;
}
