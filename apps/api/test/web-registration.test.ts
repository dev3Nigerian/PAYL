import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../approval-web/app/api/auth/register/route.js";

beforeEach(() => {
  vi.stubEnv("PAYL_PUBLIC_WEB_URL", "");
  vi.stubEnv("RENDER_EXTERNAL_URL", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const input = { displayName: "New Shopper", email: "shopper@example.test", password: "SandboxShopper!2026" };
function signupRequest(body: unknown = input, origin = "http://localhost:3000", contentType = "application/json") {
  return new Request("http://localhost:3000/api/auth/register", { method: "POST", headers: { origin, "content-type": contentType }, body: JSON.stringify(body) });
}

describe("consumer registration browser proxy", () => {
  it("sets an HttpOnly session cookie and never exposes the session token or forwards a chosen grant", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ sessionToken: "test-session", welcomeCredit: { amountMinor: "10000", currency: "USD", sandbox: true } }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(signupRequest({ ...input, amountMinor: "999999", role: "merchant_admin" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ welcomeCredit: { amountMinor: "10000", currency: "USD", sandbox: true } });
    expect(response.headers.get("set-cookie")).toContain("payl_consumer_session=test-session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual(input);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects another browser origin before creating an account", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await POST(signupRequest(input, "https://other.example"))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, [], "bad body"])("rejects a non-object body: %j", async (body) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await POST(signupRequest(body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires JSON content type", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await POST(signupRequest(input, "http://localhost:3000", "text/plain"))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous upstream error or expose the HTML body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<h1>Starting</h1>", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(signupRequest());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain("<h1>");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves a duplicate-email conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "A PAYL account already uses this email. Sign in to continue." } }, { status: 409 })));
    const response = await POST(signupRequest());
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("Sign in") } });
  });

  it("handles plain-text rate limits", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Too many requests", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(signupRequest())).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not set a cookie for a successful response missing a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ welcomeCredit: { amountMinor: "10000" } }, { status: 201 })));
    const response = await POST(signupRequest());
    expect(response.status).toBe(502);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
