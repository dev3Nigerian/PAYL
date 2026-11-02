# Host the Antspace sandbox on Render and Neon

This deployment is for product demonstrations with simulated funds. It is not approved for live payments, custody, bank credentials, card data, production identity verification, or merchant settlement.

## Architecture

- `payl-api-dev3nigerian`: Express API, OAuth authorization server, unified consumer MCP endpoint plus compatibility endpoints, migrations, lifecycle processing, and webhook delivery.
- `payl-consumer-dev3nigerian`: shared public landing page, consumer registration, wallet, and approval dashboard.
- `payl-merchant-dev3nigerian`: merchant registration, catalog, orders, and settlement dashboard.
- Neon: persistent PostgreSQL database using its pooled TLS connection.

The three Render services use the repository's root `render.yaml`. Each service builds from its own Dockerfile but retains the monorepo root as the Docker context.

The Blueprint uses `antspace.online` and `merchants.antspace.online` for public navigation, approvals, and each frontend's `PAYL_PUBLIC_WEB_URL`. The [custom-domain guide](antspace-domain.md) documents DNS and certificate verification. Existing service names, API endpoints, secrets, and database remain compatible.

## Render compute and credit budget

The Blueprint sets `plan: starter` and `numInstances: 1` on all three web services. Starter is the supported legacy name for Render's `0.5c-512mb` compute plan (0.5 CPU and 512 MB RAM). Paid web services do not spin down for inactivity, keeping both dashboards available and the API's lifecycle processing and webhook retries running between requests.

| Service | Instances | Base compute per month |
| --- | --- | --- |
| API | 1 | $7 |
| Consumer web | 1 | $7 |
| Merchant web | 1 | $7 |
| **Total** | **3** | **$21** |

