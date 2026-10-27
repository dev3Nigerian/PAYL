import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAllowedOrigin } from "../_origin";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function forwardConsumerRequest(path: string, request: Request): Promise<NextResponse> {
  const token = (await cookies()).get("payl_consumer_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });

  if (request.method === "POST") {
    if (!hasAllowedOrigin(request)) {
      return NextResponse.json({ error: { message: "Request origin is not allowed" } }, { status: 403 });
    }
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: { message: "JSON content type is required" } }, { status: 415 });
    }
  }

  const upstreamUrl = new URL(path, apiUrl);
  upstreamUrl.search = new URL(request.url).search;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(request.method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(request.method === "POST" ? { body: await request.text() } : {}),
      cache: "no-store",
    });
    const body = await upstream.json() as unknown;
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: { message: "PAYL is temporarily unavailable. Please try again." } }, { status: 503 });
  }
}
