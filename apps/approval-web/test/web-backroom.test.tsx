import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => state.cookies.has(key) ? { value: state.cookies.get(key) } : undefined }) }));
import { POST as login } from "../app/api/backroom/login/route";
import { POST as logout } from "../app/api/backroom/logout/route";
import { GET as records } from "../app/api/backroom/records/route";

beforeEach(() => { state.cookies.clear(); vi.stubEnv("PAYL_PUBLIC_WEB_URL", "http://localhost:3000"); vi.stubEnv("RENDER_EXTERNAL_URL", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const input = { email: "owner@example.test", password: "TestOnlyOwnerPassword!", mfaCode: "123456" };
function post(path = "login", body: unknown = input, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/backroom/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("private backroom browser transport", () => {
  it("isolates the owner cookie, strips the token, disables caches, and sets production cookie protections", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ role: "platform_admin", sessionToken: "private-owner-session" }));
    vi.stubGlobal("fetch", fetcher);
    const response = await login(post("login", { ...input, role: "consumer" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("payl_backroom_session=private-owner-session");
    for (const attribute of ["HttpOnly", "Secure", "SameSite=strict", "Max-Age=3600"]) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain("payl_consumer_session");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(input);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
  });

  it("rejects cross-origin login/logout and malformed credentials without contacting the API", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await login(post("login", input, "https://unrelated.test"))).status).toBe(403);
    expect((await logout(post("logout", {}, "https://unrelated.test"))).status).toBe(403);
    for (const body of [null, [], { ...input, mfaCode: "123" }]) expect((await login(post("login", body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never retries an ambiguous MFA login or accepts a wrong-role session", async () => {
    for (const upstream of [new Response("Starting…", { status: 503 }), Response.json({ role: "consumer", sessionToken: "consumer-token" }), new Response("Too many attempts", { status: 429 })]) {
      const fetcher = vi.fn().mockResolvedValue(upstream); vi.stubGlobal("fetch", fetcher);
      const response = await login(post());
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("requires the dedicated owner cookie for data access and forwards only that credential", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ rows: [] })); vi.stubGlobal("fetch", fetcher);
    state.cookies.set("payl_consumer_session", "consumer-token");
    const incoming = new Request("http://localhost:3000/api/backroom/records?kind=payouts&q=reference", { headers: { authorization: "Bearer other-token" } });
    expect((await records(incoming)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    state.cookies.set("payl_backroom_session", "owner-token");
    const response = await records(incoming);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0]![0].pathname).toBe("/api/backroom/records");
    expect(fetcher.mock.calls[0]![0].search).toBe("?kind=payouts&q=reference");
    expect(fetcher.mock.calls[0]![1].headers.authorization).toBe("Bearer owner-token");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("revokes the API session before clearing only the owner cookie", async () => {
    state.cookies.set("payl_backroom_session", "owner-token");
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
    const response = await logout(post("logout", {}));
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0]![1].headers.authorization).toBe("Bearer owner-token");
    expect(response.headers.get("set-cookie")).toContain("payl_backroom_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).not.toContain("payl_consumer_session");
  });

  it("keeps logout retryable when revocation cannot be confirmed", async () => {
    state.cookies.set("payl_backroom_session", "owner-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await logout(post("logout", {}));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
