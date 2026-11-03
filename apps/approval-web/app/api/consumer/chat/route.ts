import { forwardConsumerRequest } from "../_proxy";

export async function GET(request: Request) {
  return forwardConsumerRequest("/api/consumer/chat", request);
}

export async function POST(request: Request) {
  return forwardConsumerRequest("/api/consumer/chat", request);
}
