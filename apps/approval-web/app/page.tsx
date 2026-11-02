import type { Metadata } from "next";
import { Brand, Icon } from "@payl/ui";
import { webUrls } from "@payl/ui/urls";
import "./landing.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "PAYL — Shop with AI or sell on PAYL",
  description: "Discover and buy digital products through AI chat. Set your spending limits, fund your PAYL wallet with PayPal Sandbox, or bring your business to AI shoppers.",
};

export default function HomePage() {
  const urls = webUrls();
  return <div className="landing-page">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="landing-nav"><Brand /><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#for-shoppers">For shoppers</a><a href="#for-merchants">For sellers</a></nav><a className="nav-signin" href="#choose-your-path">Sign in / Get started <Icon name="arrow" size={16} /></a></header>
    <main id="main">
      <section className="landing-hero">
        <div className="hero-copy">
          <span className="launch-badge"><span /> For your next find. And your next customer.</span>
          <h1>A new way to<br /><span>shop and sell.</span></h1>
          <p>Find what you need through AI chat, or bring your products to people ready to buy. Choose where you’d like to start.</p>
          <section className="entry-paths" id="choose-your-path" aria-labelledby="entry-heading" tabIndex={-1}>
            <h2 id="entry-heading">What brings you to PAYL?</h2>
            <div className="entry-grid">
              <article className="entry-card entry-shopper" aria-labelledby="shop-entry-heading">
                <span className="entry-symbol"><Icon name="sparkles" size={23} /></span>
                <h3 id="shop-entry-heading">I’m here to shop</h3>
                <p>Discover, buy, and track your orders in one conversation.</p>
                <span className="entry-note"><Icon name="wallet" size={15} /> $100 free sandbox credit</span>
                <a className="button-link" href="/register">Shop with AI <Icon name="arrow" size={16} /></a>
                <a className="entry-signin" href="/login">Shopper sign in <Icon name="arrow" size={14} /></a>
              </article>
              <article className="entry-card entry-seller" aria-labelledby="sell-entry-heading">
                <span className="entry-symbol"><Icon name="box" size={23} /></span>
                <h3 id="sell-entry-heading">I’m here to sell</h3>
                <p>List your digital products, fulfill orders, and follow earnings.</p>
                <span className="entry-note"><Icon name="box" size={15} /> Your own merchant workspace</span>
                <a className="button-link" href={urls.merchantRegister}>Sell on PAYL <Icon name="arrow" size={16} /></a>
                <a className="entry-signin" href={urls.merchantLogin}>Seller sign in <Icon name="arrow" size={14} /></a>
              </article>
            </div>
          </section>
          <div className="hero-footnote"><Icon name="shield" size={16} /><span>Try PAYL with virtual USD. No real-money transactions.</span></div>
        </div>
        <div className="hero-demo" aria-label="Illustrative shopping conversation, not a live offer">
          <div className="demo-orbit orbit-one" /><div className="demo-orbit orbit-two" />
          <div className="demo-label"><span className="overline">From a thought to a great find</span><Icon name="sparkles" size={22} /></div>
          <div className="conversation-preview"><div className="preview-header"><span className="preview-avatar"><Icon name="sparkles" /></span><div><strong>PAYL AI</strong><small>Your shopping companion</small></div><span className="preview-live">Example</span></div><div className="preview-conversation"><div className="preview-user">Find a design toolkit under $30.<br />Something I can download today.</div><div className="preview-answer"><span className="mini-spark"><Icon name="sparkles" size={17} /></span><p>Let’s find a fit for your next big idea.</p></div><div className="preview-product"><div className="product-art" aria-hidden="true"><span /><span /><span /><span /></div><div><span className="product-type">DIGITAL DOWNLOAD</span><h3>The creator’s toolkit</h3><p>A little head start for your next project.</p><div className="preview-product-bottom"><strong>$24.00</strong><span><Icon name="check" size={12} /> Within your budget</span></div></div></div><div className="preview-composer"><span>And just like that, you’re a step closer.</span><Icon name="send" size={16} /></div></div></div>
          <div className="demo-policy"><span><Icon name="shield" size={19} /></span><div><strong>You’re always in control</strong><small>Your limits apply to every purchase.</small></div><Icon name="check" size={17} /></div>
        </div>
      </section>
      <div className="landing-principles"><span>Built around you.</span><p><Icon name="sparkles" size={17} /> Discover through conversation</p><p><Icon name="wallet" size={17} /> One wallet for your purchases</p><p><Icon name="shield" size={17} /> Your rules, every time</p></div>
      <section className="landing-how" id="how-it-works"><div className="section-heading"><div><span className="overline">Less friction. More possibility.</span><h2>A few words.<br />A whole new way to shop.</h2></div><p>From digital downloads to specialist services, PAYL brings discovery, purchase, and delivery into the same conversation.</p></div><div className="how-grid">{[
        { number: "01", icon: "wallet" as const, title: "Make it yours", text: "Create your account with $100 in sandbox credit. Set your spending limits and add more virtual funds with PayPal." },
        { number: "02", icon: "sparkles" as const, title: "Ask for what you need", text: "Describe your idea, budget, or preferences. Your AI finds current offers from PAYL merchants." },
        { number: "03", icon: "box" as const, title: "Find it. Buy it. Keep going.", text: "Choose an offer, approve when required, and find your order and delivery right in chat." },
      ].map((step) => <article key={step.number}><div className="how-top"><Icon name={step.icon} size={25} /><span>{step.number}</span></div><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></section>
      <section className="landing-workspaces" aria-label="Explore PAYL"><article className="shopper-path" id="for-shoppers"><div className="path-symbol"><Icon name="sparkles" size={28} /></div><span className="overline">For shoppers</span><h2>Less tab hopping.<br />More “that’s the one.”</h2><p>Explore products, manage your wallet, and follow every order from one personal workspace.</p><ul><li><Icon name="check" size={16} /> AI discovery and guided purchases</li><li><Icon name="check" size={16} /> Spending limits and approval controls</li><li><Icon name="check" size={16} /> Orders, downloads, and eligible refunds</li></ul><a className="button-link" href="/register">Shop with AI <Icon name="arrow" size={18} /></a><a className="register-link" href="/login">Already have a shopper account? Sign in →</a></article><article className="merchant-path" id="for-merchants"><div className="path-symbol"><Icon name="box" size={28} /></div><span className="overline">For sellers</span><h2>Your next customer<br />shops differently.</h2><p>Bring your digital products and services to a catalog that AI shoppers can discover and buy from.</p><ul><li><Icon name="check" size={16} /> Manage your products and pricing</li><li><Icon name="check" size={16} /> Receive and fulfill AI purchases</li><li><Icon name="check" size={16} /> Withdraw with PayPal Sandbox</li></ul><a className="button-link" href={urls.merchantRegister}>Sell on PAYL <Icon name="arrow" size={18} /></a><a className="register-link" href={urls.merchantLogin}>Already have a seller account? Sign in →</a></article></section>
      <section className="landing-control"><div className="control-mark"><Icon name="shield" size={34} /></div><div><span className="overline">A little autonomy. A lot of control.</span><h2>Your AI can shop.<br />You set the boundaries.</h2><p>Every purchase follows your PAYL spending policy. Set per-purchase and daily limits, with a separate approval step for payments above your auto-approval limit.</p></div><a href="/dashboard">Explore your controls <Icon name="arrow" size={18} /></a></section>
    </main>
    <footer className="landing-footer"><div><Brand /><p>Commerce, in conversation.</p></div><p className="footer-sandbox"><span className="sandbox-dot" /> Currently in sandbox<br /><small>Virtual USD · PayPal Sandbox · No real-money transactions</small></p><a href="#choose-your-path">Shop with AI or sell on PAYL <Icon name="arrow" size={16} /></a></footer>
  </div>;
}
