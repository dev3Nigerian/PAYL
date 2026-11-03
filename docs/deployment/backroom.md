# Antspace Backroom

The owner dashboard lives at `https://antspace.online/backroom`. It uses the existing consumer web service and API; there is no additional Render service or plan change. Existing shopper and merchant accounts cannot access it.

## Enable owner access

1. Deploy the updated API and consumer web service from `main`. API startup applies migration `0015_backroom.sql` automatically.
2. Run `pnpm backroom:secrets` on your own computer. Save the generated password and authenticator setup key in your password manager. Do not paste them into chat or commit them.
3. In Render, open **payl-api-dev3nigerian → Environment**. Add all three variables together:

   | Variable | Value |
   | --- | --- |
   | `PAYL_BACKROOM_EMAIL` | An owner email different from every existing shopper and merchant login. An email alias you control is suitable. |
   | `PAYL_BACKROOM_PASSWORD` | The generated password (16–128 characters). |
   | `PAYL_BACKROOM_TOTP_SECRET` | The generated uppercase base32 setup key (32–64 characters). |

4. Add the setup key manually to your authenticator app. Name the account **Antspace Backroom**; use time-based codes, 6 digits, 30 seconds, SHA-1. Keep your device time automatic.
5. Save the API environment changes and redeploy it. Startup provisions the dedicated owner account independently of sample data seeding. An email collision fails startup rather than promoting a shopper or merchant.
6. Open `https://antspace.online/backroom` and sign in with the owner email, password, and current authenticator code. A code can be used once; wait for the next code if a request was interrupted after sign-in.

Keep these variables on the API only. The web service uses its existing `PAYL_API_URL` and `PAYL_PUBLIC_WEB_URL=https://antspace.online`; the original Render address is allowed through `RENDER_EXTERNAL_URL` as well. An origin error on login usually means the web service's canonical origin is missing or incorrect.

## What you can monitor

- Overview: orders and new shoppers over 7, 30, or 90 days; account/product counts; AI conversation/message activity; pending payouts and notification queues.
- Current ledger positions by currency: shopper balances/reservations, revenue awaiting fulfillment, merchant payable/reserve, pending withdrawals, platform fees, and provider fee expense.
- Attention queues: overdue delivery, top-ups and withdrawals pending over 30 minutes, recent failed payouts, exhausted webhook retries, and journals that do not balance per currency. Unfinished top-ups may simply be abandoned checkouts.
- Searchable, paginated records for orders, funding, withdrawals, shoppers, merchants, ledger journals, audit events, and verified incoming PayPal events. Use **Inspect** for full references and **Find in audit trail** to follow a record.
- Last background-worker attempt and success. A heartbeat older than 90 seconds is flagged. PayPal and DeepSeek labels report credential configuration, not a provider health check.

The screen refreshes every 30 seconds while visible; you can pause it or refresh manually. Dates are UTC. Transaction record filters use creation time; failed-payout alerts additionally use the update time of a failure in the selected overview period. Account and alert views use a 10-year lookback to include older records. The overview trend shows UTC calendar days, while period counters use a rolling window. Current balance and backlog counts are independent of the selected reporting period.

This is a read-only operations dashboard. Financial figures are virtual sandbox ledger values, not bank or PayPal account balances. It does not expose private chat text, password hashes, signing keys, webhook payloads, or product file bytes. It does not measure AI spend, inspect external service logs, initiate refunds/payouts, or modify balances. A balanced journal check confirms arithmetic; it does not prove every provider transaction has been reconciled.

## Session recovery and rotation

Owner sessions expire after one hour and use a separate HttpOnly cookie with Secure (production) and SameSite Strict. Signing out revokes the API session. Changing any owner environment value and redeploying revokes previous owner sessions. Rotating the authenticator key requires adding the new key to your app.

If you lose your authenticator, generate a new key locally and replace `PAYL_BACKROOM_TOTP_SECRET` on the API service. Remove **all three** variables and redeploy to disable backroom access. Do not remove only one: partial configuration intentionally fails startup. There is no public owner registration or password-reset endpoint.

## Local setup and validation

Use the same three variables in your local API environment and open `http://localhost:3000/backroom`. No hosted credentials are needed to test the dashboard with local sandbox data.

```sh
pnpm db:test:up
pnpm typecheck
pnpm --filter @payl/api test
pnpm --filter @payl/approval-web test
pnpm build
```

Tests cover owner isolation, MFA replay, credential rotation, expiry/revocation, signup isolation, private cookie/origin handling, currency-separated totals, unbalanced journals, attention filters, pagination, search escaping, and stale-worker signals. They use the disposable test database, not a hosted database.
