import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return <Suspense fallback={<main className="shell"><div className="card login-card">Loading sign-in…</div></main>}>
    <LoginForm demoEmail={process.env.SANDBOX_CONSUMER_EMAIL ?? "consumer@payl.local"} demoPassword={process.env.SANDBOX_CONSUMER_PASSWORD ?? "ConsumerDemo!2026"} />
  </Suspense>;
}
