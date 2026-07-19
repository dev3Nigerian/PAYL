import { NextResponse } from "next/server";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function POST(request: Request) {
  const input = await request.json() as { email?: string; password?: string };
  const upstream = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, role: "merchant_admin" }),
  });
  const body = await upstream.json() as Record<string, unknown> & { sessionToken?: string };
  if (!upstream.ok || !body.sessionToken) return NextResponse.json(body, { status: upstream.status });
  const { sessionToken, ...safeBody } = body;
  const response = NextResponse.json(safeBody);
  response.cookies.set("payl_merchant_session", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
