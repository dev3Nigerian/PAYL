import { describe, expect, it } from "vitest";
import { createSecretDerivedKey, signPayload, verifyPayload } from "@payl/crypto";
import { loadConfig } from "../src/config.js";

describe("PayPal Sandbox configuration", () => {
  it("requires the server credentials and webhook ID together", () => {
    expect(() => loadConfig({ PAYPAL_SANDBOX_CLIENT_ID: "sandbox-client" })).toThrow("requires client ID");
    expect(loadConfig({
      PAYPAL_SANDBOX_CLIENT_ID: "sandbox-client",
      PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-secret",
      PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-merchant",
      PAYPAL_SANDBOX_WEBHOOK_ID: "sandbox-webhook",
    }).paypal).toMatchObject({ clientId: "sandbox-client", merchantId: "sandbox-merchant", webhookId: "sandbox-webhook" });
  });
});

const hostedEnvironment = {
  NODE_ENV: "production",
  PAYL_DEPLOYMENT_PROFILE: "hosted_sandbox",
  PAYL_DEV_KEYS: "false",
  PAYL_SIGNING_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  DATABASE_URL: "postgresql://payl:secret@example.neon.tech/payl?sslmode=require",
  APPROVAL_WEB_URL: "https://consumer.example.com",
  MERCHANT_WEB_URL: "https://merchant.example.com",
  PUBLIC_BASE_URL: "https://api.example.com",
  PAYL_ISSUER: "https://api.example.com",
  SANDBOX_CONSUMER_PASSWORD: "HostedConsumer!2026-strong",
  SANDBOX_MERCHANT_PASSWORD: "HostedMerchant!2026-strong",
  SANDBOX_CONSUMER_TOTP_SECRET: "MFRGGZDFMZTWQ2LK",
} satisfies NodeJS.ProcessEnv;

describe("hosted sandbox configuration", () => {
  it("accepts a TLS database and secret-backed signing configuration", () => {
    const config = loadConfig(hostedEnvironment);
    expect(config.deploymentProfile).toBe("hosted_sandbox");
    expect(config.signingMasterKey).toHaveLength(32);
    expect(config.devKeys).toBe(false);
  });

  it("rejects local URLs and known development credentials", () => {
    expect(() => loadConfig({
      ...hostedEnvironment,
      DATABASE_URL: "postgresql://payl:secret@localhost:5432/payl?sslmode=require",
    })).toThrow(/DATABASE_URL must be remote/);
    expect(() => loadConfig({
      ...hostedEnvironment,
      SANDBOX_CONSUMER_PASSWORD: "ConsumerDemo!2026",
    })).toThrow(/replace the demo defaults/);
  });

  it("requires hosted mode and a secret when Node runs in production", () => {
    expect(() => loadConfig({ ...hostedEnvironment, PAYL_DEPLOYMENT_PROFILE: "local_sandbox" })).toThrow(
      /PAYL_DEV_KEYS=false requires/,
    );
    expect(() => loadConfig({ ...hostedEnvironment, PAYL_SIGNING_MASTER_KEY: undefined })).toThrow(
      /require PAYL_SIGNING_MASTER_KEY/,
    );
  });

  it("derives stable, domain-separated signing keys", async () => {
    const masterKey = Buffer.alloc(32, 9);
    const first = createSecretDerivedKey(masterKey, "merchant:one", "hosted:merchant:one");
    const restarted = createSecretDerivedKey(masterKey, "merchant:one", "hosted:merchant:one");
    const other = createSecretDerivedKey(masterKey, "merchant:two", "hosted:merchant:two");
    const payload = { orderId: "order_demo", amountMinor: "1000" };
    const signature = await signPayload(payload, first);

    await expect(verifyPayload(signature, payload, restarted.publicKey)).resolves.toBeUndefined();
    await expect(verifyPayload(signature, payload, other.publicKey)).rejects.toThrow();
  });
});

