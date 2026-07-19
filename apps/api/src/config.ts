import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().url().default("postgresql://payl:payl_dev_only@localhost:54329/payl"),
  APPROVAL_WEB_URL: z.string().url().default("http://localhost:3000"),
  MERCHANT_WEB_URL: z.string().url().default("http://localhost:3001"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4100"),
  PAYL_ISSUER: z.string().url().default("https://sandbox.payl.local"),
  PAYL_DEV_KEYS: z.enum(["true", "false"]).default("true"),
  SANDBOX_QUOTE_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  SANDBOX_APPROVAL_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(45),
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
  port: number;
  databaseUrl: string;
  approvalWebUrl: string;
  merchantWebUrl: string;
  publicBaseUrl: string;
  issuer: string;
  devKeys: boolean;
  sandboxQuoteTtlMinutes: number;
  sandboxApprovalTtlMinutes: number;
  sandboxConsumerId: string;
  sandboxMerchantId: string;
  sandboxConsumerEmail: string;
  sandboxConsumerPassword: string;
  sandboxConsumerTotpSecret: string;
  sandboxMerchantEmail: string;
  sandboxMerchantPassword: string;
  sessionTtlHours: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);
  if (parsed.NODE_ENV === "production" && parsed.PAYL_DEV_KEYS === "true") {
    throw new Error("PAYL_DEV_KEYS must be false in production; configure a KMS-backed signer");
  }
  if (parsed.PAYL_DEV_KEYS === "false") {
    throw new Error("The KMS signer is intentionally not implemented in the sandbox");
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    approvalWebUrl: parsed.APPROVAL_WEB_URL,
    merchantWebUrl: parsed.MERCHANT_WEB_URL,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    issuer: parsed.PAYL_ISSUER,
    devKeys: parsed.PAYL_DEV_KEYS === "true",
    sandboxQuoteTtlMinutes: parsed.SANDBOX_QUOTE_TTL_MINUTES,
    sandboxApprovalTtlMinutes: parsed.SANDBOX_APPROVAL_TTL_MINUTES,
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
