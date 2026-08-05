import WalletDashboard, { type WalletState } from "./wallet-dashboard";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";

export const dynamic = "force-dynamic";

export default async function Page() {
  const token = (await cookies()).get("payl_consumer_session")?.value;
  if (!token) redirect("/login");
  let state: WalletState | null = null;
  let response: Response | null = null;
  try {
    response = await fetch(`${apiUrl}/api/consumer/dashboard`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    response = null;
  }
  if (response?.status === 401 || response?.status === 403) redirect("/login");
  if (response?.ok) state = await response.json() as WalletState;
  const mcpEndpoints = { consumer: new URL("/mcp", apiUrl).href };
  return <WalletDashboard initialState={state} mcpEndpoints={mcpEndpoints} />;
}
