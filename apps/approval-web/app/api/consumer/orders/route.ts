import { forwardConsumerRequest } from "../_proxy";

export async function GET(request: Request) {
  return forwardConsumerRequest("/api/consumer/orders", request);
}
