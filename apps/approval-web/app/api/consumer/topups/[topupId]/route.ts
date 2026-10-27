import { forwardConsumerRequest } from "../../_proxy";

export async function GET(request: Request, context: { params: Promise<{ topupId: string }> }) {
  const { topupId } = await context.params;
  return forwardConsumerRequest(`/api/consumer/topups/${encodeURIComponent(topupId)}`, request);
}
