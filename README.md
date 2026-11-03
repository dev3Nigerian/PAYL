# Antspace — Buy digital products through conversation

**Updated:** 3 November 2026 · **Status:** Hosted hackathon sandbox · **License:** [AGPL-3.0-only](LICENSE)

**Product direction:** Consumer AI to merchant AI commerce through MCP

## Try the hackathon build

- **Live app:** [antspace.online](https://antspace.online/) — choose **Shop with AI** or **Sell on Antspace**.
- **Submission source:** the [`main` branch](https://github.com/dev3Nigerian/PAYL/tree/main) contains the current Antspace release.
- **Shopper test:** register for $100 in virtual USD, ask "Find a portfolio template under $30", buy a product through chat, and open **My downloads** to retrieve it.
- **Merchant test:** create a merchant account, publish a digital product with a delivery file, and inspect orders and settlement after a shopper buys it.
- **PayPal demonstration:** wallet top-ups and merchant withdrawals use PayPal Sandbox. Individual AI purchases use Antspace's signed quotes, spending policy, mandates, and ledger.

The local setup below runs the API, both dashboards, and the sample catalog. In-app AI chat additionally requires a server-side DeepSeek API key; PayPal funding and payouts require PayPal Sandbox credentials. See [the deployment and provider setup guide](docs/deployment/render-neon.md). The published development credentials below are for local testing; hosted users register their own accounts.

Antspace is the customer-facing name of the PAYL project. The existing `@payl/*` packages, `PAYL_*` environment keys, session cookies, signing identities, and API/webhook addresses retain their names for compatibility. The rebrand requires no database reset or migration. Existing signed terms and purchased files retain their original content.

The public domains are `antspace.online` for the shared entry and shopper workspace and `merchants.antspace.online` for sellers. The Blueprint and production navigation use these domains. See the [domain connection guide](docs/deployment/antspace-domain.md) for DNS, environment settings, and verification. The original Render addresses remain available during DNS propagation.

After buying, open **My downloads** in the shopper dashboard to download delivered files, including older purchases. **Orders & activity** also has a download button on each fulfilled order with an attached file. The library refreshes when opened and supports loading older files; it does not require AI chat. Downloads remain private to the purchasing account and become unavailable after a refund or cancellation.

## Product thesis

Antspace will be a two-sided payment and commerce network for consumers and merchants:

> **A consumer gives an AI bounded spending authority. The AI connects once to the Antspace commerce MCP network, discovers registered merchants, obtains merchant-signed quotes, authorizes payment through Antspace, commits merchant-bound orders, and receives verifiable receipts.**

The direction is consumer-and-merchant commerce—not an enterprise-only authorization product.

## Running sandbox

Prerequisites: Node.js 24 LTS, pnpm 11, and Docker Desktop.

```powershell
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev
```

This starts:

- Antspace API and MCP servers at `http://localhost:4100`.
- Consumer approval web app at `http://localhost:3000`.
- Merchant console at `http://localhost:3001`.
- PostgreSQL 18 at `localhost:54329`.
- An isolated, temporary test PostgreSQL instance at `localhost:54330` when `pnpm test` runs.

In another terminal, run the two-connection reference consumer agent:

```powershell
pnpm demo
```

The agent first prints an OAuth authorization URL. Open it, sign in as the consumer, and approve the requested MCP scopes. When a payment requires human approval, open the returned approval URL, review the immutable quote, and enter the current authenticator code.

Generate the current sandbox authenticator code with:

```powershell
pnpm auth:code
```

For interactive testing, signed quotes last 60 minutes, approval challenges last 45 minutes, and asynchronous fulfillment lasts 60 minutes by default. The lifecycle worker releases expired reservations and cancels timed-out fulfillment automatically. These values are sandbox-only and configurable through `.env`.

Verification commands:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

The database is preloaded with $1,000 of simulated consumer funds. With PayPal Sandbox configured, consumers can also add virtual USD through PayPal Checkout and merchants can withdraw virtual USD through PayPal Payouts. Antspace agent purchases still use signed quotes, spending policy, mandates, and its internal ledger. No real money, card data, bank credentials, or reusable approval credentials are used. Fresh sandbox databases use USD; recreate an existing local sandbox database to remove historical signed artifacts.

## Hosting the public sandbox

Antspace includes Docker images and a Render Blueprint for a three-service hosted sandbox backed by Neon PostgreSQL. The hosted profile requires HTTPS, a remote TLS database, rotated credentials, and a secret-derived signing hierarchy; the API fails closed if any of those requirements is missing.

Follow [the Render and Neon deployment runbook](docs/deployment/render-neon.md). The Blueprint uses one paid Starter instance for each of the three web services ($7 each, $21/month base compute), so idle traffic does not put the dashboards or API lifecycle processing to sleep. Render credits apply through workspace billing. The hosted profile remains simulated-funds-only and is not a live payment deployment.

`render.yaml` pins all three services to `main` and waits for passing CI checks before automatic deployments. Existing installations must also switch their Blueprint's linked branch to `main`; follow [the branch cutover steps](docs/deployment/render-neon.md#switch-an-existing-blueprint-to-main) so future infrastructure updates come from the same branch.

The private [Antspace Backroom](https://antspace.online/backroom) provides owner-only monitoring of shoppers, merchants, orders, wallet funding, withdrawals, ledger journals, audit events, and webhook deliveries. It runs inside the existing consumer service. Access requires a separate owner email, password, and authenticator; it stays disabled until configured. Follow [the backroom setup guide](docs/deployment/backroom.md).

Sandbox dashboard accounts:

| Workspace | Email | Password |
|---|---|---|
| Consumer | `consumer@payl.local` | `ConsumerDemo!2026` |
| Merchant | `merchant@payl.local` | `MerchantDemo!2026` |

The consumer TOTP seed is `JBSWY3DPEHPK3PXP`. It is a public local-development secret and must never be reused outside this sandbox.

## Using the dashboards

Share one entry link: [Antspace home](https://antspace.online/) (or `http://localhost:3000/` locally). The landing page offers **Shop with AI** and **Sell on Antspace**, with separate sign-up and sign-in links for each. The merchant site's root redirects to this same home page. Each workspace remains directly accessible at its own `/dashboard`, and the Antspace logo returns to the shared landing page.

Signed-in shoppers and merchants skip their workspace's login and registration forms after the API verifies their session. Expired sessions leave sign-in available; consumer approval links and OAuth handoffs keep their existing return flow. Sessions stay on their respective web origins.

Consumers can create an account at `/register` on the consumer web app. Each new account receives exactly **$100 in virtual USD** once, signs in automatically, and gets its own wallet and spending policy. The welcome credit has no cash value and does not call PayPal. Existing accounts keep their balances; signing in or retrying registration does not grant another credit. The seeded demo account retains its existing $1,000 allocation.

New consumers can set up their own time-based authenticator under **Security**. Add the displayed setup key to an authenticator app and verify its six-digit code. The default auto-approval limit is $50, with $500 per-transaction and $1,000 daily limits; purchases above the auto-approval limit require MFA. Existing enrolled accounts keep their authenticator. Merchant sign-up remains at `/register` on the merchant web app.

### Sample digital marketplace

The sandbox contains **18 original sample downloads across six merchants**, priced from **$9 to $69 in virtual USD**. Every product includes a ZIP of usable sample files and a README, delivers immediately after an authorized purchase, and has a seven-day refund window.

| Sample merchant | Products and virtual USD prices |
| --- | --- |
| Atlas Digital Market | Customer Interview Workbook $19; Freelancer Proposal Kit $29; Startup Launch Playbook $69 |
| Pixel & Pine Studio | Minimal Portfolio Template $24; Sage Brand Starter Kit $39; Social Post Layout Pack $15 |
| Code Harbor | Responsive Pricing Page $32; JavaScript Utilities Pack $22; API Integration Checklist $12 |
| Papertrail Productivity | Weekly Focus Planner $9; Freelance Project Tracker $18; Content Calendar Toolkit $27 |
| Brightside Growth | Product Launch Email Kit $21; SEO Content Brief Kit $25; Customer Research Sprint $59 |
| Storyloom Press | Short Story Starter Workbook $14; Newsletter Writing Kit $17; Creator Storytelling Mini-Course $45 |

Try asking the shopping chat **“Find a portfolio template under $30”**, **“Compare customer research downloads under $80”**, or **“Buy the Weekly Focus Planner.”** Products above $50 exercise the default separate approval flow. The templates contain original editable HTML/CSS/SVG, JavaScript, Markdown, and CSV files; they do not include external subscriptions, accounts, or live services.

On the first startup with catalog version `digital-marketplace-2026-11-v1`, the existing listings are archived and replaced. Historical orders, signed quotes, downloads, refunds, accounts, and balances remain intact. The revision is applied once in a transaction, including under concurrent startups; restarts preserve later product additions and edits. The configured sandbox merchant retains its existing login, name, balances, and settlement settings and receives the Atlas products. The other five merchants are fictional catalog sellers with instant delivery and no shared public login credentials.

The consumer dashboard has working navigation for wallet balance, activity, AI permissions, and security. Under **AI permissions**, the consumer can set:

- the amount an AI may auto-approve;
- the maximum amount per transaction; and
- the maximum captured amount per day.

Policy updates are versioned and enforced by the wallet when `payment.prepare` is called. The auto-approve limit cannot exceed the transaction limit, and the transaction limit cannot exceed the daily limit.

### Shop with AI in the consumer app

The consumer dashboard also has **Shop with AI**. It retrieves currently published merchant offers, uses the retrieved catalog to answer shopping questions, and shows the catalog snapshots supplied to the model. A consumer can then say “Buy it” or “Buy the second one.” The assistant selects one verified active offer, obtains a fresh merchant-signed quote, and uses Antspace's existing policy, mandate, and order services to place the order. An unambiguous instruction for a previously shown offer at unchanged terms can proceed immediately under the wallet policy; a changed price or unclear selection is shown as an exact quote for confirmation in chat. A purchase above the auto-approval limit pauses for separate MFA approval and resumes in chat. Insufficient funds saves the purchase and directs the consumer to PayPal Sandbox top-up. **Resume purchase** refreshes the quote and continues only if the authorized terms still match; changed price, refund terms, or fulfillment requires another confirmation. Conversation history and purchase state belong to the signed-in consumer; repeated chat request IDs cannot create a second payment. **Connect AI** remains available for external MCP clients.

To enable chat, set `DEEPSEEK_API_KEY` on the API service (or in the local API process environment). `DEEPSEEK_MODEL` defaults to `deepseek-flash` and can be changed to another [supported DeepSeek model](https://api-docs.deepseek.com/api/create-response/). Keep the key on the API server; do not place it in a `NEXT_PUBLIC_` variable or the browser app. The app calls the [DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api/) with a bounded function-tool loop for catalog search, shopping memory, wallet and order reads, purchase preparation, and order-action review. Antspace validates the selection and executes all financial operations on the server. Without a key, new generated answers and offer selections are unavailable; the rest of the sandbox still runs.

For checkout, ask the assistant to buy a named or previously listed offer, or use an offer card's **Review checkout** action. Antspace applies the existing wallet limits. If human approval is required, complete the separate MFA approval and return to the chat to finish the order. Price and terms come from the signed quote rather than the generated answer. The current retrieval corpus is the structured live catalog; add a search index or embeddings when the catalog and merchant content outgrow that approach. Chat purchases currently handle one fixed-price digital offer per order.

The merchant dashboard supports merchant self-registration at `http://localhost:3001/register` and multiple products under **Products**. Registration atomically provisions an isolated merchant identity, USD payable account, product catalog, signing identity, and merchant-specific MCP endpoint. A merchant creates a fixed-price digital product, chooses digital-service or digital-download fulfillment, can mark it refundable for 1 hour through 365 days, and can publish or hide it. Refund terms are signed into each quote, so later product changes do not alter an existing order. Published products immediately appear in `commerce.search_offers` through that merchant's MCP server.

Merchants do not manually create a paid order. Orders are generated from authorized checkout so the merchant cannot accidentally record an unpaid sale:

1. The consumer's AI calls `commerce.search_offers` and selects a product.
2. The AI calls `commerce.create_quote` for that product and quantity.
3. The AI sends the unchanged signed quote to `payment.prepare` on the consumer wallet.
4. Antspace applies the consumer's policy and obtains human approval when required.
5. The AI sends the resulting single-use mandate and signed quote to `commerce.commit_order`.
6. Antspace captures the reservation into pending merchant revenue and creates the order.
7. Downloads with an attached file fulfill immediately. Orders without a file stay pending. Services collect any merchant-configured requirements in chat; the merchant uploads the completed result and selects **Deliver to buyer**. Fulfillment requires an attached file and any requested buyer requirements.
8. Fulfillment moves pending revenue to payable, starts the snapshotted refund window, and produces the signed receipt.

Before fulfillment, the consumer may call `commerce.cancel_order` or use **Cancel order** in the dashboard. Antspace atomically returns the gross amount to the consumer and reverses both pending merchant revenue and Antspace's fee. `payment.cancel` separately releases an unused reservation or cancels a pending approval. The background lifecycle worker performs the same safe release when authority or fulfillment expires.

An eligible consumer can refund the order from **Activity** or through `payment.request_refund` on the unified `payl` MCP connection. Antspace returns the full captured amount to the consumer, debits the merchant by that gross amount, and retains the original Antspace fee. Refunds are full-order, immediate, signed, auditable, and idempotent. A merchant whose refundable order is returned can therefore show a negative payable balance equal to the retained fee.

The merchant **Settlement** workspace separates pending fulfillment revenue, payout eligible payable, pending PayPal withdrawal, and reserve. A withdrawal retains 10% in reserve and holds the remaining amount until PayPal Sandbox confirms the payout item. Failure or return restores the original payable amount. Refunds after payout consume reserve first and leave any remaining merchant liability visible. Reconciliation includes pending withdrawals. Merchant dashboards also expose quote conversion, approval latency, fulfillment status, refunds, webhook backlog, payout count, audit coverage, and journal integrity.

Merchants can configure an HTTPS webhook in **Settlement**. Order, cancellation, refund, fulfillment, and payout events are written to a durable outbox in the same transaction as the business state. Delivery uses `x-payl-timestamp` plus `x-payl-signature: v1=<HMAC-SHA256>` and retries failures up to eight times. The signing secret is shown only when the webhook is created or rotated.

## Connect Antspace to Codex or another MCP client

This repository includes `.codex/config.toml` with one project-scoped Streamable HTTP connection. The single `payl` server combines the consumer wallet and the multi-merchant commerce network at `http://localhost:4100/mcp`.

After starting Antspace with `pnpm dev`, open the consumer dashboard's **Connect AI** tab, copy the Codex setup, trust the repository, and restart Codex or open a new Codex task. In Codex, use `/mcp` or **Settings → MCP servers** to add the one Antspace server. Antspace returns protected-resource metadata, Codex opens the consumer login and consent flow, and write-capable tools retain the `writes` approval mode.

The same quick-start instructions are available at `http://localhost:4100/docs/mcp` locally or at the hosted API's `/docs/mcp` URL.

Refunds use the separate `wallet:refund` OAuth permission. Connections authorized before this scope was added must be revoked and reconnected before `payment.request_refund` can be called; dashboard refunds continue to use the signed-in consumer session.

To configure another OAuth-capable MCP client, register the single Streamable HTTP URL. Clients discover Antspace's OAuth authorization server, dynamically register a client, use authorization code with PKCE, and receive audience-bound bearer tokens for `http://localhost:4100/mcp`. New merchants and products appear automatically; the consumer does not add or authorize another MCP server.

### Test quotes across multiple merchants

1. Connect the single `payl` server once.
2. Open `http://localhost:3001/register` and create additional sandbox merchants.
3. Add at least one product from each merchant's **Products** tab.
4. Without changing MCP configuration, ask the AI to call `commerce.list_merchants` or `commerce.search_offers` and compare results.
5. Ask it to call `commerce.create_quote` with each result's `merchantId` and `offerId`, then pay the selected unchanged signed quote through the wallet.

Each quote carries its own merchant ID, signing identity, price, and expiry. Capture resolves the merchant's payable ledger account dynamically, so payments from the same consumer wallet settle independently to the merchant bound into each mandate. Per-merchant `/mcp/merchants/:merchantId` endpoints remain available for advanced direct integrations, but consumers do not need them.

For a remote AI client, ChatGPT plugin, or hosted Codex environment, `localhost` will not work. Deploy the MCP and authorization endpoints behind public HTTPS and replace the sandbox identity store and deterministic keys with production IAM and KMS-backed signing.

## Implemented transaction slice

```text
consumer MCP client -> Antspace commerce MCP -> registered merchant -> signed quote
consumer MCP client -> Antspace wallet MCP -> policy + approval
Antspace -> signed single-use mandate -> merchant commerce MCP
digital download merchant -> atomic capture + fulfillment -> signed order receipt
merchant -> async fulfillment -> pending revenue becomes payable + signed receipt
consumer/system -> cancellation or expiry -> atomic release/reversal
consumer -> policy-eligible full refund -> merchant gross debit + signed refund receipt
consumer -> PayPal Sandbox top-up -> full Antspace wallet credit
merchant -> reserve-backed PayPal Sandbox withdrawal -> reconciliation report
```

The current implementation includes Streamable HTTP MCP endpoints, OAuth authorization code with PKCE, scoped and audience-bound access tokens, revocable client grants, password sessions, per-approval TOTP, tenant-isolated dashboards, strict shared schemas, Ed25519 JWS signatures, PostgreSQL transactions, a balanced double-entry sandbox ledger, quote-bound mandates, idempotent capture/cancellation/refund/payout operations, expiry and outbox workers, signed merchant webhooks, reconciliation, pilot metrics, audit exports, and a reference MCP client.

The local identity provider, seeded passwords, TOTP secret, and deterministic signing keys are development fixtures. Replacing them with independently reviewed IAM, account recovery, protected key storage, and production MFA is mandatory before any hosted or live-funds pilot.

## What “direct AI payment through MCP” means

MCP carries the commerce interaction between the consumer's AI host and Antspace's registered merchant network. It does not itself settle money.

- **One-time consumer connection:** consumer AI ↔ Antspace commerce MCP network.
- **Dynamic merchant routing:** merchant registration and product publication make the merchant discoverable without consumer reconfiguration.
- **Direct commercial agreement:** signed merchant quote ↔ signed consumer payment mandate.
- **Money movement:** Antspace's ledger and a licensed bank, mobile-money, issuer, or payment partner.
- **Merchant settlement:** merchant Antspace balance or payout to the merchant's bank account.

This keeps the user experience agent-to-agent while preserving regulated custody, settlement, disputes, and safeguarding.

## Product components

### Consumer wallet and payment MCP

- Funded balance held through an approved regulated structure.
- User identity, linked AI clients, and revocable permissions.
- Amount, merchant, category, frequency, time, and approval policies.
- Signed, single-use payment mandates bound to a merchant quote.
- Notifications, receipts, disputes, and refunds.

### Shopping memory and post-purchase support

The chat saves a per-conversation shopping brief (topic, preferences, budget, refund requirement, product type, and whether to confirm before buying). The brief stays visible above the transcript and survives the recent-message context window. Tell the assistant to change a requirement or select **Clear brief**. Requirements guide search and are checked against the signed quote before payment; they do not override wallet policy. Conditional or withheld purchase consent requires an explicit quote confirmation.

Ask “How much can I spend?”, “Show my orders and downloads”, or “Check order …”. Wallet and order cards use authenticated Antspace records. Eligible cancellations and refunds are proposed in chat and executed only after confirming the specific order action. Refunds credit the Antspace wallet under the existing refund rules; PayPal remains the funding and withdrawal rail. Service requirements can be submitted directly in the order card or prepared from the consumer's exact chat message for review. Progress messages stream from the API as each search, policy check, and order action runs. Model calls are bounded to five rounds and twelve tool calls per message.

### Merchant delivery files

In **Products**, upload a file for a download product or save the requirements buyers must provide for a service. In **Orders**, read the submitted requirements, attach the completed file, then deliver it. A file is snapshotted onto the quote and order, so later catalog replacement does not change an existing purchase. Pending service revenue becomes payable only after delivery. Existing orders and quotes remain readable; old fulfilled orders without an attachment show that no download is available.

Files are stored in Postgres, with a 5 MB file limit and 100 MB total per merchant in this sandbox (including retained versions). Supported extensions: PDF, TXT, MD, CSV, ZIP, PNG, JPG. Authenticated downloads are attachments and are unavailable after cancellation/refund. File bytes are not sent to the model. This bounded storage is intended for sandbox demonstrations; larger deployments should use private object storage with short-lived authorized downloads and an upload scanning pipeline. The seeded research product includes an explicitly labeled sample worksheet; upload the actual product before demonstrating merchant-owned content.

### Merchant commerce MCP gateway

- Merchant onboarding and verified identity.
- Product/service discovery, availability, and structured pricing.
- Signed quotes with expiry, fulfillment, and refund terms.
- Order commitment, payment verification, fulfillment status, and receipts.
- Merchant balance, settlement, reconciliation, and refund tools.

### Antspace trust and settlement core

- Consumer, merchant, and agent identity.
- Quote and mandate signatures.
- Deterministic policy and human approval.
- Double-entry ledger, reservation, capture, release, refund, and payout.
- Risk, compliance, reconciliation, and immutable audit evidence.

## Recommended first market loop

Start with a narrow group of digital goods or services that have fixed pricing and immediate fulfillment. This reduces shipping, inventory substitution, tips, partial capture, and returns complexity while proving the complete consumer-to-merchant MCP transaction.

The first sandbox should contain:

- One Antspace consumer-wallet MCP server.
- One merchant gateway capable of hosting multiple test merchants.
- Three to five pilot merchants in one category.
- A controlled consumer cohort.
- Simulated funds first, followed by a partner-approved limited live pilot.

## Non-negotiable product rules

- The model never receives a permanent card number, wallet secret, private key, or approval credential.
- A quote is signed, priced, itemized, and time-limited.
- A payment mandate is single-use and bound to the quote, merchant, amount, currency, payer, and expiry.
- Material quote changes require fresh policy evaluation and approval.
- Human approval cannot be performed by the purchasing agent.
- Every state transition and money event is idempotent and auditable.
- Live funds require a licensed operating model.

## Validation gates

1. Fifteen qualified consumer interviews and ten qualified merchant interviews.
2. Three merchant design partners with named integration owners.
3. Fifty consumers committed to a controlled test cohort.
4. One hundred successful end-to-end sandbox orders.
5. At least 95% supported-flow completion.
6. Zero policy bypasses, replayed mandates, duplicate captures, or cross-account exposures.
7. At least one merchant accepts a priced pilot or commercial term sheet.
8. A licensed payment partner and qualified counsel approve the limited live-pilot structure.

## Pack contents

- [Network-entry strategy](validation/00-wedge-decision.md)
- [Consumer and merchant beachhead](validation/01-beachhead-brief.md)
- [Consumer and merchant interviews](validation/02-interview-and-outreach.md)
- [Pilot scorecard](validation/03-pilot-scorecard.md)
- [Competitive landscape](validation/04-competitive-landscape.md)
- [Partner and regulatory matrix](validation/05-partner-and-regulatory-matrix.md)
- [Thirty-day execution plan](validation/06-30-day-execution-plan.md)
- [Project readiness](product/07-standalone-project-readiness.md)
- [MCP commerce MVP specification](product/08-sandbox-mvp-spec.md)
- [Network unit economics](finance/09-unit-economics-guide.md)
- [Merchant pilot offer](validation/10-paid-pilot-offer-template.md)
- **PAYL_Validation_Workbook.xlsx**
- [Research sources](sources.md)

## Decisions still required

- First launch country and currency.
- First merchant category.
- Custodial wallet versus partner account structure.
- First funding and settlement rail.
- Consumer distribution channel.
- Merchant-acquisition owner and pilot budget.

Nigeria remains a provisional regulatory research case until explicitly confirmed.

## License

Copyright (c) 2026 Antspace contributors.

Antspace's original source code is licensed under the [GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`). Commercial use is permitted. Modified versions offered to users over a network must prominently offer those users the corresponding source under the license's terms.

Earlier MIT releases retain their original permissions. Third-party dependencies and separately licensed content retain their own terms. See [licensing scope, source availability, and release history](docs/licensing.md).
