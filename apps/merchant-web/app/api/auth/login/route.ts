import { NextResponse } from "next/server";
import { loginUnavailable, requestLogin } from "@payl/ui/auth-server";

const apiUrl = process.env.PAYL_API_URL ?? (process.env.NODE_ENV === "production" ? "https://payl-api-dev3nigerian.onrender.com" : "http://localhost:4100");

export async function POST(request: Request) {
  try {
    const input = await request.json() as { email?: string; password?: string };
    const upstream = await requestLogin(apiUrl, { email: input.email, password: input.password, role: "merchant_admin" });
    if (!upstream.ok) return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
    const { sessionToken, ...safeBody } = upstream.body;
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
    const result = loginUnavailable();
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  }
}
