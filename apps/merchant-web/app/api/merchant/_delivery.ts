import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAllowedOrigin } from "../_origin";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function forwardDelivery(path: string, request: Request, raw = true): Promise<Response> {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  if (!hasAllowedOrigin(request)) return NextResponse.json({ error: { message: "Request origin is not allowed" } }, { status: 403 });
  const type = raw ? "application/octet-stream" : "application/json";
  if (request.headers.get("content-type")?.split(";")[0] !== type) return NextResponse.json({ error: { message: "Unexpected content type" } }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: { message: "A request body is required" } }, { status: 400 });
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > (raw ? 5 * 1024 * 1024 : 16 * 1024)) {
        await reader.cancel();
        return NextResponse.json({ error: { message: "File or request is too large (files: 5 MB maximum)" } }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const url = new URL(path, apiUrl);
    url.search = new URL(request.url).search;
    const response = await fetch(url, { method: "POST", headers: { "content-type": type, authorization: `Bearer ${token}` }, body, cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: { message: "Upload could not finish. Please try again." } }, { status: 503 });
  } finally { reader.releaseLock(); }
}
