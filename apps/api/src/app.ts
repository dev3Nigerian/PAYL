import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import type { Config } from "./config.js";
import { DomainError } from "./errors.js";
import { handleMerchantMcp, handleWalletMcp } from "./mcp.js";
import type { PaylService } from "./service.js";

export function createApp(service: PaylService, config: Config): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie", "req.body.mandate.jws"] }));
  app.use(cors({ origin: config.approvalWebUrl, methods: ["GET", "POST"], allowedHeaders: ["content-type", "x-payl-consumer-id"] }));
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false }));

  app.get("/healthz", async (_request, response, next) => {
    try {
      response.json({ status: "ok", service: "payl-sandbox", railMode: "sandbox_ledger" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp/wallet", async (request, response, next) => {
    try {
      await handleWalletMcp(service, request, response);
    } catch (error) {
      next(error);
    }
  });
  app.post("/mcp/merchants/:merchantId", async (request, response, next) => {
    try {
      await handleMerchantMcp(service, request, response);
    } catch (error) {
      next(error);
    }
  });
  app.all(["/mcp/wallet", "/mcp/merchants/:merchantId"], (_request, response) => {
    response.status(405).set("Allow", "POST").json({ error: "The stateless sandbox MCP transport accepts POST only" });
  });

  app.get("/api/approvals/:approvalId", async (request, response, next) => {
    try {
      const consumerId = requireConsumer(request);
      response.json(await service.getApproval(request.params.approvalId ?? "", consumerId));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/approvals/:approvalId/decision", async (request, response, next) => {
    try {
      const consumerId = requireConsumer(request);
      const decision = request.body?.decision;
      if (decision !== "approve" && decision !== "decline") {
        throw new DomainError("INVALID_DECISION", "Decision must be approve or decline");
      }
      response.json(await service.decideApproval(request.params.approvalId ?? "", consumerId, decision));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/demo/state", async (_request, response, next) => {
    try {
      response.json(await service.demoState());
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const domain = error instanceof DomainError ? error : new DomainError("INTERNAL_ERROR", "Internal sandbox error", 500, true);
    request.log?.error({ err: error, code: domain.code }, "request failed");
    response.status(domain.statusCode).json({ error: { code: domain.code, message: domain.message, retryable: domain.retryable } });
  });

  return app;
}

function requireConsumer(request: Request): string {
  const consumerId = request.header("x-payl-consumer-id");
  if (!consumerId) throw new DomainError("UNAUTHENTICATED", "Sandbox consumer session is required", 401);
  return consumerId;
}
