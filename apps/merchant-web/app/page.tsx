import MerchantDashboard, { type MerchantState } from "./merchant-dashboard";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export const dynamic = "force-dynamic";

export default async function Page() {
  const token = (await cookies()).get("payl_merchant_session")?.value;
  if (!token) redirect("/login");
  let state: MerchantState = {
    merchant: null,
    offers: [],
    orders: [],
    ledger: { entries: "0", unbalanced_entries: "0" },
    metrics: {
      funnel: { quotes: "0", orders: "0", quoteToOrderPercent: 0, terminalSuccessPercent: 0, cancelledOrders: "0", refundedOrders: "0", refundRatePercent: 0 },
      approvals: { requested: "0", completed: "0", medianSeconds: null },
      fulfillment: { pending: "0", failed: "0", averageSeconds: null },
      operations: { pending_webhooks: "0", dead_webhooks: "0", payouts: "0", audit_coverage: "0" },
    },
    reconciliation: { differenceMinor: "0", reconciled: true, expectedPositionMinor: "0", actualPositionMinor: "0", unbalancedJournalEntries: "0" },
    payouts: [],
    webhook: null,
    outbox: {},
  };
  let offline = false;
  let response: Response | null = null;
  try {
    response = await fetch(`${apiUrl}/api/merchant/dashboard`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch { response = null; }
  if (response?.status === 401 || response?.status === 403) redirect("/login");
  if (response?.ok) state = await response.json() as MerchantState;
  else offline = true;
  return <MerchantDashboard initialState={state} offline={offline} />;
}
