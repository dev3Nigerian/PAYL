import { forwardDelivery } from "../../../_delivery";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  return forwardDelivery(`/api/merchant/orders/${encodeURIComponent(orderId)}/delivery`, request);
}
