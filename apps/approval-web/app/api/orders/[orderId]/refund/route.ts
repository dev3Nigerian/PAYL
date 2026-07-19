import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const token = (await cookies()).get("payl_consumer_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  const { orderId } = await context.params;
  const response = await fetch(`${apiUrl}/api/orders/${encodeURIComponent(orderId)}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: await request.text(),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
