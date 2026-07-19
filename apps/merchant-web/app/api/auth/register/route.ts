import { NextResponse } from "next/server";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function POST(request: Request) {
  const input = await request.json() as {
    businessName?: string;
    adminName?: string;
    email?: string;
    password?: string;
  };
  const upstream = await fetch(`${apiUrl}/api/auth/register/merchant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await upstream.json() as Record<string, unknown> & { sessionToken?: string };
  if (!upstream.ok || !body.sessionToken) return NextResponse.json(body, { status: upstream.status });
  const { sessionToken, ...safeBody } = body;
  const response = NextResponse.json(safeBody, { status: 201 });
  response.cookies.set("payl_merchant_session", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
