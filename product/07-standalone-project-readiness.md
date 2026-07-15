# PAYL MCP Commerce Project Readiness

## Current state

PAYL is a standalone, clean-slate project with strategy and validation materials but no application code, payment integration, merchant connection, or licensed operating partner assumed.

The fixed product direction is a consumer wallet and merchant MCP commerce network.

## Build boundary

The first build should be a complete simulated network, not a partial production wallet:

- Consumer wallet/payment MCP server.
- Merchant commerce MCP gateway.
- Human approval web surface.
- PAYL trust, policy, ledger, and settlement core.
- Merchant administration and catalog adapter.
- Reference consumer AI client.
- Simulated funding, transfer, payout, cancellation, and refund.

## Recommended repository layout

```text
PAYL/
  apps/
    consumer-wallet-mcp/
    merchant-commerce-mcp/
    approval-web/
    merchant-admin/
    reference-consumer-agent/
  services/
    identity/
    policy/
    trust-mandates/
    ledger/
    orders/
    settlement/
    audit/
  packages/
    commerce-schemas/
    signatures/
    sdk-typescript/
    mcp-tools/
  infrastructure/
  tests/
  docs/
```

## Suggested sandbox stack

- TypeScript for MCP servers, APIs, schemas, and SDK.
- PostgreSQL for transactional state and the simulated double-entry ledger.
- Redis or a durable queue only for locks, idempotency, and asynchronous work where required.
- OpenAPI for internal settlement/verification APIs.
- MCP JSON schemas for consumer and merchant tools.
- OAuth 2.1/OIDC-compatible authorization for remote MCP access.
- JWS or HTTP Message Signatures for quotes and mandates, with a JWKS-style key registry.
- Docker for local development and isolated test environments.
- Unit, integration, state-machine, property, concurrency, and security tests in CI.

Technology choices can change; the domain boundaries and cryptographic objects should remain stable.

## Pre-build decisions

1. Launch country and currency.
2. First merchant category.
3. Reference AI host/client.
4. Consumer test cohort source.
5. Merchant catalog integration method.
6. Sandbox hosting and data policy.
7. Founder-approved budget and delivery owner.

## Pre-live requirements

- Licensed custody/settlement structure.
- Consumer KYC and merchant KYB process.
- Customer, merchant, and partner contracts.
- Safeguarding and reconciliation design.
- Threat model and independent security review.
- Consumer protection, refund, dispute, and complaint operations.
- Fraud and transaction-monitoring rules.
- Data-protection impact assessment.
- Financial journal review and daily partner reconciliation.
- Low-value limits, kill switch, and incident rollback.

