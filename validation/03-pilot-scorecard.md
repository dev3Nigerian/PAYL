# Consumer–Merchant MCP Pilot Scorecard

## Pilot purpose

Prove that consumers, merchants, AI hosts, and PAYL can complete a safe direct MCP commerce loop—not merely a wallet demo or merchant API demo.

## Market gates

| Dimension | Metric | Threshold |
|---|---|---:|
| Consumer discovery | Qualified consumer interviews | 15 |
| Merchant discovery | Qualified merchant interviews | 10 |
| Merchant commitment | Merchant design partners with named technical owners | 3 |
| Consumer commitment | Invited test cohort | 50 |
| Commercial commitment | Priced merchant pilot or term sheet | 1 |
| AI connectivity | Supported consumer AI hosts/reference clients | At least 1 production-intent host plus reference client |

## Product and safety gates

| Dimension | Metric | Threshold |
|---|---|---:|
| End-to-end volume | Completed sandbox orders | 100 |
| Reliability | Supported orders reaching an intentional terminal state | 95% |
| Quote integrity | Captures matching merchant, quote hash, amount, and currency | 100% |
| Mandate integrity | Single-use, unexpired, correctly scoped mandates | 100% |
| Unauthorized transactions | Policy bypass or approval impersonation | 0 |
| Replay safety | Replayed quote, mandate, commit, capture, or refund succeeding twice | 0 |
| Financial safety | Duplicate reservation, capture, payout, or refund | 0 |
| Account isolation | Cross-consumer or cross-merchant data exposure | 0 |
| Audit | Orders with complete quote-to-receipt evidence | 100% |
| Approval usability | Median approval completion | Under 60 seconds |
| Merchant integration | Median time to first valid signed quote | Under 1 working day |

## Network metrics

- Consumers invited, activated, funded with test value, and transacting.
- Repeat purchasers.
- Merchants onboarded, catalogues connected, and transacting.
- Offers discovered and quotes created.
- Quote-to-mandate conversion.
- Mandate-to-order conversion.
- Order completion, decline, expiry, cancellation, refund, and dispute simulation.
- Gross merchandise value in the sandbox and later live pilot.
- Average order value.
- Consumer approval rate and time.
- Merchant fulfillment time.
- Manual support interventions.
- MCP and payment-core availability.
- Revenue, rail cost, loss cost, support cost, and contribution margin.

## Proceed to limited live pilot

All safety thresholds must pass, plus:

- Three committed merchants in one category.
- Fifty consumers in the invited cohort.
- One hundred completed sandbox orders.
- One priced merchant commitment.
- Licensed-partner and counsel approval for the specific live flow.
- Positive base-case contribution margin at the agreed merchant fee and partner cost.

## Revise and retest

Revise when:

- Consumer demand exists but wallet funding prevents activation.
- Merchants integrate but quote-to-order conversion is weak.
- The MCP tool surface works only for one merchant's custom model.
- Human approval is too slow or confusing.
- Refund or fulfillment state is not reliably correlated.
- The economics require a different order size, merchant fee, or funding rail.

## Stop or change the first category

Change the category when:

- Merchants cannot provide deterministic quotes or electronic fulfillment.
- Consumers demand merchant breadth before completing even one repeat purchase.
- Merchant integration does not create incremental conversion or lower cost.
- Fraud, support, refunds, or payment fees make the category structurally uneconomic.

The broad consumer–merchant vision remains; the first category is replaceable.

