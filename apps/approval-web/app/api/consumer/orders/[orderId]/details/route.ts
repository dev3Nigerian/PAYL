import { forwardConsumerRequest } from "../../../_proxy";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  return forwardConsumerRequest(`/api/consumer/orders/${encodeURIComponent(orderId)}/details`, request);
}
