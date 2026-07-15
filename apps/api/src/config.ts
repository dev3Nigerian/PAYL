import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().url().default("postgresql://payl:payl_dev_only@localhost:54329/payl"),
  APPROVAL_WEB_URL: z.string().url().default("http://localhost:3000"),
  PAYL_ISSUER: z.string().url().default("https://sandbox.payl.local"),
  PAYL_DEV_KEYS: z.enum(["true", "false"]).default("true"),
  SANDBOX_CONSUMER_ID: z.string().default("consumer_demo"),
  SANDBOX_MERCHANT_ID: z.string().default("merchant_demo"),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  approvalWebUrl: string;
  issuer: string;
  devKeys: boolean;
  sandboxConsumerId: string;
  sandboxMerchantId: string;
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
    issuer: parsed.PAYL_ISSUER,
    devKeys: parsed.PAYL_DEV_KEYS === "true",
    sandboxConsumerId: parsed.SANDBOX_CONSUMER_ID,
    sandboxMerchantId: parsed.SANDBOX_MERCHANT_ID,
  };
}
