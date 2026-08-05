# PAYL Sandbox MVP Implementation Notes

## Delivered boundary

The repository implements the first complete consumer-to-multiple-merchant MCP transaction slice using simulated USD funds:

1. A consumer MCP host connects once to the PAYL commerce network and PAYL wallet server.
2. The merchant creates an Ed25519-signed, expiring quote.
3. PAYL verifies the signature and stored quote, evaluates the consumer policy, and creates a separate approval challenge when required.
4. Approval reserves funds with a balanced ledger journal and issues a signed, single-use mandate bound to the complete signed quote.
5. The merchant verifies and consumes the mandate, captures the reservation atomically into pending merchant revenue, and creates the order.
6. Digital downloads fulfill immediately; digital services remain confirmed until the merchant supplies a fulfillment reference.
7. Fulfillment moves pending revenue to payable, starts the signed refund window, and creates the signed receipt.
8. Repeated commit, cancellation, fulfillment, refund, and payout calls return the existing result without moving money twice.

## Runtime components

| Component | Location | Default port |
|---|---|---:|
| Core API and both MCP surfaces | `apps/api` | 4100 |
| Human approval PWA | `apps/approval-web` | 3000 |
| Merchant console | `apps/merchant-web` | 3001 |
| Reference MCP consumer client | `apps/reference-agent` | CLI |
| PostgreSQL sandbox ledger | Docker Compose | 54329 |

MCP endpoints:

- `POST /mcp/wallet`, protected by consumer OAuth scopes.
- `POST /mcp/commerce`, the consumer's persistent multi-merchant discovery, quote, and order connection.
- `POST /mcp/merchants/:merchantId`.

Sandbox merchants may self-register through the merchant console. Registration creates an isolated identity, pending-payable, payable, and reserve ledger accounts, settlement configuration, signing identity, and MCP endpoint. Capture resolves ledger accounts by consumer and merchant ownership rather than using seeded account IDs, allowing independent quotes and settlement across multiple registered merchants.

All MCP surfaces use OAuth authorization code with PKCE, a shared audience-bound MCP resource, dynamic client registration, scoped access tokens, refresh-token rotation, and consumer-controlled grant revocation. The shared commerce endpoint discovers newly registered merchants without another consumer configuration or grant.

## Financial invariants

- Money is stored as integer minor units in PostgreSQL `bigint` columns.
- Every journal entry is checked to sum to zero before insertion.
- Reservation locks the consumer ledger account rows before checking the derived balance.
- A mandate and quote can each be associated with only one order.
- Mandate consumption, payment capture, quote commitment, order creation, receipt creation, and ledger capture share one database transaction.
- Funding, reservation, and capture journals have unique idempotency keys.
- Displayed balances are derived from journal lines.
- Unused mandates are released by explicit cancellation or the periodic expiry worker.
- Unfulfilled revenue cannot enter a payout; fulfillment first moves it from pending payable to payable.
- Pre-fulfillment cancellation reverses the consumer capture, merchant pending revenue, and platform fee.
- Payouts retain a configurable reserve; post-payout refunds consume reserve before exposing merchant debt.
- Reconciliation independently compares business movements with the combined merchant ledger position.

## Operational lifecycle

- `payment.cancel` releases unused authority and `commerce.cancel_order` reverses eligible unfulfilled orders.
- A lifecycle worker expires quotes, approvals, mandates, reservations, and timed-out fulfillment with row locks and idempotent journals.
- Digital-service merchants fulfill through `POST /api/merchant/orders/:orderId/fulfill`; digital downloads use the same transactional fulfillment function automatically.
- Operational events use a durable PostgreSQL outbox. Optional merchant HTTPS webhooks are HMAC-signed and retry up to eight times.
- Sandbox payout batches split payable funds between simulated external settlement and merchant reserve.
- Merchant reconciliation, audit export, and pilot metrics cover conversion, approval latency, fulfillment, refunds, payout activity, webhook backlog, audit coverage, and ledger balance.

## Cryptographic boundary

- Quotes, mandates, and receipts use compact JWS with Ed25519 (`EdDSA`).
- Canonical JSON sorts object keys recursively before signing.
- The payment mandate binds the exact compact-JWS quote hash, merchant, consumer reference, agent client, amount, currency, expiry, and anti-replay identifier.
- Deterministic development keys are permitted only when `PAYL_DEV_KEYS=true`; production configuration rejects them.

## Explicit sandbox limitations

- No custody, external funding rail, bank payout rail, KYC/KYB, AML monitoring, disputes, or real settlement. Payouts and reserves are simulated ledger operations only.
- Identity uses seeded local password accounts rather than an external production IAM provider.
- Approval requires TOTP, but the sandbox TOTP seed is intentionally public for local testing.
- Development signing keys are deterministic and not KMS-backed.
- One seeded consumer and merchant are provided; additional sandbox merchants can self-register. USD and fixed-price digital fulfillment remain the supported boundary.
- Partial refunds, payout failure/return, external merchant-debt collection, and bank-file reconciliation remain outside the sandbox boundary.

These limitations prevent accidental presentation of the sandbox as a production payment system.
