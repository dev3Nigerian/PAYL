# Host the PAYL sandbox on Render and Neon

This deployment is for product demonstrations with simulated funds. It is not approved for live payments, custody, bank credentials, card data, production identity verification, or merchant settlement.

## Architecture

- `payl-api-dev3nigerian`: Express API, OAuth authorization server, unified consumer MCP endpoint plus compatibility endpoints, migrations, lifecycle processing, and webhook delivery.
- `payl-consumer-dev3nigerian`: consumer wallet and approval dashboard.
- `payl-merchant-dev3nigerian`: merchant registration, catalog, orders, and settlement dashboard.
- Neon: persistent PostgreSQL database using its pooled TLS connection.

The three Render services use the repository's root `render.yaml`. Each service builds from its own Dockerfile but retains the monorepo root as the Docker context.

## Free-tier limitations

Render free web services sleep after 15 minutes without inbound traffic. While the API sleeps, expiration processing and webhook retries pause; they resume when an incoming request wakes the API. Cold starts can take about a minute. The three services share the workspace's free instance-hour allowance. Do not treat this topology as an always-on environment.

Neon's free database scales to zero and is appropriate for a small, intermittent sandbox. Monitor its compute, storage, and network-transfer allowances.

## 1. Confirm the service names

The Blueprint reserves these public hostnames:

```text
https://payl-api-dev3nigerian.onrender.com
https://payl-consumer-dev3nigerian.onrender.com
https://payl-merchant-dev3nigerian.onrender.com
```

Render service names are globally unique. If any name is unavailable, edit the three `name` values and every matching `onrender.com` URL in `render.yaml` before creating the Blueprint.

## 2. Create the Neon database

1. Create a Neon account and a project in a European region close to Render Frankfurt.
2. Open **Connect**, enable **Connection pooling**, and copy the PostgreSQL URL.
3. Confirm that the URL contains `sslmode=require` (or a stricter `verify-ca`/`verify-full` mode).
4. Keep this URL in your password manager. Supply it as `DATABASE_URL` during Blueprint creation.

Do not use Render's free PostgreSQL instance for this project: it expires after 30 days.

## 3. Generate the credentials you need to retain

Run this locally from the repository root. The command prints values but does not write them to disk:

```powershell
$env:SANDBOX_CONSUMER_EMAIL="you@example.com"
pnpm deploy:secrets
```

Immediately save the signing master key, consumer password, merchant password, TOTP secret, and enrollment URI in a password manager. Replace the placeholder merchant email before entering the values in Render.

Do not copy `PAYL_SIGNING_MASTER_KEY` into the repository. Changing it later invalidates outstanding quotes, mandates, receipts, and OAuth access tokens; for this sandbox, rotate it only together with a database reset.

## 4. Create the Render Blueprint

1. Sign in to Render and connect the GitHub account that can read the private `dev3Nigerian/PAYL` repository.
2. Choose **New → Blueprint** and select the PAYL repository.
3. Keep `render.yaml` as the Blueprint path.
4. Enter the prompted `sync: false` values:

   - `DATABASE_URL`: Neon pooled TLS URL.
   - `PAYL_SIGNING_MASTER_KEY`: generated 32-byte Base64 signing key.
   - `SANDBOX_CONSUMER_EMAIL`: your consumer test login.
   - `SANDBOX_CONSUMER_PASSWORD`: generated consumer password.
   - `SANDBOX_CONSUMER_TOTP_SECRET`: generated Base32 secret.
   - `SANDBOX_MERCHANT_EMAIL`: your initial merchant test login.
   - `SANDBOX_MERCHANT_PASSWORD`: generated merchant password.

5. Create the Blueprint and wait for all three services to deploy.

The API applies migrations and provisions the initial simulated wallet, merchant, policies, and ledger exactly once. Changing bootstrap credentials in Render later does not update an existing database user. Use account-management functionality when it exists, or create a fresh sandbox database.

## 5. Verify the deployment

Open these URLs:

