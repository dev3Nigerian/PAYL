# PAYL Network Unit Economics

The workbook models a two-sided consumer and merchant network. All seeded numbers are illustrative.

## Activity

- Active consumers = registered consumers × monthly activation rate.
- Monthly transactions = active consumers × transactions per active consumer.
- Gross merchandise value = monthly transactions × average order value.
- Active merchants = onboarded merchants × merchant activation rate.

## Revenue

- Transaction revenue = gross merchandise value × merchant take rate.
- Merchant gateway revenue = active merchants × monthly gateway fee.
- Settlement revenue = merchant payouts × payout fee.
- Consumer premium revenue = premium consumers × monthly premium fee.
- Other contracted API revenue, if real and non-duplicative.

## Variable cost

- Wallet funding and collection cost.
- Regulated partner and payment-rail transaction cost.
- Merchant payout/settlement cost.
- Consumer KYC and merchant KYB amortization.
- Fraud and unauthorized-loss cost.
- Refund/dispute processing.
- MCP, signing, ledger, observability, and notification cost per transaction.
- Consumer and merchant support.

## Margin

- Net transaction revenue = transaction revenue − rail/funding/payout/loss costs.
- Contribution margin = all revenue − all variable costs.
- Operating result = contribution margin − fixed product, compliance, security, and operations cost.
- Break-even volume must be calculated at the merchant fee consumers and merchants actually accept.

## Evidence required

| Input | Preferred evidence |
|---|---|
| Consumer activation and frequency | Cohort behavior |
| Average order value | Merchant transaction history or pilot |
| Merchant take rate | Signed pilot/commercial term |
| Funding and transfer cost | Partner tariff |
| KYC/KYB cost | Vendor quote |
| Fraud/loss rate | Conservative partner benchmark, then live pilot |
| Refund/support cost | Sandbox and pilot incident data |
| Merchant acquisition cost | Actual sales activity |
| Consumer acquisition cost | Actual channel cohort |

## Warning signs

- Merchant take rate is lower than funding, rail, payout, fraud, and support cost.
- Consumers top up once but do not transact repeatedly.
- The network requires broad merchant coverage before a consumer sees value.
- Each merchant needs bespoke MCP tools rather than the shared schema.
- Refund and support work scale linearly with transactions.
- Deposits or gross merchandise value are counted as revenue.
- Uncontracted interchange, float, or partner revenue share is included.
- Consumer acquisition cost is ignored because merchant distribution is assumed to be free.

