import { forwardDelivery } from "../../../_delivery";
export async function POST(request: Request, context: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await context.params;
  return forwardDelivery(`/api/merchant/offers/${encodeURIComponent(offerId)}/delivery`, request);
}
