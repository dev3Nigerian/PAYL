# PAYL — MCP-Native Consumer and Merchant Payments

**Prepared:** 15 July 2026  
**Project status:** Standalone sandbox MVP implemented  
**Product direction:** Consumer AI to merchant AI commerce through MCP

## Product thesis

PAYL will be a two-sided payment and commerce network for consumers and merchants:

> **A consumer gives an AI bounded spending authority. The AI connects directly to a merchant's MCP commerce server, obtains a signed quote, authorizes payment through PAYL, commits the order, and receives a verifiable receipt.**

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

- PAYL API and MCP servers at `http://localhost:4100`.
- Consumer approval web app at `http://localhost:3000`.
- Merchant console at `http://localhost:3001`.
- PostgreSQL 18 at `localhost:54329`.
- An isolated, temporary test PostgreSQL instance at `localhost:54330` when `pnpm test` runs.

In another terminal, run the two-server reference consumer agent:

```powershell
pnpm demo
```

The agent first prints an OAuth authorization URL. Open it, sign in as the consumer, and approve the requested MCP scopes. When a payment requires human approval, open the returned approval URL, review the immutable quote, and enter the current authenticator code.

Generate the current sandbox authenticator code with:

```powershell
pnpm auth:code
```

For interactive testing, signed quotes last 60 minutes and approval challenges last 45 minutes by default. Both values are sandbox-only and configurable through `.env`.

Verification commands:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

The database is preloaded with ₦100,000 of simulated consumer funds. No real money, card data, bank credentials, or reusable approval credentials are used.

Sandbox dashboard accounts:

| Workspace | Email | Password |
|---|---|---|
| Consumer | `consumer@payl.local` | `ConsumerDemo!2026` |
| Merchant | `merchant@payl.local` | `MerchantDemo!2026` |

The consumer TOTP seed is `JBSWY3DPEHPK3PXP`. It is a public local-development secret and must never be reused outside this sandbox.

## Using the dashboards

The consumer dashboard has working navigation for wallet balance, activity, AI permissions, and security. Under **AI permissions**, the consumer can set:

- the amount an AI may auto-approve;
- the maximum amount per transaction; and
- the maximum captured amount per day.

Policy updates are versioned and enforced by the wallet when `payment.prepare` is called. The auto-approve limit cannot exceed the transaction limit, and the transaction limit cannot exceed the daily limit.

The merchant dashboard supports multiple products under **Products**. A merchant creates a fixed-price digital product, chooses digital-service or digital-download fulfillment, and can publish or hide it. Published products immediately appear in `commerce.search_offers` through the merchant MCP server.

Merchants do not manually create a paid order. Orders are generated from authorized checkout so the merchant cannot accidentally record an unpaid sale:

1. The consumer's AI calls `commerce.search_offers` and selects a product.
2. The AI calls `commerce.create_quote` for that product and quantity.
3. The AI sends the unchanged signed quote to `payment.prepare` on the consumer wallet.
4. PAYL applies the consumer's policy and obtains human approval when required.
5. The AI sends the resulting single-use mandate and signed quote to `commerce.commit_order`.
6. PAYL captures the reservation, creates the order, and returns a signed receipt.

## Connect PAYL to Codex or another MCP client

This repository includes `.codex/config.toml` with two project-scoped Streamable HTTP connections:

- `payl_wallet` → `http://localhost:4100/mcp/wallet`
- `payl_merchant` → `http://localhost:4100/mcp/merchants/merchant_demo`

After starting PAYL with `pnpm dev`, trust the repository and restart Codex or open a new Codex task. In Codex, use `/mcp` or **Settings → MCP servers** to connect. PAYL returns protected-resource metadata, Codex opens the consumer login and consent flow, and write-capable tools retain the `writes` approval mode.

To configure another OAuth-capable MCP client, register the same two Streamable HTTP URLs. Clients discover PAYL's OAuth authorization server, dynamically register a client, use authorization code with PKCE, and receive audience-bound bearer tokens for `http://localhost:4100/mcp`.

For a remote AI client, ChatGPT plugin, or hosted Codex environment, `localhost` will not work. Deploy the MCP and authorization endpoints behind public HTTPS and replace the sandbox identity store and deterministic keys with production IAM and KMS-backed signing.

## Implemented transaction slice

```text
consumer MCP client -> merchant commerce MCP -> signed quote
consumer MCP client -> PAYL wallet MCP -> policy + approval
PAYL -> signed single-use mandate -> merchant commerce MCP
merchant -> atomic capture + fulfillment -> signed order receipt
```

The current implementation includes Streamable HTTP MCP endpoints, OAuth authorization code with PKCE, scoped and audience-bound access tokens, revocable client grants, password sessions, per-approval TOTP, tenant-isolated dashboards, strict shared schemas, Ed25519 JWS signatures, PostgreSQL transactions, a balanced double-entry sandbox ledger, quote-bound mandates, idempotent capture, audit events, and a reference MCP client.

The local identity provider, seeded passwords, TOTP secret, and deterministic signing keys are development fixtures. Replacing them with independently reviewed IAM, account recovery, protected key storage, and production MFA is mandatory before any hosted or live-funds pilot.

## What “direct AI payment through MCP” means

MCP carries the direct commerce interaction between the consumer's AI host and the merchant's MCP server. It does not itself settle money.

- **Direct interaction:** consumer AI ↔ merchant MCP server.
- **Direct commercial agreement:** signed merchant quote ↔ signed consumer payment mandate.
- **Money movement:** PAYL's ledger and a licensed bank, mobile-money, issuer, or payment partner.
- **Merchant settlement:** merchant PAYL balance or payout to the merchant's bank account.

This keeps the user experience agent-to-agent while preserving regulated custody, settlement, disputes, and safeguarding.

## Product components

### Consumer wallet and payment MCP

- Funded balance held through an approved regulated structure.
- User identity, linked AI clients, and revocable permissions.
- Amount, merchant, category, frequency, time, and approval policies.
- Signed, single-use payment mandates bound to a merchant quote.
- Notifications, receipts, disputes, and refunds.

### Merchant commerce MCP gateway

- Merchant onboarding and verified identity.
- Product/service discovery, availability, and structured pricing.
- Signed quotes with expiry, fulfillment, and refund terms.
- Order commitment, payment verification, fulfillment status, and receipts.
- Merchant balance, settlement, reconciliation, and refund tools.

### PAYL trust and settlement core

- Consumer, merchant, and agent identity.
- Quote and mandate signatures.
- Deterministic policy and human approval.
- Double-entry ledger, reservation, capture, release, refund, and payout.
- Risk, compliance, reconciliation, and immutable audit evidence.

## Recommended first market loop

Start with a narrow group of digital goods or services that have fixed pricing and immediate fulfillment. This reduces shipping, inventory substitution, tips, partial capture, and returns complexity while proving the complete consumer-to-merchant MCP transaction.

The first sandbox should contain:

- One PAYL consumer-wallet MCP server.
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