```text
https://payl-api-dev3nigerian.onrender.com/healthz
https://payl-consumer-dev3nigerian.onrender.com/login
https://payl-merchant-dev3nigerian.onrender.com/login
```

The health response must contain:

```json
{
  "status": "ok",
  "environment": "hosted_sandbox",
  "railMode": "sandbox_ledger",
  "database": "ready"
}
```

Then verify this sequence:

1. Enroll the generated TOTP URI in an authenticator.
2. Sign in to the consumer dashboard.
3. Sign in to the merchant dashboard and create a product.
4. Register a second merchant and create another product.
5. Connect the hosted MCP endpoints and compare both merchants.
6. Complete a payment requiring approval and TOTP.
7. Test fulfillment, cancellation, refund, payout, and reconciliation.

### Enable in-app shopping chat

In the Render environment settings for `payl-api-dev3nigerian`, set `DEEPSEEK_API_KEY` as a secret. Optionally set `DEEPSEEK_MODEL` (the default is `deepseek-flash`), then redeploy the API service. Existing `OPENAI_API_KEY` and `OPENAI_MODEL` values are no longer used and can be removed after the DeepSeek deployment succeeds. Keep the key off the consumer web service and out of `NEXT_PUBLIC_` variables. Sign in to the consumer dashboard and open **Shop with AI**. Ask for live offers, then say “Buy the second one” to exercise the signed quote, wallet policy, and order flow in chat. A purchase above the auto-approval limit still requires separate MFA approval. The shopping workspace adds no new environment variables. Redeploy **API, consumer web, and merchant web** services. The API applies migrations through `0012_chat_turn_leases.sql` at startup. Migration 0011 stores shopping briefs, action details, and delivery files in Postgres; no Render disk is required. Migration 0012 prevents overlapping chat actions across API instances without holding a database connection open during model calls. Allow the API migration to finish before using the updated web apps.

After deployment:

1. In merchant **Products**, attach the actual downloadable file (maximum 5 MB) or configure the service requirements. Existing download products without a file will stay pending after purchase until the merchant attaches a result and fulfills the order. Previously fulfilled orders are not retroactively assigned a file.
2. In consumer **Shop with AI**, set a budget and refund requirement, refine the search, and verify the shopping brief remains visible. Ask for the wallet balance and order history.
3. Buy an eligible item and verify the authenticated download. For a service, submit requirements in the chat card, upload the result from merchant **Orders**, and deliver it.
4. Exercise a purchase needing funding or MFA, then resume it. A changed quote must require confirmation; retries must create only one order. Test a refund or pre-delivery cancellation and check reconciliation.
5. Chat progress uses a streaming `application/x-ndjson` response through the consumer web proxy. The route sends heartbeat messages during model work. If another proxy is placed in front of Render, disable response buffering for the chat POST route.

The local automated suite uses model responses and payment fixtures. Run a real DeepSeek and PayPal Sandbox walkthrough with your server credentials before the hackathon demo.


### Enable PayPal Sandbox funding and withdrawals

