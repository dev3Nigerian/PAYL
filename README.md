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

In another terminal, run the two-server reference consumer agent:

```powershell
pnpm demo
```

The agent prints a consumer approval URL and waits. Open the URL, review the immutable quote, and approve it. For automated local verification only, use `pnpm demo:auto`; this shortcut still calls the separate approval API and is disabled by design outside sandbox mode.

Verification commands:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

The database is preloaded with ₦100,000 of simulated consumer funds. No real money, card data, bank credentials, or reusable approval credentials are used.

## Implemented transaction slice

```text
consumer MCP client -> merchant commerce MCP -> signed quote
consumer MCP client -> PAYL wallet MCP -> policy + approval
PAYL -> signed single-use mandate -> merchant commerce MCP
merchant -> atomic capture + fulfillment -> signed order receipt
```

The current implementation includes Streamable HTTP MCP endpoints, strict shared schemas, Ed25519 JWS signatures, PostgreSQL transactions, a balanced double-entry sandbox ledger, quote-bound mandates, human approval, idempotent capture, audit events, consumer approval UI, merchant console, and a reference MCP client.

The approval web session uses a clearly marked sandbox identity header. Replacing that boundary with OIDC/MFA and replacing deterministic development keys with KMS-backed signing are mandatory before any hosted or live-funds pilot.

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
