import LoginForm from "./login-form";

export default function LoginPage() {
  return <LoginForm demoEmail={process.env.SANDBOX_MERCHANT_EMAIL ?? "merchant@payl.local"} demoPassword={process.env.SANDBOX_MERCHANT_PASSWORD ?? "MerchantDemo!2026"} />;
}
