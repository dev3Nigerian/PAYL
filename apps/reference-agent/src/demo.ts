import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { PaymentMandateSchema, SignedQuoteSchema } from "@payl/contracts";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";
const merchantId = process.env.SANDBOX_MERCHANT_ID ?? "merchant_demo";
const callbackUrl = "http://127.0.0.1:7799/callback";

function transport(path: string, authProvider: OAuthClientProvider) {
  return new StreamableHTTPClientTransport(new URL(path, apiUrl), {
    authProvider,
  });
}

class MemoryOAuthProvider implements OAuthClientProvider {
  private client: OAuthClientInformationMixed | undefined;
  private tokenSet: OAuthTokens | undefined;
  private verifier: string | undefined;
  readonly stateValue = randomBytes(24).toString("base64url");

  get redirectUrl() { return callbackUrl; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "PAYL reference consumer agent",
      redirect_uris: [callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() { return this.stateValue; }
  clientInformation() { return this.client; }
  saveClientInformation(client: OAuthClientInformationMixed) { this.client = client; }
  tokens() { return this.tokenSet; }
  saveTokens(tokens: OAuthTokens) { this.tokenSet = tokens; }
  redirectToAuthorization(url: URL) { console.log(`\nOpen this URL to sign in and authorize the PAYL agent:\n${url.href}\n`); }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() {
    if (!this.verifier) throw new Error("OAuth PKCE verifier is missing");
    return this.verifier;
  }
}

function valueFrom(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  if (result.isError) {
    const text = Array.isArray(result.content) && result.content[0]?.type === "text" ? result.content[0].text : "MCP tool failed";
    throw new Error(text);
  }
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  const text = Array.isArray(result.content) && result.content[0]?.type === "text" ? result.content[0].text : "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  const merchant = new Client({ name: "payl-reference-consumer-agent", version: "0.1.0" });
  const wallet = new Client({ name: "payl-reference-consumer-agent", version: "0.1.0" });
  const oauth = new MemoryOAuthProvider();
  await connectWithOAuth(merchant, `/mcp/merchants/${merchantId}`, oauth);
  await wallet.connect(transport("/mcp/wallet", oauth));

  try {
    const offers = valueFrom(await merchant.callTool({ name: "commerce.search_offers", arguments: { query: "research" } }));
    console.log("1. Merchant offers discovered", offers.offers);

    const signedQuote = SignedQuoteSchema.parse(
      valueFrom(
        await merchant.callTool({
          name: "commerce.create_quote",
          arguments: { offerId: "offer_research_pack", quantity: 1 },
        }),
      ),
    );
    console.log("2. Signed quote received", {
      quoteId: signedQuote.payload.quoteId,
      totalMinor: signedQuote.payload.totalMinor,
      currency: signedQuote.payload.currency,
      quoteHash: signedQuote.hash,
    });

    const prepared = valueFrom(
      await wallet.callTool({
        name: "payment.prepare",
        arguments: {
          signedQuote,
          agentClientId: "agent_reference",
          idempotencyKey: `prepare-${signedQuote.payload.quoteId}`,
        },
      }),
    );
    console.log("3. PAYL policy decision", prepared);

    const paymentId = String(prepared.paymentId);
    if (prepared.status === "pending_approval") {
      const approvalId = String(prepared.approvalId);
      console.log(`4. Human approval required: ${String(prepared.approvalUrl)}`);
      await waitForHumanApproval(wallet, paymentId);
    }

    const status = valueFrom(
      await wallet.callTool({ name: "payment.get_status", arguments: { paymentId } }),
    );
    if (status.status !== "reserved") throw new Error(`Payment is ${String(status.status)}, not reserved`);
    const mandate = PaymentMandateSchema.parse(status.mandate);
    console.log("5. Quote-bound single-use mandate issued", {
      mandateId: mandate.payload.mandateId,
      approvalLevel: mandate.payload.approvalLevel,
      quoteHash: mandate.payload.quoteHash,
    });

    const receipt = valueFrom(
      await merchant.callTool({
        name: "commerce.commit_order",
        arguments: {
          signedQuote,
          mandate,
          idempotencyKey: `commit-${mandate.payload.mandateId}`,
        },
      }),
    );
    console.log("6. Payment captured and signed receipt returned", receipt);
  } finally {
    await Promise.all([merchant.close(), wallet.close()]);
  }
}

async function connectWithOAuth(client: Client, path: string, provider: MemoryOAuthProvider): Promise<void> {
  const firstTransport = transport(path, provider);
  try {
    await client.connect(firstTransport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    const code = await waitForOAuthCallback(provider.stateValue);
    await firstTransport.finishAuth(code);
    await client.connect(transport(path, provider));
  }
}

function waitForOAuthCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", callbackUrl);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (error || state !== expectedState || !code) {
        response.writeHead(400, { "content-type": "text/plain" }).end("PAYL authorization failed. Return to the terminal.");
        server.close();
        reject(new Error(error ?? "OAuth callback validation failed"));
        return;
      }
      response.writeHead(200, { "content-type": "text/html" }).end("<h1>PAYL connected</h1><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolve(code);
    });
    server.listen(7799, "127.0.0.1");
    server.on("error", reject);
  });
}

async function waitForHumanApproval(wallet: Client, paymentId: string): Promise<void> {
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const status = valueFrom(await wallet.callTool({ name: "payment.get_status", arguments: { paymentId } }));
    if (status.status === "reserved") return;
    if (["declined", "expired", "released"].includes(String(status.status))) {
      throw new Error(`Payment ended in state ${String(status.status)}`);
    }
  }
  throw new Error("Timed out waiting for human approval");
}

await main();
