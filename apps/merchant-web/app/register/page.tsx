import RegisterForm from "./register-form";
import { webUrls } from "@payl/ui/urls";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const urls = webUrls();
  return <RegisterForm homeUrl={urls.home} consumerLogin={urls.consumerLogin} />;
}
