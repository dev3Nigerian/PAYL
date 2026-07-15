# Thirty-Day MCP Commerce Validation Plan

## Objective

Prove one complete consumer-AI-to-merchant-MCP transaction loop and determine whether a partner-approved live pilot is justified.

## Days 1–4: Fix the first loop

- Confirm launch country and currency.
- Select one digital-goods/service category.
- Define the consumer cohort and merchant profile.
- Recruit at least 15 consumer and 10 merchant interviews.
- Define the signed quote, payment mandate, order, receipt, and refund schemas.
- Choose a reference AI host/client for the sandbox.

## Days 5–11: Validate both sides

- Complete consumer and merchant interviews.
- Observe at least five consumers making a real purchase manually.
- Obtain sample catalogs, price rules, fulfillment states, and refund terms from candidate merchants.
- Obtain three written merchant design-partner commitments.
- Recruit fifty consumer testers.

### Day-11 gate

Continue only if three merchants will supply sandbox data and consumers identify a repeated use case where AI purchase completion is valuable.

## Days 12–23: Build the sandbox

- Consumer wallet/payment MCP server.
- Merchant MCP gateway with multi-merchant test tenants.
- Merchant directory/discovery for the selected cohort.
- Signed quote and terms hash.
- Consumer policy and separately authenticated approval.
- Signed single-use payment mandate.
- Simulated double-entry ledger.
- Order commit, fulfillment status, receipt, cancellation, and refund.
- Key registry, OAuth, message signatures, replay protection, and audit export.
- Reference AI client that orchestrates both MCP servers.

Run at least 100 happy-path orders and 50 failure/security cases.

### Day-23 gate

Require 95% supported-flow completion and zero quote mismatch, mandate replay, approval impersonation, duplicate financial event, or account-isolation failure.

## Days 24–27: Economics and live feasibility

- Test merchant transaction fee and gateway subscription.
- Model wallet funding, transaction, payout, KYC/KYB, fraud, support, and refund costs.
- Select licensed partner candidates in the confirmed jurisdiction.
- Obtain preliminary commercial and counsel feedback.
- Prepare a low-limit live-pilot operating model.

## Days 28–30: Decision

Prepare a decision memo covering:

1. Consumer activation and repeat intent.
2. Merchant commitments and integration effort.
3. End-to-end sandbox metrics.
4. Security and financial invariants.
5. Unit economics.
6. Partner and regulatory feasibility.
7. First live-pilot scope, limits, or reason to revise.

## Do not do yet

- Open the wallet to the public.
- Onboard many merchant categories.
- Build browser automation for unsupported merchants.
- Hold funds without an approved regulated structure.
- Market “fully autonomous” spending.
- Promise direct settlement before partner confirmation.

