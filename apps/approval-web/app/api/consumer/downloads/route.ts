import { forwardConsumerRequest } from "../_proxy";

export async function GET(request: Request) {
  const response = await forwardConsumerRequest("/api/consumer/downloads", request);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
