# Partner and Regulatory Matrix

## Required live operating model

PAYL's consumer wallet and merchant balance create a materially regulated product. The first live pilot must operate with a licensed entity that is contractually responsible for the regulated money-holding and transfer functions.

Provisional structure:

- PAYL owns the consumer and merchant interfaces, MCP gateways, agent permissions, quote/mandate service, policy, ledger orchestration, risk workflow, and audit evidence.
- A licensed bank, mobile-money operator, payment institution, issuer, or programme partner holds safeguarded funds and executes regulated transfers.
- Verified merchants receive an internal payable balance and/or payout to an approved bank account.
- The selected structure determines whether PAYL is an agent, technical service provider, programme manager, merchant aggregator, or another regulated/contractual role.

Qualified payments counsel must confirm the model in the selected country.

## Nigeria research case, if selected

- The Central Bank of Nigeria publishes licence categories and current payment-service providers. See the [CBN PSP register](https://www.cbn.gov.ng/PaymentsSystem/PSPs.html).
- CBN mobile-money guidelines identify wallet creation, wallet management, e-money issuance, pool-account management, and related functions within the regulated mobile-money framework. See the [Framework and Guidelines on Mobile Money Services](https://www.cbn.gov.ng/out/2021/ccd/framework%20and%20guidelines%20on%20mobile%20money%20services%20in%20nigeria%20-%20july%202021.pdf).
- Applicable consumer wallet/account onboarding may require BVN or NIN processes. See the [CBN BVN page](https://www.cbn.gov.ng/PaymentsSystem/BVN.html).
- Consumer, merchant, identity, conversation, transaction, and behavioral data must be assessed under the [Nigeria Data Protection Act 2023](https://ndpc.gov.ng/download/nigeria-data-protection-act-2023).

This is issue spotting, not legal advice.

## Responsibility matrix

| Function | PAYL | Licensed payment partner | Merchant | Consumer/AI host | Required before live pilot |
|---|---|---|---|---|---|
| Consumer onboarding | UX, consent, client/agent linking | KYC and regulated account decision | None | Supplies accurate identity | Yes |
| Merchant onboarding | Gateway, KYB workflow, tool configuration | KYB/AML decision as agreed | Supplies ownership, bank, catalog, terms | None | Yes |
| Funds custody | No unlicensed custody | Holds/safeguards funds | Has approved settlement account | Funds wallet/source | Yes |
| Ledger | Product subledger and reconciliation | Regulated books/settlement record | Merchant payable statement | Consumer balance statement | Yes |
| MCP identity | Registers servers, agents, and keys | Optional network identity | Secures merchant server | Host controls connections | Yes |
| Quote | Schema, signature verification, hash | None | Price, terms, expiry, signature | AI preserves opaque quote | Yes |
| Payment mandate | Policy, approval, signed scope | Payment authentication/control | Verifies merchant and quote binding | Human grants consent | Yes |
| Transfer/capture | Orchestration and state | Executes regulated movement | Accepts payment/order | AI submits mandate | Yes |
| Fulfillment | Status correlation | None | Delivers goods/service | Receives result | Yes |
| Refund/dispute | Workflow and evidence | Executes reversal/dispute process | Approves/initiates refund | Requests or contests | Yes |
| Fraud/AML | Agent, account, device, and transaction risk | Regulated monitoring/reporting | Merchant abuse monitoring | Reports unauthorized use | Yes |
| Complaints | First-line product support | Regulated escalation | Order support | Raises complaint | Yes |
| Privacy/security | Platform controls and data map | Own controls and agreements | Own controller/processor duties | Consent and host security | Yes |

## Partner categories

| Category | Required capability |
|---|---|
| Wallet/custody partner | Safeguarded consumer balances, merchant payables, KYC/KYB, transaction limits |
| Instant payment or transfer partner | Real-time wallet-to-merchant transfer and merchant payout |
| Issuer/token partner | Optional transaction-scoped card or payment token for merchants outside the closed loop |
| Identity and fraud provider | Consumer KYC, merchant KYB, device/account risk, sanctions screening |
| Settlement bank | Pool/safeguarding accounts, reconciliation, merchant payout |
| Payments counsel | Licensing perimeter, agency structure, terms, consumer protection, liability |

## Diligence questions

1. Can the partner support AI-initiated payments backed by user-defined policies and explicit mandates?
2. Can consumer and merchant balances be represented inside PAYL while legal custody remains with the partner?
3. Who owns KYC/KYB, AML, sanctions, fraud decisions, complaints, and regulatory reporting?
4. What transaction limits apply to the pilot?
5. Can a transaction be bound to merchant, quote, amount, currency, and expiry?
6. How are settlement finality, reversals, refunds, disputes, reserves, and chargebacks handled?
7. What are funding, transfer, payout, account, minimum, reserve, and support costs?
8. Does the agreement permit merchant aggregation and MCP-originated orders?
9. What consumer disclosures and authentication are required?

## Live-pilot gate

No real funds until commercial partner approval, counsel review, KYC/KYB flow, safeguarding/custody structure, terms, privacy map, reconciliation, complaints, refunds, incident response, and loss allocation are documented.

