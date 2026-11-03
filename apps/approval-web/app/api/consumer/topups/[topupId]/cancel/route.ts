import { forwardConsumerRequest } from "../../../_proxy";

export async function POST(request: Request, context: { params: Promise<{ topupId: string }> }) {
  const { topupId } = await context.params;
  return forwardConsumerRequest(`/api/consumer/topups/${encodeURIComponent(topupId)}/cancel`, request);
}
