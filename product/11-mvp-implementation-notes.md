# PAYL Sandbox MVP Implementation Notes

## Delivered boundary

The repository implements the first complete consumer-to-merchant MCP transaction slice using simulated NGN funds:

1. A consumer MCP host connects independently to the merchant commerce server and PAYL wallet server.
2. The merchant creates an Ed25519-signed, expiring quote.
3. PAYL verifies the signature and stored quote, evaluates the consumer policy, and creates a separate approval challenge when required.
4. Approval reserves funds with a balanced ledger journal and issues a signed, single-use mandate bound to the complete signed quote.
5. The merchant verifies and consumes the mandate, captures the reservation atomically, fulfills the order, and returns a signed receipt.
6. Repeated commit calls return the original receipt without a second capture.

## Runtime components

| Component | Location | Default port |
|---|---|---:|
| Core API and both MCP surfaces | `apps/api` | 4100 |
| Human approval PWA | `apps/approval-web` | 3000 |
| Merchant console | `apps/merchant-web` | 3001 |
| Reference MCP consumer client | `apps/reference-agent` | CLI |
| PostgreSQL sandbox ledger | Docker Compose | 54329 |

MCP endpoints:

- `POST /mcp/wallet`, with a sandbox `x-payl-consumer-id` connection header.
- `POST /mcp/merchants/:merchantId`.

## Financial invariants

- Money is stored as integer minor units in PostgreSQL `bigint` columns.
- Every journal entry is checked to sum to zero before insertion.
- Reservation locks the consumer ledger account rows before checking the derived balance.
- A mandate and quote can each be associated with only one order.
- Mandate consumption, payment capture, quote commitment, order creation, receipt creation, and ledger capture share one database transaction.
- Funding, reservation, and capture journals have unique idempotency keys.
- Displayed balances are derived from journal lines.

## Cryptographic boundary

- Quotes, mandates, and receipts use compact JWS with Ed25519 (`EdDSA`).
- Canonical JSON sorts object keys recursively before signing.
- The payment mandate binds the exact compact-JWS quote hash, merchant, consumer reference, agent client, amount, currency, expiry, and anti-replay identifier.
- Deterministic development keys are permitted only when `PAYL_DEV_KEYS=true`; production configuration rejects them.

## Explicit sandbox limitations

- No custody, funding rail, payout rail, KYC/KYB, AML monitoring, disputes, or real settlement.
- The approval PWA uses a development consumer header rather than OIDC/MFA.
- Development signing keys are deterministic and not KMS-backed.
- One seeded consumer, merchant, currency, and category are provided.
- Cancellation, release, refund, payout, and reconciliation state machines remain the next implementation slice.

These limitations prevent accidental presentation of the sandbox as a production payment system.