1. In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), create or select a Sandbox business account for PAYL, a Sandbox personal buyer, and a Sandbox merchant recipient. Enable Payouts for the PAYL REST app. The business account needs enough Sandbox balance for payouts.
2. Configure an app webhook at `https://payl-api-dev3nigerian.onrender.com/api/paypal/webhook`. Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.PAYOUTSBATCH.*`, and `PAYMENT.PAYOUTS-ITEM.*` events that PayPal offers for the app. Record its webhook ID.
3. On the **API service only**, set `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, `PAYPAL_SANDBOX_MERCHANT_ID` (the business account's merchant ID), and `PAYPAL_SANDBOX_WEBHOOK_ID`. Set all four together, then redeploy. The browser receives only the public client ID from the signed-in consumer dashboard.
4. Sign in as the consumer and use **Wallet → Add funds to PAYL** with the Sandbox buyer. A completed capture credits the full amount once; PAYL records the PayPal fee separately. Use a different Sandbox account from the PAYL business account for buyer approval.
5. Sign in as the merchant and use **Settlement → Withdrawal account** to save and confirm the recipient's PayPal email. Withdraw the full payable amount. PAYL keeps 10% in reserve and holds the rest as pending until PayPal confirms the item. The dashboard status action and lifecycle worker reconcile delayed payouts.
6. Test a PAYL AI purchase separately. The agent's quote, policy approval, mandate, and ledger capture remain the purchase authority; PayPal is used only when funds enter or leave PAYL.

The consumer and merchant web services validate browser write requests against Render's `RENDER_EXTERNAL_URL`. No additional origin variable is needed for the `onrender.com` URLs above. If either web service uses a custom domain, set `PAYL_PUBLIC_WEB_URL` on that web service to its own public HTTPS URL and redeploy it.

These are virtual Sandbox transfers. A live launch requires platform approval, country and Payouts eligibility, custody and safeguarding design, and production credentials. The current [PayPal Payouts country table](https://developer.paypal.com/payouts/supported-features/) does not list Nigeria.

## 6. Connect Codex

The hosted consumer MCP URL is:

```text
https://payl-api-dev3nigerian.onrender.com/mcp
```

Use `.codex/config.hosted.example.toml` as the template. The consumer dashboard's **Connect AI** tab also provides a copyable setup and downloadable config. Keep the local `.codex/config.toml` when you still want local development. The first connection opens the hosted consumer login and OAuth consent flow. Because the dashboard and API use different HTTPS origins, PAYL exchanges a two-minute, single-use browser handoff and establishes the API-origin OAuth session without putting the dashboard session token in a URL. The older `/mcp/wallet` and `/mcp/commerce` endpoints remain available for compatibility.

## Sign-in troubleshooting

If sign-in reports `UPSTREAM_INVALID_RESPONSE`, the web service received a non-JSON response from its configured API. On both web services, `PAYL_API_URL` should be `https://payl-api-dev3nigerian.onrender.com`. Check the API's `/healthz` endpoint for `status: ok` and `database: ready`.

Render's free services can serve a loading page while waking after inactivity. The login proxy retries transient startup responses up to three times, with a 15-second timeout per attempt. It returns a clear retryable `API_UNAVAILABLE` response if the API remains unavailable. Invalid credentials and rate limits are not automatically retried. If health checks stay unavailable, inspect the API service's deployment and database logs in Render. This login fix requires redeploying both web services and adds no environment keys.

## Operational boundaries

- Seeded balances and PayPal Sandbox transfers use virtual funds; the integration does not move live money.
- The signing hierarchy is derived from a Render-managed secret. It is suitable for a hosted sandbox only, not a real payment system.
- Render can restart or sleep free services at any time.
- Webhook retries are not timely while the API is asleep.
- Keep the repository private and never commit Render or Neon secrets.
- Upgrade to an always-on service, managed secret/KMS signer, production IAM/MFA, backups, monitoring, and a licensed payment partner before handling real funds.

## Official references

- [Render free service limits](https://render.com/docs/free)
- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render Docker deployment](https://render.com/docs/docker)
- [Neon pricing](https://neon.com/pricing)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)

### Landing page and workspace links

The consumer web service now serves the public PAYL landing page at `/` and the authenticated shopper workspace at `/dashboard`. The merchant workspace is at `/dashboard` on the merchant web service; its existing `/` address redirects there. Existing approval and OAuth callback URLs remain valid.

Redeploy both web services for the new UI. No new secrets or database migrations are needed for the frontend redesign. The Blueprint includes these public, server-side URL settings:

| Render service | Environment key | Value |
| --- | --- | --- |
| `payl-consumer-dev3nigerian` | `MERCHANT_WEB_URL` | `https://payl-merchant-dev3nigerian.onrender.com` |
| `payl-merchant-dev3nigerian` | `APPROVAL_WEB_URL` | `https://payl-consumer-dev3nigerian.onrender.com` |

These values control landing-page, sign-in, and workspace-switch links. Production defaults use the addresses above; set the keys explicitly if you use custom domains. Local development defaults to ports 3000 and 3001. Keep `PAYL_API_URL` and the existing origin-validation settings unchanged.
