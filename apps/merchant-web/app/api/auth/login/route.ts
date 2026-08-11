import { NextResponse } from "next/server";

const apiUrl = process.env.PAYL_API_URL ?? (process.env.NODE_ENV === "production" ? "https://payl-api-dev3nigerian.onrender.com" : "http://localhost:4100");

type ApiBody = Record<string, unknown> & { sessionToken?: string };

async function readApiBody(response: Response): Promise<ApiBody> {
  const text = await response.text();
  if (!text.trim()) return { error: { code: "UPSTREAM_EMPTY_RESPONSE", message: "PAYL API returned an empty response" } };
  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    return { error: { code: "UPSTREAM_INVALID_RESPONSE", message: "PAYL API returned an invalid response" } };
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as { email?: string; password?: string };
    const upstream = await fetch(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, role: "merchant_admin" }),
    });
    const body = await readApiBody(upstream);
    if (!upstream.ok || !body.sessionToken) return NextResponse.json(body, { status: upstream.ok ? 502 : upstream.status });
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
  } catch {
    return NextResponse.json({ error: { code: "API_UNAVAILABLE", message: "PAYL is waking up or temporarily unavailable. Please try again shortly." } }, { status: 503 });
  }
}
