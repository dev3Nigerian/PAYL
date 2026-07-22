import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ApprovalClient from "./approval-client";

export default async function ApprovalPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  const token = (await cookies()).get("payl_consumer_session")?.value;
  if (!token) redirect(`/login?returnTo=${encodeURIComponent(`/approve/${approvalId}`)}`);
  return <ApprovalClient approvalId={approvalId} />;
}
