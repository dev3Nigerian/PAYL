import { NextResponse } from "next/server";
import { forwardConsumerRequest } from "../../../_proxy";

export async function POST(request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await context.params;
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(paymentId)) {
    return NextResponse.json({ error: { message: "Payment ID is invalid" } }, { status: 400 });
  }
  return forwardConsumerRequest(`/api/payments/${encodeURIComponent(paymentId)}/cancel`, request);
}
