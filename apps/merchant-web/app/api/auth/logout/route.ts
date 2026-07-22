import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function POST() {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (token) await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set("payl_merchant_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
