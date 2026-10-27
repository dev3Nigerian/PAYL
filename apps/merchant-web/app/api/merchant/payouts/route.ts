import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasAllowedOrigin } from "../../_origin";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function POST(request: Request) {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  if (!hasAllowedOrigin(request)) {
    return NextResponse.json({ error: { message: "Request origin is not allowed" } }, { status: 403 });
  }
  const response = await fetch(`${apiUrl}/api/merchant/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: await request.text(),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
