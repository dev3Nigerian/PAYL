import { forwardConsumerRequest } from "../../_proxy";

export async function POST(request: Request) {
  return forwardConsumerRequest("/api/consumer/checkout/quote", request);
}
