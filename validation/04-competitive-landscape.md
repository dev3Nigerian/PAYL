# Competitive Landscape

## Strategic position

PAYL is not attempting to invent MCP or a new universal cryptographic standard. It aims to operate the consumer wallet, merchant MCP gateway, trust/mandate service, and settlement orchestration required to turn agent interaction into a completed transaction.

## Alternatives

| Alternative | Strength | Risk to PAYL | PAYL response to validate |
|---|---|---|---|
| Consumer manually checks out | Familiar and universally available | Direct AI payment may not save enough effort | Measure reduced handoff and repeat use |
| Existing bank or wallet app | Trusted funding and consumer protections | Wallets can add agent controls | Provide cross-merchant MCP execution, not only funding |
| Merchant's existing checkout/payment gateway | Mature payment acceptance, fraud, and refunds | Gateways can expose agent-ready checkout | Offer one merchant gateway for multiple AI hosts and direct wallet mandates |
| Card-network agent programmes | Global acceptance, identity, and tokenization | Networks may own agent trust and credential standards | Interoperate and use network rails where advantageous |
| AI-platform commerce protocol | Native distribution inside major assistants | Platforms may own consumer and merchant relationships | Be multi-host, locally operable, and rail-neutral |
| Closed merchant app ecosystem | Strong merchant-specific experience | Consumers may not need a general network | Win categories where consumers compare across merchants |

## Current agent-commerce infrastructure

- Google AP2 defines a payment-agnostic authorization, authenticity, and accountability framework and can extend MCP.
- Visa Trusted Agent Protocol defines signed agent-to-merchant interactions and supports channels including MCP.
- Mastercard Agent Pay combines agent registration, tokenization, and consumer controls.
- Stripe agentic commerce includes merchant tooling and transaction-scoped payment tokens.

References: [Google AP2](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), [Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications), [Mastercard Agent Pay](https://newsroom.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai/), and [Stripe agentic commerce](https://docs.stripe.com/agentic-commerce).

## MCP-specific reality

MCP uses a host–client–server architecture. The consumer AI host maintains a client connection to each server. PAYL therefore needs two compatible server roles:

- Merchant commerce server.
- PAYL consumer wallet/payment server.

The host orchestrates between them while PAYL signatures bind the quote and mandate. MCP transport authorization protects access to a server; PAYL still needs transaction-level payment consent, signatures, policy, and replay controls. See the [MCP architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture) and [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

## Defensibility hypotheses

1. **Merchant network:** verified merchants exposing a consistent commerce tool surface.
2. **Consumer trust:** funded consumers with policies, history, and repeat agent purchases.
3. **Two-sided identity:** verified consumer, agent, merchant, quote, and order correlation.
4. **Local payment execution:** regulated funding and merchant settlement in under-served markets.
5. **Multi-host compatibility:** one wallet and merchant integration across multiple AI assistants.
6. **Risk performance:** lower unauthorized loss and dispute rate without excessive approval friction.
7. **Protocol interoperability:** compatibility with emerging mandates and trusted-agent signatures.

These become moats only after adoption and measurable performance.

## Competitive tests

- Complete the same order using manual checkout and compare time and failure rate.
- Compare merchant integration effort against the merchant's current payment gateway.
- Test whether a network or processor can supply the credential/rail while PAYL owns the wallet and merchant experience.
- Ask consumers whether PAYL or their AI host should own payment policy.
- Ask merchants whether they will pay for agent-originated orders or expect the AI platform to pay.

