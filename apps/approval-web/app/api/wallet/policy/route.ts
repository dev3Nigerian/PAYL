import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

async function forward(method: "GET" | "PUT", request?: Request) {
  const token = (await cookies()).get("payl_consumer_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    cache: "no-store",
  };
  if (request) init.body = await request.text();
  const response = await fetch(`${apiUrl}/api/wallet/policy`, init);
  const body = await response.json();
  return NextResponse.json(body, { status: response.status });
}

export async function GET() {
  return forward("GET");
}

export async function PUT(request: Request) {
  return forward("PUT", request);
}
