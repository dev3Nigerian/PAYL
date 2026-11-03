import { Brand, Icon } from "@payl/ui";
import { OwnerLogin } from "./owner-login";

export default function BackroomLoginPage() {
  return <main className="br-login">
    <section className="br-login-story"><Brand light /><span className="br-kicker">Antspace / Operations</span><h1>A clear view<br />behind the scenes.</h1><p>Follow the money, track deliveries, and see what needs your attention.</p><div className="br-login-assurance"><Icon name="shield" /><span>Owner access · Authenticator protected</span></div><small>Sandbox · Virtual transactions</small></section>
    <section className="br-login-main"><a className="br-home-link" href="/">← Antspace home</a><div className="br-login-card"><span className="br-kicker">Private workspace</span><h2>Welcome to the backroom.</h2><p>Sign in with your owner account to view platform activity.</p><OwnerLogin /><p className="br-login-note">Use the separate owner credentials configured for Antspace. Shopper and merchant accounts do not have access.</p></div><small>Sessions expire after one hour.</small></section>
  </main>;
}
