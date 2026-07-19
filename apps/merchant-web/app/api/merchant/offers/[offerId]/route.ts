import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";
const merchantId = process.env.SANDBOX_MERCHANT_ID ?? "merchant_demo";

export async function PATCH(request: Request, context: { params: Promise<{ offerId: string }> }) {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  const { offerId } = await context.params;
  const response = await fetch(`${apiUrl}/api/merchants/${merchantId}/offers/${encodeURIComponent(offerId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: await request.text(),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
