import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PaymentMandateSchema, SignedQuoteSchema } from "@payl/contracts";

const apiUrl = process.env.PAYL_API_URL ?? "http://localhost:4100";
const consumerId = process.env.SANDBOX_CONSUMER_ID ?? "consumer_demo";
const merchantId = process.env.SANDBOX_MERCHANT_ID ?? "merchant_demo";
const autoApprove = process.argv.includes("--auto-approve");

function transport(path: string, headers: Record<string, string> = {}) {
  return new StreamableHTTPClientTransport(new URL(path, apiUrl), {
    requestInit: { headers },
  });
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
  await merchant.connect(transport(`/mcp/merchants/${merchantId}`));
  await wallet.connect(transport("/mcp/wallet", { "x-payl-consumer-id": consumerId }));

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
      if (autoApprove) {
        console.warn("   --auto-approve is a local test shortcut; production approval is always a separate authenticated human action.");
        const response = await fetch(`${apiUrl}/api/approvals/${approvalId}/decision`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-payl-consumer-id": consumerId },
          body: JSON.stringify({ decision: "approve" }),
        });
        if (!response.ok) throw new Error(`Approval failed: ${await response.text()}`);
      } else {
        await waitForHumanApproval(wallet, paymentId);
      }
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
