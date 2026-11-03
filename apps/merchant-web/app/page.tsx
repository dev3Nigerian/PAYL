import { redirect } from "next/navigation";
import { webUrls } from "@payl/ui/urls";

export const dynamic = "force-dynamic";

export default function Page() {
  redirect(webUrls().home);
}
