import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAllowedOrigin as consumerAllowsOrigin } from "../../approval-web/app/api/_origin.js";
import { hasAllowedOrigin as merchantAllowsOrigin } from "../../merchant-web/app/api/_origin.js";

afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["consumer", consumerAllowsOrigin],
  ["merchant", merchantAllowsOrigin],
])("%s browser write origin", (_app, hasAllowedOrigin) => {
  it("accepts the public Render origin when Next.js sees an internal URL", () => {
    vi.stubEnv("PAYL_PUBLIC_WEB_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://payl.example.onrender.com");

    const request = new Request("http://0.0.0.0:10000/api/route", {
      method: "POST",
      headers: { origin: "https://payl.example.onrender.com" },
    });
    expect(hasAllowedOrigin(request)).toBe(true);
  });

  it("rejects another site and requests without an Origin header", () => {
    vi.stubEnv("PAYL_PUBLIC_WEB_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://payl.example.onrender.com");

    const request = (origin?: string) => new Request("http://0.0.0.0:10000/api/route", {
      method: "POST",
      headers: origin ? { origin } : {},
    });
    expect(hasAllowedOrigin(request("https://other.example"))).toBe(false);
    expect(hasAllowedOrigin(request())).toBe(false);
  });

  it("uses an explicitly configured custom domain", () => {
    vi.stubEnv("PAYL_PUBLIC_WEB_URL", "https://payl.example.com/");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://payl.example.onrender.com");

    const request = new Request("http://0.0.0.0:10000/api/route", {
      method: "POST",
      headers: { origin: "https://payl.example.com" },
    });
    expect(hasAllowedOrigin(request)).toBe(true);
  });

  it("uses the request URL during local development", () => {
    vi.stubEnv("PAYL_PUBLIC_WEB_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "");

    const request = new Request("http://localhost:3000/api/route", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(hasAllowedOrigin(request)).toBe(true);
  });
});
