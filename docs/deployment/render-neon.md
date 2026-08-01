# Host the PAYL sandbox on Render and Neon

This deployment is for product demonstrations with simulated funds. It is not approved for live payments, custody, bank credentials, card data, production identity verification, or merchant settlement.

## Architecture

- `payl-api-dev3nigerian`: Express API, OAuth authorization server, two MCP endpoints, migrations, lifecycle processing, and webhook delivery.
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

## 6. Connect Codex

The hosted MCP URLs are:

```text
https://payl-api-dev3nigerian.onrender.com/mcp/wallet
https://payl-api-dev3nigerian.onrender.com/mcp/commerce
```

Use `.codex/config.hosted.example.toml` as the template. Keep the local `.codex/config.toml` when you still want local development. The first connection opens the hosted consumer login and OAuth consent flow. Because the dashboard and API use different HTTPS origins, PAYL exchanges a two-minute, single-use browser handoff and establishes the API-origin OAuth session without putting the dashboard session token in a URL.

## Operational boundaries

- All balances and payouts are simulated.
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
