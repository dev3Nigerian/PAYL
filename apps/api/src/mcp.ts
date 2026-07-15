import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { PaymentMandateSchema, SignedQuoteSchema } from "@payl/contracts";
import { DomainError } from "./errors.js";
import type { PaylService } from "./service.js";

function result(value: unknown) {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent,
  };
}

function toolFailure(error: unknown) {
  const domain = error instanceof DomainError ? error : new DomainError("INTERNAL_ERROR", "The sandbox could not complete the request", 500, true);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ code: domain.code, message: domain.message, retryable: domain.retryable }),
      },
    ],
  };
}

function createWalletServer(service: PaylService, consumerId: string): McpServer {
  const server = new McpServer({ name: "payl-wallet-payment", version: "0.1.0" });

  server.registerTool(
    "wallet.get_summary",
    {
      title: "Get PAYL wallet summary",
      description: "Returns permission-scoped sandbox balances without reusable payment credentials.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return result(await service.walletSummary(consumerId));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "wallet.get_policy",
    {
      title: "Get effective agent spending policy",
      description: "Returns the limits applied to this wallet connection.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return result(await service.walletPolicy(consumerId));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "payment.prepare",
    {
      title: "Prepare a quote-bound payment",
      description: "Verifies a merchant-signed quote, applies policy, and either requests human approval or reserves funds.",
      inputSchema: {
        signedQuote: SignedQuoteSchema,
        agentClientId: z.string().min(3).max(128),
        idempotencyKey: z.string().min(8).max(128),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ signedQuote, agentClientId, idempotencyKey }) => {
      try {
        return result(await service.preparePayment({ consumerId, signedQuote, agentClientId, idempotencyKey }));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "payment.get_status",
    {
      title: "Get prepared payment status",
      description: "Returns payment state and the mandate only after authorization and reservation.",
      inputSchema: { paymentId: z.string().min(3).max(128) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ paymentId }) => {
      try {
        return result(await service.paymentStatus(paymentId, consumerId));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  return server;
}

function createMerchantServer(service: PaylService, merchantId: string): McpServer {
  const server = new McpServer({ name: "payl-merchant-commerce", version: "0.1.0" });

  server.registerTool(
    "commerce.search_offers",
    {
      title: "Search merchant offers",
      description: "Searches structured, fixed-price digital offers.",
      inputSchema: { query: z.string().max(200).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        return result({ offers: await service.searchOffers(merchantId, query) });
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "commerce.get_offer",
    {
      title: "Get merchant offer",
      description: "Returns the current structured offer, price basis, and terms.",
      inputSchema: { offerId: z.string().min(3).max(128) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ offerId }) => {
      try {
        return result(await service.getOffer(merchantId, offerId));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "commerce.create_quote",
    {
      title: "Create signed merchant quote",
      description: "Creates an immutable, signed, ten-minute quote. It does not move money or create an order.",
      inputSchema: {
        offerId: z.string().min(3).max(128),
        quantity: z.number().int().positive().max(100).default(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ offerId, quantity }) => {
      try {
        return result(await service.createQuote(merchantId, offerId, quantity));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "commerce.commit_order",
    {
      title: "Commit and fulfill a quote-bound order",
      description: "Consumes a PAYL single-use mandate, captures reserved funds, commits the order, and returns a signed receipt.",
      inputSchema: {
        signedQuote: SignedQuoteSchema,
        mandate: PaymentMandateSchema,
        idempotencyKey: z.string().min(8).max(128),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ signedQuote, mandate, idempotencyKey }) => {
      try {
        return result(await service.commitOrder({ merchantId, signedQuote, mandate, idempotencyKey }));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "commerce.get_order",
    {
      title: "Get signed order receipt",
      description: "Returns a permission-scoped order receipt.",
      inputSchema: { orderId: z.string().min(3).max(128) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ orderId }) => {
      try {
        return result(await service.getOrder(merchantId, orderId));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  return server;
}

async function handle(server: McpServer, request: Request, response: Response): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
}

export async function handleWalletMcp(service: PaylService, request: Request, response: Response): Promise<void> {
  const consumerId = request.header("x-payl-consumer-id");
  if (!consumerId) {
    response.status(401).json({ error: "Sandbox wallet connection requires x-payl-consumer-id" });
    return;
  }
  await handle(createWalletServer(service, consumerId), request, response);
}

export async function handleMerchantMcp(service: PaylService, request: Request, response: Response): Promise<void> {
  const parameter = request.params.merchantId;
  const merchantId = Array.isArray(parameter) ? parameter[0] : parameter;
  if (!merchantId) {
    response.status(400).json({ error: "Merchant id is required" });
    return;
  }
  await handle(createMerchantServer(service, merchantId), request, response);
}
