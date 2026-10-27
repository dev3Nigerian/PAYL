import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function GET(_request: Request, context: { params: Promise<{ payoutId: string }> }) {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  const { payoutId } = await context.params;
  const upstream = await fetch(`${apiUrl}/api/merchant/payouts/${encodeURIComponent(payoutId)}`, {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
