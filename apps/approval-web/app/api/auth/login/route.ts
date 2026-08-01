import { NextResponse } from "next/server";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function POST(request: Request) {
  const input = await request.json() as { email?: string; password?: string; oauthHandoff?: boolean };
  const upstream = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password, role: "consumer" }),
  });
  const body = await upstream.json() as Record<string, unknown> & { sessionToken?: string };
  if (!upstream.ok || !body.sessionToken) return NextResponse.json(body, { status: upstream.status });
  const { sessionToken, ...safeBody } = body;
  let handoffUrl: string | undefined;
  if (input.oauthHandoff) {
    const handoff = await fetch(`${apiUrl}/api/auth/handoff`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const handoffBody = await handoff.json() as { handoffUrl?: string; error?: { message?: string } };
    if (!handoff.ok || !handoffBody.handoffUrl) {
      return NextResponse.json({ error: { code: "HANDOFF_FAILED", message: handoffBody.error?.message ?? "Secure OAuth handoff could not be created" } }, { status: 502 });
    }
    handoffUrl = handoffBody.handoffUrl;
  }
  const response = NextResponse.json({ ...safeBody, ...(handoffUrl ? { handoffUrl } : {}) });
  response.cookies.set("payl_consumer_session", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
