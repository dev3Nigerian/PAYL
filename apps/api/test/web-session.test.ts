import { afterEach, describe, expect, it, vi } from "vitest";
import { hasActiveWebSession } from "../../../packages/ui/src/auth-server.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("returning users entering a workspace", () => {
  it("does not contact the API for a visitor without a session", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await hasActiveWebSession("https://api.example.test", undefined, "consumer")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["consumer", "merchant_admin"] as const)("accepts an API-verified %s session without sharing or caching credentials", async (role) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ userId: "user-1", role }));
    vi.stubGlobal("fetch", fetcher);
    expect(await hasActiveWebSession("https://api.example.test/", "private-session", role)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0].href).toBe("https://api.example.test/api/auth/session");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: "Bearer private-session", accept: "application/json" },
      cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    });
  });

  it.each([401, 403, 503])("keeps sign-in available after a %i, without a redirect loop or repeated requests", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Unavailable", { status }));
    vi.stubGlobal("fetch", fetcher);
    expect(await hasActiveWebSession("https://api.example.test", "expired-session", "consumer")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { userId: "user-1", role: "merchant_admin" },
    { userId: "user-1", role: "unknown" },
    { userId: "", role: "consumer" },
    { role: "consumer" },
    null,
  ])("does not route a wrong-role or malformed session into the consumer dashboard: %j", async (session) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(session)));
    expect(await hasActiveWebSession("https://api.example.test", "session", "consumer")).toBe(false);
  });

  it("does not route a consumer session into the merchant dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ userId: "user-1", role: "consumer" })));
    expect(await hasActiveWebSession("https://api.example.test", "session", "merchant_admin")).toBe(false);
  });

  it("keeps sign-in available when Render returns an HTML page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><h1>Starting</h1>")));
    expect(await hasActiveWebSession("https://api.example.test", "session", "consumer")).toBe(false);
  });

  it("keeps sign-in available when the API request times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Request timed out", "TimeoutError")));
    expect(await hasActiveWebSession("https://api.example.test", "session", "consumer")).toBe(false);
  });
});
