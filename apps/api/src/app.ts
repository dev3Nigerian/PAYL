import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Config } from "./config.js";
import { DomainError } from "./errors.js";
import { bearerToken, cookieValue, type AuthSession, type IdentityService, type UserRole } from "./identity.js";
import { handleCommerceMcp, handleMerchantMcp, handleWalletMcp } from "./mcp.js";
import { MCP_SCOPES, type PaylOAuthProvider, requireToolScope, toolScopeForRequest } from "./oauth.js";
import type { PaylService } from "./service.js";

export function createApp(
  service: PaylService,
  identity: IdentityService,
  oauth: PaylOAuthProvider,
  config: Config,
): Express {
  const app = express();
  const mcpResource = new URL("/mcp", config.publicBaseUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpResource);
  app.disable("x-powered-by");
  app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.mfaCode", "req.body.mandate.jws"] }));
  app.use(cors({
    origin: [config.approvalWebUrl, config.merchantWebUrl],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization"],
  }));
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(express.urlencoded({ extended: false }));
  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false }));

  app.use(async (request, response, next) => {
    const token = cookieValue(request.header("cookie"), "payl_consumer_session");
    if (token) {
      try {
        response.locals.paylSession = await identity.authenticateSessionToken(token);
      } catch {
        response.locals.paylSession = undefined;
      }
    }
    next();
  });

  app.use(mcpAuthRouter({
    provider: oauth,
    issuerUrl: new URL(config.publicBaseUrl),
    baseUrl: new URL(config.publicBaseUrl),
    resourceServerUrl: mcpResource,
    resourceName: "PAYL consumer-to-merchant payments",
    scopesSupported: [...MCP_SCOPES],
    serviceDocumentationUrl: new URL("/docs/mcp", config.publicBaseUrl),
  }));

  app.post("/oauth/consent", async (request, response, next) => {
    try {
      const session = response.locals.paylSession as AuthSession | undefined;
      if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in to continue", 401);
      if (session.role !== "consumer") throw new DomainError("FORBIDDEN", "Consumer access is required", 403);
      await oauth.decideConsent(session, request, response);
    } catch (error) {
      next(error);
    }
  });

  app.get("/healthz", async (_request, response) => {
    try {
      await service.assertReady();
      response.json({ status: "ok", service: "payl-sandbox", railMode: "sandbox_ledger", identity: "session_oauth", database: "ready" });
    } catch {
      response.status(503).json({ status: "unavailable", service: "payl-sandbox", database: "unavailable" });
    }
  });

  const bearer = requireBearerAuth({ verifier: oauth, resourceMetadataUrl });
  app.post("/mcp/wallet", bearer, (request, _response, next) => {
    try {
      requireToolScope(request, toolScopeForRequest(request, "wallet"));
      next();
    } catch (error) {
      next(error);
    }
  }, async (request, response, next) => {
    try {
      await handleWalletMcp(service, request, response);
    } catch (error) {
      next(error);
    }
  });
  app.post("/mcp/commerce", bearer, (request, _response, next) => {
    try {
      requireToolScope(request, toolScopeForRequest(request, "merchant"));
      next();
    } catch (error) {
      next(error);
    }
  }, async (request, response, next) => {
    try {
      await handleCommerceMcp(service, request, response);
    } catch (error) {
      next(error);
    }
  });
  app.post("/mcp/merchants/:merchantId", bearer, (request, _response, next) => {
    try {
      requireToolScope(request, toolScopeForRequest(request, "merchant"));
      next();
    } catch (error) {
      next(error);
    }
  }, async (request, response, next) => {
    try {
      await handleMerchantMcp(service, request, response);
    } catch (error) {
      next(error);
    }
  });
  app.all(["/mcp/wallet", "/mcp/commerce", "/mcp/merchants/:merchantId"], (_request, response) => {
    response.status(405).set("Allow", "POST").json({ error: "The stateless MCP transport accepts POST only" });
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  const registrationLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
  app.post("/api/auth/register/merchant", registrationLimiter, async (request, response, next) => {
    try {
      const result = await identity.registerMerchant({
        businessName: request.body?.businessName,
        adminName: request.body?.adminName,
        email: request.body?.email,
        password: request.body?.password,
      });
      response.status(201).json({ ...result.session, merchant: result.merchant, sessionToken: result.token });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/auth/login", loginLimiter, async (request, response, next) => {
    try {
      const role = request.body?.role;
      if (role !== "consumer" && role !== "merchant_admin") throw new DomainError("INVALID_ROLE", "Choose a consumer or merchant login");
      const result = await identity.login(request.body?.email, request.body?.password, role);
      response.json({ ...result.session, sessionToken: result.token });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/auth/session", async (request, response, next) => {
    try {
      response.json(await requireWebSession(request, identity));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/auth/logout", async (request, response, next) => {
    try {
      const token = requireSessionBearer(request);
      await identity.revokeSession(token);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/consumer/dashboard", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json({
        ...await service.consumerDashboard(requireConsumerId(session)),
        connections: await identity.listGrants(session.userId),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/merchant/dashboard", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.merchantDashboard(requireMerchantId(session)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/approvals/:approvalId", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.getApproval(request.params.approvalId ?? "", requireConsumerId(session)));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/approvals/:approvalId/decision", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      const decision = request.body?.decision;
      if (decision !== "approve" && decision !== "decline") throw new DomainError("INVALID_DECISION", "Decision must be approve or decline");
      if (decision === "approve") await identity.verifyApprovalMfa(session.userId, request.body?.mfaCode);
      response.json(await service.decideApproval(request.params.approvalId ?? "", requireConsumerId(session), decision));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wallet/policy", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.walletPolicy(requireConsumerId(session)));
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/wallet/policy", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.updateWalletPolicy({
        consumerId: requireConsumerId(session),
        expectedVersion: request.body?.expectedVersion,
        autoApproveLimitMinor: request.body?.autoApproveLimitMinor,
        perTransactionLimitMinor: request.body?.perTransactionLimitMinor,
        dailyLimitMinor: request.body?.dailyLimitMinor,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/orders/:orderId/refund", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.status(201).json(await service.refundOrder({
        consumerId: requireConsumerId(session),
        orderId: request.params.orderId ?? "",
        idempotencyKey: request.body?.idempotencyKey,
        reason: request.body?.reason,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/oauth/grants", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json({ connections: await identity.listGrants(session.userId) });
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/oauth/grants", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      if (typeof request.body?.clientId !== "string" || typeof request.body?.resource !== "string") {
        throw new DomainError("INVALID_GRANT", "Client and resource are required");
      }
      await identity.revokeGrant(session.userId, request.body.clientId, request.body.resource);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/merchant/offers", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json({ offers: await service.listMerchantOffers(requireMerchantId(session)) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/merchant/offers", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.status(201).json(await service.createMerchantOffer({
        merchantId: requireMerchantId(session),
        name: request.body?.name,
        description: request.body?.description,
        priceMinor: request.body?.priceMinor,
        fulfillmentMethod: request.body?.fulfillmentMethod,
        refundable: request.body?.refundable,
        refundWindowMinutes: request.body?.refundWindowMinutes,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/merchant/offers/:offerId", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.updateMerchantOffer({
        merchantId: requireMerchantId(session),
        offerId: request.params.offerId ?? "",
        active: request.body?.active,
        refundable: request.body?.refundable,
        refundWindowMinutes: request.body?.refundWindowMinutes,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/merchants/:merchantId/offers", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      assertMerchant(session, request.params.merchantId ?? "");
      response.json({ offers: await service.listMerchantOffers(requireMerchantId(session)) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/merchants/:merchantId/offers", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      assertMerchant(session, request.params.merchantId ?? "");
      response.status(201).json(await service.createMerchantOffer({
        merchantId: requireMerchantId(session),
        name: request.body?.name,
        description: request.body?.description,
        priceMinor: request.body?.priceMinor,
        fulfillmentMethod: request.body?.fulfillmentMethod,
        refundable: request.body?.refundable,
        refundWindowMinutes: request.body?.refundWindowMinutes,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/merchants/:merchantId/offers/:offerId", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      assertMerchant(session, request.params.merchantId ?? "");
      response.json(await service.updateMerchantOffer({
        merchantId: requireMerchantId(session),
        offerId: request.params.offerId ?? "",
        active: request.body?.active,
        refundable: request.body?.refundable,
        refundWindowMinutes: request.body?.refundWindowMinutes,
      }));
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

async function requireWebSession(request: Request, identity: IdentityService, role?: UserRole): Promise<AuthSession> {
  const session = await identity.authenticateSessionToken(requireSessionBearer(request));
  if (role && session.role !== role) throw new DomainError("FORBIDDEN", "This account cannot access the requested workspace", 403);
  return session;
}

function requireSessionBearer(request: Request): string {
  const token = bearerToken(request.header("authorization"));
  if (!token) throw new DomainError("UNAUTHENTICATED", "Sign in to continue", 401);
  return token;
}

function requireConsumerId(session: AuthSession): string {
  if (!session.consumerId) throw new DomainError("FORBIDDEN", "Consumer access is required", 403);
  return session.consumerId;
}

function requireMerchantId(session: AuthSession): string {
  if (!session.merchantId) throw new DomainError("FORBIDDEN", "Merchant access is required", 403);
  return session.merchantId;
}

function assertMerchant(session: AuthSession, requestedMerchantId: string): void {
  if (requireMerchantId(session) !== requestedMerchantId) throw new DomainError("FORBIDDEN", "Merchant tenant does not match this session", 403);
}
