# Consumer and Merchant Interviews

## Research objective

Validate both sides of the same transaction: consumer trust and repeat usage, plus merchant integration and willingness to accept agent-originated orders.

## Interview targets

| Group | Minimum | Profile |
|---|---:|---|
| Consumers | 15 | Active AI users who purchase in the candidate category |
| Merchants | 10 | Fixed-price digital goods/service merchants |
| AI host or agent developers | 3 | Teams able to connect a consumer agent to remote MCP servers |
| Payment/regulatory ecosystem | 3 | Licensed partner, risk/compliance specialist, payments counsel |

## Consumer interview

1. Walk me through your last purchase in the candidate category.
2. Did an AI help you discover, compare, or decide?
3. At which step did you leave the AI and complete the transaction manually?
4. What information did you re-enter?
5. What could go wrong if the AI completed payment?
6. Which purchases could be automatic, threshold-approved, or always manually approved?
7. Which limits matter: merchant, amount, category, frequency, time, or item?
8. Would you fund a low-value wallet? Why or why not?
9. Would linking an existing payment source be preferable?
10. What notification and receipt would make you trust the result?
11. What would you do if the item was wrong, unavailable, or not delivered?
12. Would you join a controlled pilot with named merchants?

Observe behaviour with a prototype. Do not rely only on stated enthusiasm.

## Merchant interview

1. Describe the current purchase and checkout flow.
2. What product, price, availability, and fulfillment data can be exposed programmatically?
3. How are taxes, fees, discounts, and expiry calculated?
4. How often does the final amount change after a quote?
5. How do you detect bots or automated abuse?
6. What would prove that an AI represents an authorized customer?
7. What data is required to create and fulfill an order?
8. When is an order final and when can it be cancelled?
9. How are refunds, disputes, and support handled?
10. What integration effort is acceptable?
11. What fee would be acceptable for incremental agent-originated sales?
12. Who owns technical integration, commercial approval, and compliance?
13. Will you provide a sandbox catalog and named engineer for four weeks?

## AI host/developer interview

1. Can the host connect to two remote MCP servers in one task?
2. How are server permissions and OAuth consent presented to the user?
3. Can the host preserve opaque signed quote and mandate objects without modifying them?
4. How does it isolate data from different MCP servers?
5. How are tool side effects shown to the user?
6. What is required to list or distribute a payment MCP server?

## Evidence grades

| Grade | Meaning | Example |
|---|---|---|
| A | Behaviour or commitment | Merchant supplies catalog, names engineer, signs pilot; consumer completes repeated tests |
| B | Specific past evidence | Recent failed checkout, bot block, manual handoff, refund, or trust concern |
| C | Opinion | “AI shopping sounds convenient” |
| D | Founder assumption | Claim not supplied by market evidence |

## Outreach

### Consumer

> Hi [Name] — I’m testing a way for an AI assistant to buy from verified merchants within rules you control. I’d like to observe how you currently make one [category] purchase and show a non-live prototype. No bank or card information is required. Could we schedule 25 minutes?

### Merchant

> Hi [Name] — PAYL is testing an MCP commerce gateway that lets authorized consumer AI agents discover your offers, receive a signed quote, pay, and create a structured order. The first pilot uses simulated money. Could we map your current checkout and evaluate a four-week sandbox integration?

### Pilot follow-up

> Based on the flow we reviewed, the pilot would expose only [selected catalog], require signed quotes and consumer mandates, use simulated funds, and measure conversion, integration effort, policy safety, and order accuracy. May we review the pilot scope with your commercial and technical owners?

## Required record

- Interview type and date.
- Consumer or merchant profile.
- Current transaction flow.
- Frequency and value band.
- Current AI usage.
- Manual handoff or merchant integration problem.
- Trust, fraud, refund, and privacy concerns.
- Pilot commitment and named owner.
- Acceptable price or fee.
- Evidence grade and next action.

