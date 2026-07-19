import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export async function GET(_request: Request, context: { params: Promise<{ approvalId: string }> }) {
  const token = (await cookies()).get("payl_consumer_session")?.value;
  if (!token) return NextResponse.json({ error: { message: "Sign in to continue" } }, { status: 401 });
  const { approvalId } = await context.params;
  const upstream = await fetch(`${apiUrl}/api/approvals/${encodeURIComponent(approvalId)}`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
