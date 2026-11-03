# Connect antspace.online to the existing Render deployment

Antspace uses two public web domains:

| Host | Existing Render service | Use |
| --- | --- | --- |
| `antspace.online` | `payl-consumer-dev3nigerian` | Shared landing page, consumer sign-up and dashboard |
| `www.antspace.online` | `payl-consumer-dev3nigerian` | Redirect to the root domain |
| `merchants.antspace.online` | `payl-merchant-dev3nigerian` | Merchant sign-up and dashboard |

The API remains at `https://payl-api-dev3nigerian.onrender.com`. Its PayPal webhook, OAuth issuer, MCP endpoint, signing keys, database, and account identifiers remain unchanged. This rebrand does not require a migration, reset, replacement service, or new API credentials. Newly enrolled authenticators use the Antspace label; existing authenticators continue working.

## 1. Register the domains with Render

Sync the existing Blueprint from `codex/hosted-sandbox-deployment`. `render.yaml` declares `antspace.online` on the consumer web service and `merchants.antspace.online` on the merchant web service. Render adds the corresponding `www` redirect for the root domain.

Alternatively, add those hostnames in each existing service's **Settings → Custom Domains**. Preserve the three service names when syncing the Blueprint. Adding new service names can create replacement services.

Keep the original Render subdomains enabled. Deploy the rebrand before testing browser writes: the shared origin check accepts each service's configured custom origin and its own `RENDER_EXTERNAL_URL`, and rejects unrelated origins. No wildcard or forwarded-header trust is used.

## 2. Update Namecheap DNS

The domain's observed nameservers are `dns1.registrar-servers.com` and `dns2.registrar-servers.com`. In **Domain List → antspace.online → Manage → Advanced DNS**, save a copy of existing records, then set:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `216.24.57.1` | 1 minute or Automatic |
| CNAME | `www` | `payl-consumer-dev3nigerian.onrender.com` | 1 minute or Automatic |
| CNAME | `merchants` | `payl-merchant-dev3nigerian.onrender.com` | 1 minute or Automatic |

Replace conflicting A, CNAME, or URL Redirect records for these exact hosts; remove AAAA records only for the hosts being moved to Render. Preserve MX, mail-related TXT, verification records, and unrelated subdomains. If CAA records restrict certificate issuance, allow the certificate authorities specified by Render.

Return to both services' Custom Domains settings and choose **Verify**. Wait for the domains and HTTPS certificates to become ready. Confirm the consumer `/login` and merchant `/login` load on the new origins before switching navigation.

Sources: [Render's Namecheap DNS guide](https://render.com/docs/configure-namecheap-dns) and [custom-domain verification](https://render.com/docs/custom-domains).

## 3. Apply the canonical web URLs

The Blueprint now contains the following canonical values. Sync the existing Blueprint from `codex/hosted-sandbox-deployment` to apply them to the three services. For manual service configuration, use the same values in Render's environment settings:

| Service | Key | Value |
| --- | --- | --- |
| API | `APPROVAL_WEB_URL` | `https://antspace.online` |
| API | `MERCHANT_WEB_URL` | `https://merchants.antspace.online` |
| Consumer web | `MERCHANT_WEB_URL` | `https://merchants.antspace.online` |
| Consumer web | `PAYL_PUBLIC_WEB_URL` | `https://antspace.online` |
| Merchant web | `APPROVAL_WEB_URL` | `https://antspace.online` |
| Merchant web | `PAYL_PUBLIC_WEB_URL` | `https://merchants.antspace.online` |

Redeploy all three services. Keep `PAYL_API_URL`, `PUBLIC_BASE_URL`, `PAYL_ISSUER`, `PAYPAL_SANDBOX_WEBHOOK_ID`, and the PayPal webhook destination unchanged. The API's public authorization URL must stay consistent with existing OAuth connections.

After changing DNS, some resolvers may temporarily return the previous host even after the certificate shows issued. The authoritative Namecheap records and both the Google and Cloudflare public resolvers should return the values above. Allow cached answers to expire; verify HTTPS against the new Render destination before diagnosing application code. An old host redirecting the root to `www` can temporarily conflict with Render's `www`-to-root redirect while those cached answers remain.

## 4. Verify the switch

1. Visit `https://antspace.online`: confirm the Antspace mark, shopper sign-up, and seller link to `https://merchants.antspace.online/register`.
2. Visit `https://www.antspace.online`: confirm it redirects to the root domain.
3. Visit the merchant site's `/`: confirm it returns to the shared Antspace landing page. Both `/dashboard` routes still open their own workspace.
4. Sign in again on each new domain. Sessions use host-only cookies, so a session from an old Render hostname is not automatically transferred. Existing accounts, balances, purchases, authenticator codes, and files remain available.
5. Check a wallet policy save, merchant product edit, and a human-approval link. Confirm no origin error and that new approval links use the consumer custom domain.
6. Check PayPal funding and payouts with the configured Sandbox accounts when ready; the provider endpoint and webhook have not moved.

If either custom domain is not ready, keep or restore `APPROVAL_WEB_URL` and `MERCHANT_WEB_URL` to the original Render origins in the Blueprint and service settings. The rebranded app remains usable there while DNS propagates.
