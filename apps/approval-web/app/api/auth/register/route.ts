import { NextResponse } from "next/server";
import { hasAllowedOrigin } from "../../_origin";

const apiUrl = process.env.PAYL_API_URL ?? (process.env.NODE_ENV === "production" ? "https://payl-api-dev3nigerian.onrender.com" : "http://localhost:4100");
const headers = { "cache-control": "private, no-store" };
const failure = (status: number, message: string) => NextResponse.json({ error: { message } }, { status, headers });

export async function POST(request: Request) {
  if (!hasAllowedOrigin(request)) return failure(403, "Request origin is not allowed");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return failure(415, "JSON content type is required");
  let input: { displayName?: unknown; email?: unknown; password?: unknown };
  try {
    input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400, "Enter your name, email, and password");
  } catch { return failure(400, "Enter your name, email, and password"); }
  try {
    // Registration is submitted once. A lost response can be recovered by
    // signing in; it must never result in a second welcome grant.
    const upstream = await fetch(new URL("/api/auth/register/consumer", apiUrl), {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ displayName: input.displayName, email: input.email, password: input.password }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (upstream.status === 429) return failure(429, "Too many sign-up attempts. Please try again later.");
    const body = await upstream.json() as { sessionToken?: string; welcomeCredit?: unknown; error?: { message?: string } };
    if (!upstream.ok) return failure(upstream.status, body?.error?.message ?? "Account could not be created. Please try again.");
    if (typeof body?.sessionToken !== "string" || !body.sessionToken) return failure(502, "Account setup could not be confirmed. Try signing in with your email and password.");
    const response = NextResponse.json({ welcomeCredit: body.welcomeCredit }, { status: 201, headers });
    response.cookies.set("payl_consumer_session", body.sessionToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 60 * 60 });
    return response;
  } catch {
    return failure(503, "PAYL could not confirm account setup. Try signing in first; if the account was not created, return here and try again.");
  }
}
