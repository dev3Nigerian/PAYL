# MCP Commerce Network-Entry Strategy

## Fixed vision

PAYL is a consumer-to-merchant AI commerce network. The market-entry question is not whether to pursue consumers and merchants; it is which category can create the first functioning two-sided loop.

## Recommended first category

Start with **digital goods and services with immediate or deterministic fulfillment**.

Candidate categories to validate include:

- Event or access tickets.
- Digital subscriptions or content.
- Software, API, or service credits sold to individuals.
- Airtime, data, or other digitally delivered value where the legal and partner model permits it.
- Fixed-price professional or online services with a clear completion event.

Select one after interviews. Do not launch all categories together.

## Why this wedge

- Merchant inventory can be expressed as structured MCP resources and tools.
- The final price can be fixed before payment authorization.
- Fulfillment can be confirmed electronically.
- Shipping addresses and physical delivery disputes can be avoided initially.
- Tips, estimated authorization, substitutions, and partial captures are less common.
- A refund can be linked to a specific digital entitlement or order.

## Categories to defer

| Category | Why defer |
|---|---|
| General physical retail | Shipping, returns, substitutions, taxes, inventory changes, and merchant bot controls |
| Food delivery | Price changes, tips, item substitutions, address handling, and checkout access |
| Travel | Price volatility, passenger identity, cancellations, and complex refunds |
| Marketplaces | Seller onboarding, split settlement, disputes, and prohibited-goods monitoring |
| Credit or lending | Underwriting, consumer-credit regulation, collections, and affordability duties |

Deferral is sequencing, not abandonment of the broad consumer-and-merchant vision.

## First network shape

### Supply

- Three to five merchants in one category.
- A merchant gateway that converts a merchant catalog/API into the standard PAYL MCP tool surface.
- Signed quotes and deterministic fulfillment callbacks.

### Demand

- Fifty to three hundred invited consumers.
- One or two supported AI hosts or a PAYL reference consumer agent.
- Pre-funded simulated wallets, then low-value live wallets after approval.

### Transaction loop

1. Consumer asks the AI to find or purchase an item.
2. AI queries one or more merchant MCP servers.
3. Merchant returns a signed quote.
4. AI asks the PAYL wallet MCP to prepare payment.
5. PAYL evaluates policy and obtains user approval when required.
6. PAYL returns an opaque signed mandate.
7. AI commits the merchant order with the mandate.
8. Merchant verifies and captures through PAYL.
9. PAYL transfers value to the merchant balance and returns a receipt.

## Distribution hypotheses

### Consumer acquisition

- Merchant invites its existing customers to pay through a supported AI.
- AI applications list PAYL as a payment tool.
- PAYL offers a reference consumer assistant for controlled tests.
- Consumer referrals follow verified successful purchases, not wallet signup alone.

### Merchant acquisition

- Free sandbox and merchant MCP starter kit.
- Lower checkout friction for AI-originated customers.
- Structured discovery and conversion analytics.
- Fast settlement and lower fees, if partner economics permit.
- Compatibility with multiple AI hosts through one gateway.

## Phase sequence

| Phase | Product | Money |
|---|---|---|
| 0 | Signed quote, mandate, order, receipt, and simulated ledger | No real funds |
| 1 | Closed cohort, licensed-partner-held consumer balances, merchant PAYL balances | Low limits, one currency |
| 2 | More merchants and supported AI clients, refunds and merchant payouts | Partner-backed wallet transfer |
| 3 | Alternative rails such as account-to-account or tokenized card payment | Route selected per transaction |
| 4 | Open merchant directory and broader categories | Multi-rail network |

## Kill or redesign signals

- Merchants will not expose structured catalog, price, order, or refund functions.
- Consumers will not pre-fund or connect a payment account.
- Consumer approval friction eliminates the convenience advantage.
- The merchant cannot distinguish agent-driven sales from existing sales or justify integration.
- A regulated partner cannot support agent-initiated wallet-to-merchant transfer.
- Fraud, disputes, or support cost make low-value commerce uneconomic.

