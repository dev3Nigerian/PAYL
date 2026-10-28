import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAllowedOrigin } from "../_origin";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function forwardConsumerRequest(path: string, request: Request): Promise<Response> {
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
        accept: request.headers.get("accept") === "application/x-ndjson" ? "application/x-ndjson" : "application/json",
        ...(request.method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(request.method === "POST" ? { body: await request.text() } : {}),
      cache: "no-store",
    });
    if (upstream.ok && (upstream.headers.get("content-type")?.includes("application/x-ndjson") || upstream.headers.has("content-disposition"))) {
      return new Response(upstream.body, { status: upstream.status, headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, no-store, no-transform", "x-accel-buffering": "no", "x-content-type-options": "nosniff",
        ...(upstream.headers.has("content-disposition") ? { "content-disposition": upstream.headers.get("content-disposition")! } : {}),
      } });
    }
    const body = await upstream.json() as unknown;
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: { message: "PAYL is temporarily unavailable. Please try again." } }, { status: 503 });
  }
}
