import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpPayPalGateway } from "../src/paypal.js";

const credentials = {
  clientId: "sandbox-client",
  clientSecret: "sandbox-secret",
  merchantId: "sandbox-merchant",
  webhookId: "sandbox-webhook",
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("PayPal Sandbox HTTP adapter", () => {
  it("recovers an existing payout batch from PayPal's duplicate response", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 300 });
      if (url.endsWith("/v1/payments/payouts")) return Response.json({
        name: "VALIDATION_ERROR",
        details: [{ issue: "DUPLICATE_BATCH_ID" }],
        links: [{ rel: "self", method: "GET", href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/PP_BATCH_123" }],
      }, { status: 400 });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new HttpPayPalGateway(credentials);
    expect(await gateway.createPayout({ payoutId: "payl_payout_123", amountMinor: 900n, recipientEmail: "merchant@example.com" }))
      .toBe("PP_BATCH_123");
    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
  });

  it("requests a full capture representation and posts the unchanged webhook JSON", async () => {
    const sent: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 300 });
      if (url.endsWith("/capture")) return Response.json({
        id: "PP_ORDER", purchase_units: [{ reference_id: "topup_123", payee: { merchant_id: "sandbox-merchant" },
          payments: { captures: [{ id: "PP_CAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: "25.00" } }] } }],
      });
      if (url.endsWith("/verify-webhook-signature")) return Response.json({ verification_status: "SUCCESS" });
      throw new Error(`Unexpected URL: ${url}`);
    }));
    const gateway = new HttpPayPalGateway(credentials);
    expect(await gateway.captureOrder("PP_ORDER", "topup_123")).toMatchObject({
      captureId: "PP_CAPTURE", amountMinor: 2500n, merchantId: "sandbox-merchant",
    });
    const capture = sent.find((call) => call.url.endsWith("/capture"));
    expect((capture?.init?.headers as Record<string, string>).prefer).toBe("return=representation");

    const raw = Buffer.from('{ "id": "WH-123", "event_type": "PAYMENT.CAPTURE.COMPLETED" }');
    expect(await gateway.verifyWebhook(raw, {
      "paypal-transmission-id": "transmission",
      "paypal-transmission-time": "2026-10-27T10:00:00Z",
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "signature",
    })).toBe(true);
    const verification = sent.find((call) => call.url.endsWith("/verify-webhook-signature"));
    expect(verification?.init?.body).toContain(`"webhook_event":${raw.toString("utf8")}`);
  });
});
