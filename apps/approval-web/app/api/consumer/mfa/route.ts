import { forwardConsumerRequest } from "../_proxy";

async function forward(request: Request): Promise<Response> {
  const response = await forwardConsumerRequest("/api/consumer/mfa", request);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export const GET = forward;
export const POST = forward;
