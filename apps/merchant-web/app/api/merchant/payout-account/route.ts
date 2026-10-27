import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function PUT(request: Request) {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: { message: "Request origin is not allowed" } }, { status: 403 });
  }
  const upstream = await fetch(`${apiUrl}/api/merchant/payout-account`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: await request.text(),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
