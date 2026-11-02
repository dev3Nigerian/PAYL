import type { Metadata } from "next";
import { webUrls } from "@payl/ui/urls";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account — PAYL Sandbox" };

export default function RegisterPage() {
  return <RegisterForm merchantLogin={webUrls().merchantLogin} />;
}