Prices were checked on 1 November 2026 against [Render pricing](https://render.com/pricing). With the full $50 credit available, this is approximately 2.4 months of base compute, before other billable usage and subject to the credits' expiry and terms. Keep the workspace on the free Hobby workspace plan; paid service compute does not require a paid workspace subscription. Credits apply in Render's workspace billing settings, not through an environment variable or a Blueprint field. Check the credit balance and expiry in Billing.

Neon's free database scales to zero and is appropriate for a small, intermittent sandbox. Monitor its compute, storage, and network-transfer allowances.

## 1. Confirm the service names

The Blueprint reserves these public hostnames:

```text
https://payl-api-dev3nigerian.onrender.com
https://antspace.online
https://merchants.antspace.online
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
2. Choose **New → Blueprint** and select the Antspace repository.
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

### Upgrade an existing Blueprint

1. Ensure the branch linked to the existing Antspace Blueprint contains this `render.yaml`. If the Blueprint tracks `main`, merge the change into `main` first.
2. Open that Blueprint in Render. Auto Sync applies changes pushed to its linked branch; if Auto Sync is disabled, select **Manual Sync**.
3. Review the update to the three existing services: one Starter (`0.5c-512mb`) instance each. Wait for the sync and deployments to complete.
4. Confirm the compute plan on each service and run the health and sign-in checks below.

Use the existing Blueprint so the upgrade applies to the existing services. This compute-only change needs no new environment variables, database migrations, or database reset. If the services were created individually and are not managed by a Blueprint, change each existing service's compute plan to Starter in Render, or follow Render's instructions for adding existing resources to a Blueprint.

## 5. Verify the deployment

The sample-catalog refresh requires an **API redeploy**. API startup applies `0014_sample_catalog.sql`, then installs 18 downloadable sample products across six merchants when `SANDBOX_BOOTSTRAP_ENABLED=true` (the existing Blueprint setting). No new environment keys or database reset are needed. The first run archives all previous listings while preserving their order references and delivery files. A durable catalog revision prevents future restarts from replacing products again. The API logs `Sandbox sample catalog checked` with `applied`, `version`, and, on first application, the product and merchant counts.

After this deployment, check that the configured sandbox merchant has three new Atlas products. Ask the consumer chat for a portfolio template under $30, a weekly planner, or customer research downloads. Complete a small purchase and download its ZIP, then test a refund. The $59 and $69 products exercise the default approval limit. Existing orders and downloads must remain accessible. The [sample catalog in the README](../../README.md#sample-digital-marketplace) lists the full inventory and prices.

Share `https://antspace.online/` as the single public entry link. **Shop with AI** opens consumer registration with the $100 sandbox welcome credit; **Sell on Antspace** opens merchant registration. Returning users have a sign-in link for each role. The merchant site's bare root redirects to the same public landing page, and both dashboards remain at their own `/dashboard` routes. A verified existing session skips login/registration in that workspace. The landing page remains accessible from every Antspace logo.

For the shared-entry update, redeploy **both web services**. No new environment variables or database migrations are needed. Existing `MERCHANT_WEB_URL` and `APPROVAL_WEB_URL` values control cross-workspace links; if using custom domains, set them to the corresponding web origins.

Consumer self-registration is available at `https://antspace.online/register`. Redeploy the API and consumer web service for this feature. API startup applies `0013_consumer_mfa_enrollment.sql`; it adds pending authenticator enrollment storage without changing existing accounts. No new environment variables or database reset are needed.

Register a new consumer and confirm the wallet shows $100 in virtual USD. Repeating registration with the same email must not create another account or credit. Under **Security**, add the setup key to a time-based authenticator and confirm its code before testing a purchase over the default $50 auto-approval limit. The signup grant is recorded separately as `sandbox_signup_credit` in the balanced ledger and is not a PayPal capture.

Open these URLs:

```text
https://payl-api-dev3nigerian.onrender.com/healthz
https://antspace.online/login
https://merchants.antspace.online/login
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

1. In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), create or select a Sandbox business account for Antspace, a Sandbox personal buyer, and a Sandbox merchant recipient. Enable Payouts for the Antspace REST app. The business account needs enough Sandbox balance for payouts.
2. Configure an app webhook at `https://payl-api-dev3nigerian.onrender.com/api/paypal/webhook`. Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.PAYOUTSBATCH.*`, and `PAYMENT.PAYOUTS-ITEM.*` events that PayPal offers for the app. Record its webhook ID.
3. On the **API service only**, set `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, `PAYPAL_SANDBOX_MERCHANT_ID` (the business account's merchant ID), and `PAYPAL_SANDBOX_WEBHOOK_ID`. Set all four together, then redeploy. The browser receives only the public client ID from the signed-in consumer dashboard.
4. Sign in as the consumer and use **Wallet → Add funds to Antspace** with the Sandbox buyer. A completed capture credits the full amount once; Antspace records the PayPal fee separately. Use a different Sandbox account from the Antspace business account for buyer approval.
5. Sign in as the merchant and use **Settlement → Withdrawal account** to save and confirm the recipient's PayPal email. Withdraw the full payable amount. Antspace keeps 10% in reserve and holds the rest as pending until PayPal confirms the item. The dashboard status action and lifecycle worker reconcile delayed payouts.
6. Test an Antspace AI purchase separately. The agent's quote, policy approval, mandate, and ledger capture remain the purchase authority; PayPal is used only when funds enter or leave Antspace.

The consumer and merchant web services validate browser write requests against their own `PAYL_PUBLIC_WEB_URL` and Render's `RENDER_EXTERNAL_URL`. Both explicitly configured origins work during domain migration; unrelated origins and sibling workspaces are rejected. Set `PAYL_PUBLIC_WEB_URL` to `https://antspace.online` on consumer-web and `https://merchants.antspace.online` on merchant-web. The Blueprint includes these values. Redeploy both web services before testing browser writes on the new domains.

These are virtual Sandbox transfers. A live launch requires platform approval, country and Payouts eligibility, custody and safeguarding design, and production credentials. The current [PayPal Payouts country table](https://developer.paypal.com/payouts/supported-features/) does not list Nigeria.

## 6. Connect Codex

The hosted consumer MCP URL is:

```text
https://payl-api-dev3nigerian.onrender.com/mcp
```

Use `.codex/config.hosted.example.toml` as the template. The consumer dashboard's **Connect AI** tab also provides a copyable setup and downloadable config. Keep the local `.codex/config.toml` when you still want local development. The first connection opens the hosted consumer login and OAuth consent flow. Because the dashboard and API use different HTTPS origins, Antspace exchanges a two-minute, single-use browser handoff and establishes the API-origin OAuth session without putting the dashboard session token in a URL. The older `/mcp/wallet` and `/mcp/commerce` endpoints remain available for compatibility.

## Sign-in troubleshooting

If sign-in reports `UPSTREAM_INVALID_RESPONSE`, the web service received a non-JSON response from its configured API. On both web services, `PAYL_API_URL` should be `https://payl-api-dev3nigerian.onrender.com`. Check the API's `/healthz` endpoint for `status: ok` and `database: ready`.

If an older deployment still uses free compute, Render can serve a loading page while waking after inactivity; sync the paid Blueprint to remove that idle sleep. Paid services can still restart or temporarily become unavailable. The login proxy retries transient startup responses up to three times, with a 15-second timeout per attempt. It returns a clear retryable `API_UNAVAILABLE` response if the API remains unavailable. Invalid credentials and rate limits are not automatically retried. If health checks stay unavailable, inspect the API service's deployment and database logs in Render. This login fix requires redeploying both web services and adds no environment keys.

## Operational boundaries

- Seeded balances and PayPal Sandbox transfers use virtual funds; the integration does not move live money.
- The signing hierarchy is derived from a Render-managed secret. It is suitable for a hosted sandbox only, not a real payment system.
- Paid compute removes idle sleep; deployments, restarts, or outages can still interrupt a service.
- API lifecycle processing and webhook delivery resume after a restart; pending payouts are also reconciled on status requests.
- Keep the repository private and never commit Render or Neon secrets.
- A live-funds deployment additionally needs a managed secret/KMS signer, production IAM/MFA, backups, monitoring, and a licensed payment partner.

## Official references

- [Render free service limits](https://render.com/docs/free)
- [Render pricing](https://render.com/pricing)
- [Render compute plans](https://render.com/docs/compute-plans)
- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render Docker deployment](https://render.com/docs/docker)
- [Neon pricing](https://neon.com/pricing)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)

### Landing page and workspace links

The consumer web service serves the public Antspace landing page at `/` and the authenticated shopper workspace at `/dashboard`. The merchant workspace is at `/dashboard` on the merchant web service; its `/` address redirects to the shared landing page. Existing approval and OAuth callback URLs remain valid.

Redeploy both web services for the new UI. No new secrets or database migrations are needed for the frontend redesign. The Blueprint includes these public, server-side URL settings:

| Render service | Environment key | Value |
| --- | --- | --- |
| `payl-consumer-dev3nigerian` | `MERCHANT_WEB_URL` | `https://merchants.antspace.online` |
| `payl-merchant-dev3nigerian` | `APPROVAL_WEB_URL` | `https://antspace.online` |

These values control landing-page, sign-in, and workspace-switch links. Production defaults use the Antspace domains, and the API uses the same consumer origin for approval links and OAuth sign-in. Local development defaults to ports 3000 and 3001. Keep `PAYL_API_URL` on the existing API address. See the [Antspace domain guide](antspace-domain.md) for all service settings and rollback instructions.
