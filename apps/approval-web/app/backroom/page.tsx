import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { backroomCookie, ownerFetch } from "../api/backroom/_server";
import { BackroomDashboard } from "./dashboard";

export default async function BackroomPage() {
  const token = (await cookies()).get(backroomCookie)?.value;
  if (!token) redirect("/backroom/login");
  let status = 503;
  let ownerEmail = "Owner";
  let expiresAt = "";
  try {
    const response = await ownerFetch("/api/auth/session", token);
    status = response.status;
    if (response.ok) {
      const session = await response.json() as { role?: string; email: string; expiresAt: string };
      if (session.role !== "platform_admin") status = 403;
      else { ownerEmail = session.email; expiresAt = session.expiresAt; }
    }
  } catch { status = 503; }
  if (status === 401 || status === 403) redirect("/backroom/login");
  if (status !== 200) return <main className="br-unavailable"><h1>Backroom temporarily unavailable</h1><p>Your session could not be checked. Try again when the API is reachable.</p><a className="br-button" href="/backroom">Try again</a><a href="/backroom/login">Back to sign in</a></main>;
  return <BackroomDashboard ownerEmail={ownerEmail} expiresAt={expiresAt} />;
}
