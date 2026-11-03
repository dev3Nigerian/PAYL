import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const backroomCookie = "payl_backroom_session";
export const privateHeaders = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" };
const apiUrl = process.env.PAYL_API_URL ?? (process.env.NODE_ENV === "production" ? "https://payl-api-dev3nigerian.onrender.com" : "http://localhost:4100");

export function backroomError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: { message, ...(code ? { code } : {}) } }, { status, headers: privateHeaders });
}

export function ownerFetch(path: string, token?: string, body?: unknown) {
  return fetch(new URL(path, apiUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
}

export async function forwardBackroomRequest(path: "overview" | "records", request: Request) {
  const token = (await cookies()).get(backroomCookie)?.value;
  if (!token) return backroomError("Sign in to the backroom to continue", 401);
  try {
    const search = new URL(request.url).search;
    const upstream = await ownerFetch(`/api/backroom/${path}${search}`, token);
    if (upstream.status === 429) return backroomError("Too many requests. Please wait a moment.", 429);
    const body: unknown = await upstream.json();
    return NextResponse.json(body, { status: upstream.status, headers: privateHeaders });
  } catch {
    return backroomError("The backroom is temporarily unavailable. Please try again.", 503);
  }
}
