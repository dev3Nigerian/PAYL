# Consumer and Merchant Beachhead

## Consumer proposition

> Connect PAYL to your AI, set spending rules, and let it buy from verified merchants without giving it unrestricted access to your bank account or card.

## Merchant proposition

> Make your products purchasable by AI agents through one MCP commerce gateway, with verified consumer authority, guaranteed payment status, structured orders, and auditable receipts.

## Initial consumer

- Already uses an AI assistant for search, recommendations, or task completion.
- Makes repeat purchases in the selected digital category.
- Is comfortable funding a low-value wallet or linking a partner-backed payment source.
- Values convenience but wants approval thresholds and instant notifications.

## Initial merchant

- Sells fixed-price digital goods or services.
- Has a catalog or simple API/database that can feed the merchant gateway.
- Can fulfill electronically and return a stable order reference.
- Can define cancellation and refund rules.
- Has an owner able to approve a four-week integration pilot.

## Consumer job to be done

> When I ask my AI to buy something, complete the purchase within my rules without exposing permanent payment access or forcing me through a full manual checkout.

## Merchant job to be done

> When a legitimate AI represents a real customer, let it discover, quote, pay, and create an order through a secure machine interface without being treated as a malicious bot.

## First end-to-end experience

1. The consumer funds a sandbox wallet or receives test funds.
2. The consumer links an AI host through OAuth and sets a low spending policy.
3. The AI calls a verified merchant MCP server to search offers.
4. The merchant returns a signed quote containing total price, currency, expiry, fulfillment, and refund terms.
5. The AI submits the quote to PAYL's payment MCP.
6. PAYL evaluates policy and asks the human to approve when required.
7. PAYL reserves value and creates a single-use signed mandate.
8. The AI commits the order with the merchant MCP server.
9. The merchant verifies and captures the mandate through PAYL.
10. Both consumer and merchant receive payment, order, and audit receipts.

## Business-model hypotheses

| Revenue | Initial test |
|---|---:|
| Merchant transaction fee | 0.5%–3.0% of gross merchandise value |
| Merchant gateway subscription | ₦10,000–₦250,000 per month or local equivalent |
| Merchant settlement fee | Fixed fee per payout or instant settlement |
| Consumer premium controls | Optional monthly plan for advanced policies and family wallets |
| Developer/API plan | Usage tier for high-volume AI clients |

Pricing ranges are research prompts, not recommendations.

## Hypotheses

| Hypothesis | Evidence required | Failure signal |
|---|---|---|
| Consumers will delegate low-value purchases | Fifty committed testers and repeated sandbox use | Users only browse and always complete payment manually |
| Merchants will integrate MCP commerce | Three live design partners with technical owners | Merchants see no incremental demand or refuse structured access |
| Signed quote and mandate reduce risk | Zero unauthorized or mismatched sandbox captures | Quote changes or replay create unsafe outcomes |
| Wallet funding is acceptable | Target users fund or commit to funding low-value wallets | Top-up friction prevents activation |
| The network can start narrow | Selected category produces repeat transactions | Consumers require broad merchant coverage immediately |
| Fees cover the two-sided operation | Positive contribution margin in the base live-pilot case | Funding, fraud, support, and payout cost exceed merchant revenue |

## Excluded from the first pilot

- Broad physical retail.
- Autonomous high-value purchases.
- Cash withdrawal, peer-to-peer transfer, lending, or credit.
- Cross-border or multi-currency wallets.
- Raw payment credentials in MCP messages.
- Unsigned price or order changes.
- Merchants without verified identity and explicit pilot agreement.

## Positioning

Primary:

> **The MCP payment network for consumers and merchants.**

Explanatory:

> **Your AI can shop. PAYL lets it pay safely.**

