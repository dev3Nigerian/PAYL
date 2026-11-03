import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestLogin } from "../../../packages/ui/src/auth-server.js";

const input = { email: "preview@example.test", password: "test-only-password", role: "consumer" as const };
const success = () => Response.json({ sessionToken: "test-session", userId: "test-user", role: "consumer" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web sign-in upstream recovery", () => {
  it("normalizes the API URL, uses JSON and timeouts, and keeps the supplied account role", async () => {
    const fetcher = vi.fn().mockResolvedValue(success());
    vi.stubGlobal("fetch", fetcher);
    const result = await requestLogin("https://api.example.test/", { ...input, role: "merchant_admin" });
    expect(result).toMatchObject({ ok: true, status: 200, body: { sessionToken: "test-session" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0].href).toBe("https://api.example.test/api/auth/login");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal), headers: { accept: "application/json" } });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ ...input, role: "merchant_admin" });
  });

  it.each([200, 502, 503, 504])("recovers after a %i HTML startup page", async (status) => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("<!doctype html><h1>Starting service</h1>", { status, headers: { "content-type": "text/html" } })).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const pending = requestLogin("https://api.example.test", input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true, body: { sessionToken: "test-session" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(input.password);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(input.email);
  });

  it("stops after three transient failures with a useful 503 and Retry-After", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response("Starting", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const pending = requestLogin("https://api.example.test", input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, status: 503, body: { error: { code: "API_UNAVAILABLE", retryable: true } }, headers: { "retry-after": "15", "cache-control": "no-store" } });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("recovers from a network timeout without leaking its message", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error(`timeout: ${input.password}`)).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const pending = requestLogin("https://api.example.test", input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(input.password);
  });

  it("preserves invalid-credential errors without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect", retryable: false } }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestLogin("https://api.example.test", input)).toMatchObject({ ok: false, status: 401, body: { error: { code: "INVALID_CREDENTIALS", retryable: false } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("handles text rate-limit responses without retrying or treating them as malformed JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Too many requests, please try again later.", { status: 429, headers: { "retry-after": "900" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestLogin("https://api.example.test", input)).toMatchObject({ ok: false, status: 429, body: { error: { code: "RATE_LIMITED" } }, headers: { "retry-after": "900" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a rejected login when its error body cannot be read", async () => {
    const response = Response.json({ error: { code: "INVALID_CREDENTIALS" } }, { status: 401 });
    vi.spyOn(response, "text").mockRejectedValue(new Error("stream interrupted"));
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    expect(await requestLogin("https://api.example.test", input)).toMatchObject({ ok: false, status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry or expose HTML for an incorrect API endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<h1>Not found</h1>", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await requestLogin("https://api.example.test", input);
    expect(result).toMatchObject({ ok: false, status: 502, body: { error: { code: "AUTH_UPSTREAM_ERROR", retryable: false } } });
    expect(JSON.stringify(result)).not.toContain("<h1>");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { sessionToken: 123 }, { sessionToken: "" }])("rejects successful JSON without a valid session token: %j", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestLogin("https://api.example.test", input)).toMatchObject({ ok: false, status: 502, body: { error: { code: "AUTH_UPSTREAM_ERROR" } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
