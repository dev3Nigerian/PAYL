import { NextResponse } from "next/server";
import { hasAllowedOrigin } from "../../_origin";
import { backroomCookie, backroomError, ownerFetch, privateHeaders } from "../_server";

export async function POST(request: Request) {
  if (!hasAllowedOrigin(request)) return backroomError("Request origin is not allowed", 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return backroomError("JSON content type is required", 415);
  let input: unknown;
  try { input = await request.json(); } catch { return backroomError("Enter your owner login details", 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return backroomError("Enter your owner login details", 400);
  const { email, password, mfaCode } = input as Record<string, unknown>;
  if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length > 128 || typeof mfaCode !== "string" || !/^\d{6}$/.test(mfaCode)) return backroomError("Enter an email, password, and six-digit authenticator code", 400);
  try {
    // Do not retry: an ambiguous response may already have consumed this TOTP code.
    const upstream = await ownerFetch("/api/backroom/login", undefined, { email, password, mfaCode });
    if (upstream.status === 429) return backroomError("Too many sign-in attempts. Try again in 15 minutes.", 429);
    const body = await upstream.json() as { sessionToken?: string; role?: string; error?: { message?: string; code?: string } };
    if (!upstream.ok) return backroomError(body.error?.message ?? "Owner sign-in is unavailable", upstream.status, body.error?.code);
    if (typeof body.sessionToken !== "string" || !body.sessionToken || body.role !== "platform_admin") return backroomError("Owner sign-in returned an invalid session", 502);
    const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
    response.cookies.set(backroomCookie, body.sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 3600 });
    return response;
  } catch { return backroomError("Owner sign-in is temporarily unavailable. Please try again with a new authenticator code.", 503); }
}
