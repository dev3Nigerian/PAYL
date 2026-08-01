import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PAYL_DEPLOYMENT_PROFILE: z.enum(["local_sandbox", "hosted_sandbox"]).default("local_sandbox"),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().url().default("postgresql://payl:payl_dev_only@localhost:54329/payl"),
  APPROVAL_WEB_URL: z.string().url().default("http://localhost:3000"),
  MERCHANT_WEB_URL: z.string().url().default("http://localhost:3001"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4100"),
  PAYL_ISSUER: z.string().url().default("https://sandbox.payl.local"),
  PAYL_DEV_KEYS: z.enum(["true", "false"]).default("true"),
  PAYL_SIGNING_MASTER_KEY: z.string().optional(),
  PAYL_SIGNING_KEY_ID: z.string().regex(/^[A-Za-z0-9._:-]{8,80}$/).default("payl-hosted-sandbox-2026-01"),
  SANDBOX_BOOTSTRAP_ENABLED: z.enum(["true", "false"]).default("true"),
  SANDBOX_QUOTE_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  SANDBOX_APPROVAL_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(45),
  SANDBOX_FULFILLMENT_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
  LIFECYCLE_WORKER_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  SANDBOX_CONSUMER_ID: z.string().default("consumer_demo"),
  SANDBOX_MERCHANT_ID: z.string().default("merchant_demo"),
  SANDBOX_CONSUMER_EMAIL: z.string().email().default("consumer@payl.local"),
  SANDBOX_CONSUMER_PASSWORD: z.string().min(12).default("ConsumerDemo!2026"),
  SANDBOX_CONSUMER_TOTP_SECRET: z.string().regex(/^[A-Z2-7]+=*$/).default("JBSWY3DPEHPK3PXP"),
  SANDBOX_MERCHANT_EMAIL: z.string().email().default("merchant@payl.local"),
  SANDBOX_MERCHANT_PASSWORD: z.string().min(12).default("MerchantDemo!2026"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  deploymentProfile: "local_sandbox" | "hosted_sandbox";
  port: number;
  databaseUrl: string;
  approvalWebUrl: string;
  merchantWebUrl: string;
  publicBaseUrl: string;
  issuer: string;
  devKeys: boolean;
  signingMasterKey: Buffer | null;
  signingKeyId: string;
  sandboxBootstrapEnabled: boolean;
  sandboxQuoteTtlMinutes: number;
  sandboxApprovalTtlMinutes: number;
  sandboxFulfillmentTtlMinutes: number;
  lifecycleWorkerIntervalMs: number;
  sandboxConsumerId: string;
  sandboxMerchantId: string;
  sandboxConsumerEmail: string;
  sandboxConsumerPassword: string;
  sandboxConsumerTotpSecret: string;
  sandboxMerchantEmail: string;
  sandboxMerchantPassword: string;
  sessionTtlHours: number;
};

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function hostedSigningKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("PAYL_SIGNING_MASTER_KEY must be a base64-encoded 256-bit value");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32) throw new Error("PAYL_SIGNING_MASTER_KEY must decode to exactly 32 bytes");
  return decoded;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);
  const signingMasterKey = hostedSigningKey(parsed.PAYL_SIGNING_MASTER_KEY);
  const hosted = parsed.PAYL_DEPLOYMENT_PROFILE === "hosted_sandbox";

  if (hosted && parsed.PAYL_DEV_KEYS === "true") {
    throw new Error("Hosted sandbox deployments must set PAYL_DEV_KEYS=false");
  }
  if (hosted && !signingMasterKey) {
    throw new Error("Hosted sandbox deployments require PAYL_SIGNING_MASTER_KEY");
  }
  if (!hosted && parsed.PAYL_DEV_KEYS === "false") {
    throw new Error("PAYL_DEV_KEYS=false requires PAYL_DEPLOYMENT_PROFILE=hosted_sandbox");
  }
  if (parsed.NODE_ENV === "production" && !hosted) {
    throw new Error("Production runtime requires PAYL_DEPLOYMENT_PROFILE=hosted_sandbox");
  }
  if (hosted) {
    const publicUrls = [parsed.APPROVAL_WEB_URL, parsed.MERCHANT_WEB_URL, parsed.PUBLIC_BASE_URL, parsed.PAYL_ISSUER];
    if (publicUrls.some((value) => new URL(value).protocol !== "https:")) {
      throw new Error("Hosted sandbox public URLs must use HTTPS");
    }
    const databaseUrl = new URL(parsed.DATABASE_URL);
    const sslMode = databaseUrl.searchParams.get("sslmode");
    if (isLoopback(databaseUrl.hostname) || !["require", "verify-ca", "verify-full"].includes(sslMode ?? "")) {
      throw new Error("Hosted sandbox DATABASE_URL must be remote and require TLS with sslmode=require, verify-ca, or verify-full");
    }
    if (
      parsed.SANDBOX_CONSUMER_PASSWORD === "ConsumerDemo!2026" ||
      parsed.SANDBOX_MERCHANT_PASSWORD === "MerchantDemo!2026" ||
      parsed.SANDBOX_CONSUMER_PASSWORD.length < 16 ||
      parsed.SANDBOX_MERCHANT_PASSWORD.length < 16
    ) {
      throw new Error("Hosted sandbox passwords must replace the demo defaults and contain at least 16 characters");
    }
    if (parsed.SANDBOX_CONSUMER_TOTP_SECRET === "JBSWY3DPEHPK3PXP") {
      throw new Error("Hosted sandbox deployments must replace the demo TOTP secret");
    }
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    deploymentProfile: parsed.PAYL_DEPLOYMENT_PROFILE,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    approvalWebUrl: parsed.APPROVAL_WEB_URL,
    merchantWebUrl: parsed.MERCHANT_WEB_URL,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    issuer: parsed.PAYL_ISSUER,
    devKeys: parsed.PAYL_DEV_KEYS === "true",
    signingMasterKey,
    signingKeyId: parsed.PAYL_SIGNING_KEY_ID,
    sandboxBootstrapEnabled: parsed.SANDBOX_BOOTSTRAP_ENABLED === "true",
    sandboxQuoteTtlMinutes: parsed.SANDBOX_QUOTE_TTL_MINUTES,
    sandboxApprovalTtlMinutes: parsed.SANDBOX_APPROVAL_TTL_MINUTES,
    sandboxFulfillmentTtlMinutes: parsed.SANDBOX_FULFILLMENT_TTL_MINUTES,
    lifecycleWorkerIntervalMs: parsed.LIFECYCLE_WORKER_INTERVAL_MS,
    sandboxConsumerId: parsed.SANDBOX_CONSUMER_ID,
    sandboxMerchantId: parsed.SANDBOX_MERCHANT_ID,
    sandboxConsumerEmail: parsed.SANDBOX_CONSUMER_EMAIL.toLowerCase(),
    sandboxConsumerPassword: parsed.SANDBOX_CONSUMER_PASSWORD,
    sandboxConsumerTotpSecret: parsed.SANDBOX_CONSUMER_TOTP_SECRET,
    sandboxMerchantEmail: parsed.SANDBOX_MERCHANT_EMAIL.toLowerCase(),
    sandboxMerchantPassword: parsed.SANDBOX_MERCHANT_PASSWORD,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
  };
}
