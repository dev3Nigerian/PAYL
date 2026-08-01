import LoginForm from "./login-form";

export default function LoginPage() {
  const prefilled = process.env.PAYL_PREFILL_DEMO_CREDENTIALS !== "false";
  return <LoginForm
    demoEmail={prefilled ? process.env.SANDBOX_MERCHANT_EMAIL ?? "merchant@payl.local" : ""}
    demoPassword={prefilled ? process.env.SANDBOX_MERCHANT_PASSWORD ?? "MerchantDemo!2026" : ""}
    prefilled={prefilled}
  />;
}
