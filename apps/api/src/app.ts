import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import cors from "cors";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Config } from "./config.js";
import { DomainError } from "./errors.js";
import { bearerToken, cookieValue, type AuthSession, type IdentityService, type UserRole } from "./identity.js";
import { handleCommerceMcp, handleConsumerMcp, handleMerchantMcp, handleWalletMcp } from "./mcp.js";
import { MCP_SCOPES, type PaylOAuthProvider, requireToolScope, toolScopeForRequest } from "./oauth.js";
import { DIGITAL_GOODS_TERMS_V1, type PaylService } from "./service.js";
import { PaymentMandateSchema, SignedQuoteSchema, type SignedQuote } from "@payl/contracts";

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
  if (config.deploymentProfile === "hosted_sandbox") app.set("trust proxy", 1);
  app.use((_request, response, next) => {
    response.setHeader("x-payl-environment", config.deploymentProfile);
    next();
  });
  app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.mfaCode", "req.body.mandate.jws"] }));
  app.use(cors({
    origin: [config.approvalWebUrl, config.merchantWebUrl],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization"],
  }));
  app.post("/api/paypal/webhook", express.raw({ type: "application/json", limit: "256kb" }), async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) throw new DomainError("PAYPAL_WEBHOOK_INVALID", "PayPal webhook body is required");
      await service.handlePayPalWebhook(request.body, request.headers);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
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
    resourceName: "Antspace consumer-to-merchant payments",
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
      response.json({ status: "ok", service: "payl-sandbox", environment: config.deploymentProfile, railMode: "sandbox_ledger", identity: "session_oauth", database: "ready" });
    } catch {
      response.status(503).json({ status: "unavailable", service: "payl-sandbox", database: "unavailable" });
    }
  });

  app.get("/docs/mcp", (_request, response) => {
    const endpoint = new URL("/mcp", config.publicBaseUrl).href;
    const dashboard = new URL("/", config.approvalWebUrl).href;
    response.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Antspace to your AI</title><style>body{margin:0;padding:32px;background:#f3f4ed;color:#111914;font-family:system-ui,sans-serif;line-height:1.6}.card{max-width:680px;margin:auto;padding:32px;border:1px solid #dce1d7;border-radius:24px;background:#fff;box-shadow:0 24px 70px rgba(30,52,38,.12)}.brand{color:#0b6b42;font-size:22px;font-weight:900}h1{margin:28px 0 8px;line-height:1.1}h2{margin-top:28px;font-size:18px}p,li{color:#627068}code,pre{display:block;overflow:auto;padding:14px;border-radius:12px;background:#f1f5ed;color:#0b6b42}a{color:#0b6b42;font-weight:700}</style></head><body><main class="card"><div class="brand">Antspace</div><h1>Connect your AI once</h1><p>Add one MCP server to your AI client. The same connection includes your Antspace wallet and every registered merchant.</p><h2>Connection URL</h2><code>${html(endpoint)}</code><h2>Setup</h2><ol><li>Add the URL above in Codex or another OAuth-capable MCP client.</li><li>When Antspace opens, sign in as the consumer and choose <strong>Allow connection</strong>.</li><li>Ask your AI to check your balance or compare Antspace offers.</li></ol><p>Your AI receives scoped tools through OAuth; it never receives your Antspace password or wallet secret.</p><p><a href="${html(dashboard)}">Open the consumer dashboard</a> to copy a Codex setup file and manage connected clients.</p></main></body></html>`);
  });

  app.get("/terms/digital-goods-v1", (_request, response) => {
    response.type("text/plain").send(DIGITAL_GOODS_TERMS_V1);
  });

  const bearer = requireBearerAuth({ verifier: oauth, resourceMetadataUrl });
  app.post("/mcp", bearer, (request, _response, next) => {
    try {
      requireToolScope(request, toolScopeForRequest(request, "network"));
      next();
    } catch (error) {
      next(error);
    }
  }, async (request, response, next) => {
    try {
      await handleConsumerMcp(service, request, response);
    } catch (error) {
      next(error);
    }
  });
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
  app.all(["/mcp", "/mcp/wallet", "/mcp/commerce", "/mcp/merchants/:merchantId"], (_request, response) => {
    response.status(405).set("Allow", "POST").json({ error: "The stateless MCP transport accepts POST only" });
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  const registrationLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
  app.post("/api/auth/register/consumer", registrationLimiter, async (request, response, next) => {
    try {
      const result = await identity.registerConsumer({ displayName: request.body?.displayName, email: request.body?.email, password: request.body?.password });
      response.status(201).set("cache-control", "no-store").json({ ...result.session, welcomeCredit: result.welcomeCredit, sessionToken: result.token });
    } catch (error) { next(error); }
  });
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
  app.post("/api/auth/handoff", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity);
      response.set("cache-control", "no-store").json({ handoffUrl: await identity.createBrowserHandoff(session) });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/auth/handoff", async (request, response, next) => {
    try {
      const returnTo = hostedAuthorizeReturnTo(request.query.returnTo, config);
      const result = await identity.consumeBrowserHandoff(request.query.code);
      response.cookie("payl_consumer_session", result.token, {
        httpOnly: true,
        secure: config.deploymentProfile === "hosted_sandbox",
        sameSite: "lax",
        path: "/",
        maxAge: config.sessionTtlHours * 60 * 60_000,
      });
      response.set({ "cache-control": "no-store", "referrer-policy": "no-referrer" }).redirect(303, returnTo);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/auth/browser-logout", async (request, response) => {
    const token = cookieValue(request.header("cookie"), "payl_consumer_session");
    if (token) await identity.revokeSession(token);
    response.clearCookie("payl_consumer_session", {
      httpOnly: true,
      secure: config.deploymentProfile === "hosted_sandbox",
      sameSite: "lax",
      path: "/",
    });
    response.set("cache-control", "no-store").redirect(303, new URL("/login", config.approvalWebUrl).href);
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
  app.get("/api/consumer/mfa", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.set("cache-control", "no-store").json(await identity.mfaStatus(session.userId));
    } catch (error) { next(error); }
  });
  const enrollmentLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (request) => {
      const token = bearerToken(request.header("authorization")) ?? cookieValue(request.header("cookie"), "payl_consumer_session");
      return token ? createHash("sha256").update(token).digest("hex") : ipKeyGenerator(request.ip ?? "unknown");
    },
    handler: (_request, response) => response.status(429).json({ error: { code: "MFA_RATE_LIMITED", message: "Too many setup attempts. Please try again in 15 minutes.", retryable: true } }),
  });
  app.post("/api/consumer/mfa", enrollmentLimiter, async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      response.set("cache-control", "no-store");
      if (request.body?.action === "start") response.json(await identity.startMfaEnrollment(session.userId));
      else if (request.body?.action === "confirm") response.json(await identity.confirmMfaEnrollment(session.userId, request.body?.mfaCode));
      else throw new DomainError("INVALID_ACTION", "Choose start or confirm");
    } catch (error) { next(error); }
  });
  app.post("/api/consumer/topups", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      response.status(201).json(await service.createTopup({
        consumerId: requireConsumerId(session),
        amountMinor: request.body?.amountMinor,
        idempotencyKey: request.body?.idempotencyKey,
      }));
    } catch (error) { next(error); }
  });
  app.get("/api/consumer/topups/:topupId", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.topupStatus(requireConsumerId(session), request.params.topupId ?? ""));
    } catch (error) { next(error); }
  });
  app.post("/api/consumer/topups/:topupId/capture", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.captureTopup(requireConsumerId(session), request.params.topupId ?? ""));
    } catch (error) { next(error); }
  });
  app.post("/api/consumer/topups/:topupId/cancel", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.cancelTopup(requireConsumerId(session), request.params.topupId ?? ""));
    } catch (error) { next(error); }
  });
  app.get("/api/consumer/chat", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.set("cache-control", "no-store").json(
        await service.chat.getConversation(requireConsumerId(session), request.query.conversationId),
      );
    } catch (error) {
      next(error);
    }
  });
  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => {
      const token = bearerToken(request.header("authorization"));
      return token ? createHash("sha256").update(token).digest("hex") : ipKeyGenerator(request.ip ?? "unknown");
    },
    handler: (_request, response) => {
      response.status(429).json({ error: {
        code: "CHAT_RATE_LIMITED",
        message: "Too many chat messages. Please try again in a minute.",
        retryable: true,
      } });
    },
  });
  app.post("/api/consumer/chat", chatLimiter, async (request, response, next) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      const streaming = request.accepts("application/x-ndjson") && request.header("accept") === "application/x-ndjson";
      if (streaming) {
        response.set({ "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" });
        response.flushHeaders();
        heartbeat = setInterval(() => { if (!response.destroyed) response.write('{"type":"heartbeat"}\n'); }, 15_000);
      }
      const reply = await service.chat.reply(requireConsumerId(session), {
        conversationId: request.body?.conversationId,
        message: request.body?.message,
        requestId: request.body?.requestId,
        purchaseId: request.body?.purchaseId,
        actionId: request.body?.actionId,
        quoteHash: request.body?.quoteHash,
      }, (message) => { if (streaming && !response.destroyed) response.write(`${JSON.stringify({ type: "progress", message })}\n`); });
      if (streaming) response.end(`${JSON.stringify({ type: "result", reply })}\n`);
      else response.set("cache-control", "no-store").json(reply);
    } catch (error) {
      if (response.headersSent) response.end(`${JSON.stringify({ type: "error", error: { code: error instanceof DomainError ? error.code : "CHAT_UNAVAILABLE", message: error instanceof DomainError ? error.message : "Chat could not finish. Retry the same message to recover your result." } })}\n`);
      else next(error);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  });
  app.get("/api/consumer/orders", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.set("cache-control", "no-store").json({ orders: await service.delivery.orders(requireConsumerId(session)) });
    } catch (error) { next(error); }
  });
  app.get("/api/consumer/orders/:orderId/download", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      const file = await service.delivery.download(requireConsumerId(session), request.params.orderId ?? "");
      response.set({ "cache-control": "private, no-store", "content-type": "application/octet-stream", "x-content-type-options": "nosniff",
        "content-disposition": `attachment; filename="${file.file_name}"` }).send(file.contents);
    } catch (error) { next(error); }
  });
  app.post("/api/consumer/orders/:orderId/details", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.delivery.submitDetails(requireConsumerId(session), request.params.orderId ?? "", request.body?.details));
    } catch (error) { next(error); }
  });
  app.post("/api/merchant/offers/:offerId/delivery", express.raw({ type: "application/octet-stream", limit: "5mb" }), async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.delivery.upload(requireMerchantId(session), { offerId: request.params.offerId ?? "" }, request.query.fileName, request.body));
    } catch (error) { next(error); }
  });
  app.post("/api/merchant/orders/:orderId/delivery", express.raw({ type: "application/octet-stream", limit: "5mb" }), async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.delivery.upload(requireMerchantId(session), { orderId: request.params.orderId ?? "" }, request.query.fileName, request.body));
    } catch (error) { next(error); }
  });
  app.post("/api/merchant/offers/:offerId/intake", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.delivery.setIntakePrompt(requireMerchantId(session), request.params.offerId ?? "", request.body?.prompt));
    } catch (error) { next(error); }
  });
  app.post("/api/consumer/checkout/quote", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      await requireWebSession(request, identity, "consumer");
      const merchantId = checkoutIdentifier(request.body?.merchantId, "merchantId");
      const offerId = checkoutIdentifier(request.body?.offerId, "offerId");
      const quantity = request.body?.quantity ?? 1;
      const offer = await service.getOffer(merchantId, offerId);
      const signedQuote = await service.createQuote(merchantId, offerId, quantity);
      response.set("cache-control", "no-store").json({ signedQuote, offer: {
        ...offer,
        description: signedQuote.payload.items[0]?.description ?? offer.description,
        priceMinor: signedQuote.payload.items[0]?.unitPriceMinor ?? offer.priceMinor,
        fulfillmentMethod: signedQuote.payload.fulfillmentMethod,
        ...(signedQuote.payload.schemaVersion === "2026-07-19" ? {
          refundable: signedQuote.payload.refundPolicy.refundable,
          refundWindowMinutes: signedQuote.payload.refundPolicy.refundWindowMinutes,
        } : {}),
      } });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/consumer/checkout/confirm", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      const signedQuote = checkoutQuote(request.body?.signedQuote);
      const idempotencyKey = checkoutIdempotencyKey(request.body?.idempotencyKey);
      const consumerId = requireConsumerId(session);
      const completed = await service.completedCheckout(consumerId, idempotencyKey, signedQuote);
      if (completed) {
        response.set("cache-control", "no-store").json({ status: "confirmed", order: completed });
        return;
      }
      let prepared;
      try {
        prepared = await service.preparePayment({
          consumerId,
          agentClientId: "payl_in_app",
          signedQuote,
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof DomainError && error.code === "PAYMENT_NOT_PREPARABLE") {
          const order = await service.completedCheckout(consumerId, idempotencyKey, signedQuote);
          if (order) {
            response.set("cache-control", "no-store").json({ status: "confirmed", order });
            return;
          }
        }
        throw error;
      }
      if (prepared.status === "pending_approval") {
        response.set("cache-control", "no-store").json({
          status: "pending_approval", paymentId: prepared.paymentId, approvalUrl: prepared.approvalUrl,
        });
        return;
      }
      const order = await service.commitOrder({
        merchantId: signedQuote.payload.merchantId,
        signedQuote,
        mandate: prepared.mandate,
        idempotencyKey: checkoutCommitKey(idempotencyKey),
      });
      response.set("cache-control", "no-store").json({ status: "confirmed", order });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/consumer/checkout/complete", async (request, response, next) => {
    try {
      assertConsumerWriteOrigin(request, config);
      const session = await requireWebSession(request, identity, "consumer");
      const consumerId = requireConsumerId(session);
      const paymentId = checkoutIdentifier(request.body?.paymentId, "paymentId");
      const signedQuote = checkoutQuote(request.body?.signedQuote);
      const idempotencyKey = checkoutIdempotencyKey(request.body?.idempotencyKey);
      const completed = await service.completedCheckout(consumerId, idempotencyKey, signedQuote);
      if (completed) {
        if (completed.paymentId !== paymentId) {
          throw new DomainError("PAYMENT_QUOTE_MISMATCH", "Payment does not belong to this quote", 409);
        }
        response.set("cache-control", "no-store").json({ status: "confirmed", order: completed });
        return;
      }
      const payment = await service.paymentStatus(paymentId, consumerId);
      if (payment.quoteId !== signedQuote.payload.quoteId) {
        throw new DomainError("PAYMENT_QUOTE_MISMATCH", "Payment does not belong to this quote", 409);
      }
      if (payment.status === "pending_approval") {
        response.set("cache-control", "no-store").json({ status: "pending_approval", paymentId });
        return;
      }
      if (payment.status !== "reserved" && payment.status !== "captured") {
        throw new DomainError("PAYMENT_NOT_READY", `Payment is ${payment.status}`, 409);
      }
      const mandate = payment.mandate;
      if (!mandate || typeof mandate !== "object" || !("payload" in mandate)) {
        throw new DomainError("MANDATE_NOT_FOUND", "Payment mandate was not found", 404);
      }
      const parsedMandate = checkoutMandate(mandate);
      if (parsedMandate.payload.consumerRef !== consumerId || parsedMandate.payload.quoteHash !== signedQuote.hash) {
        throw new DomainError("PAYMENT_QUOTE_MISMATCH", "Payment does not belong to this quote", 409);
      }
      const order = await service.commitOrder({
        merchantId: signedQuote.payload.merchantId,
        signedQuote,
        mandate: parsedMandate,
        idempotencyKey: checkoutCommitKey(idempotencyKey),
      });
      response.set("cache-control", "no-store").json({ status: "confirmed", order });
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
  app.post("/api/payments/:paymentId/cancel", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.cancelPayment({
        consumerId: requireConsumerId(session),
        paymentId: request.params.paymentId ?? "",
        idempotencyKey: request.body?.idempotencyKey,
        reason: request.body?.reason,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/orders/:orderId/cancel", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "consumer");
      response.json(await service.cancelOrder({
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
  app.post("/api/merchant/orders/:orderId/fulfill", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.fulfillOrder({
        merchantId: requireMerchantId(session),
        orderId: request.params.orderId ?? "",
        fulfillmentReference: request.body?.fulfillmentReference,
        idempotencyKey: request.body?.idempotencyKey,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/merchant/payouts", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.status(202).json(await service.createPayout({
        merchantId: requireMerchantId(session),
        idempotencyKey: request.body?.idempotencyKey,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/merchant/payouts/:payoutId", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.payoutStatus(requireMerchantId(session), request.params.payoutId ?? ""));
    } catch (error) { next(error); }
  });
  app.put("/api/merchant/payout-account", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.setPayoutEmail(requireMerchantId(session), request.body?.email));
    } catch (error) { next(error); }
  });
  app.get("/api/merchant/reconciliation", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.reconciliationReport(requireMerchantId(session)));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/merchant/reconciliation", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.status(201).json(await service.reconciliationReport(requireMerchantId(session), true));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/merchant/metrics", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.pilotMetrics(requireMerchantId(session)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/merchant/audit", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      const limit = Number(request.query.limit ?? 250);
      response.json({ events: await service.merchantAuditExport(requireMerchantId(session), limit) });
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/merchant/webhook", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      response.json(await service.configureMerchantWebhook({ merchantId: requireMerchantId(session), url: request.body?.url }));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/merchant/webhook", async (request, response, next) => {
    try {
      const session = await requireWebSession(request, identity, "merchant_admin");
      await service.disableMerchantWebhook(requireMerchantId(session));
      response.status(204).end();
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

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function checkoutIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new DomainError("INVALID_CHECKOUT_INPUT", `${label} is invalid`);
  }
  return value;
}

function assertConsumerWriteOrigin(request: Request, config: Config): void {
  if (bearerToken(request.header("authorization"))) return;
  const origin = request.header("origin");
  const allowed = [config.approvalWebUrl, config.publicBaseUrl].map((url) => new URL(url).origin);
  if (!origin || !allowed.includes(origin)) {
    throw new DomainError("INVALID_ORIGIN", "This request must come from the consumer app", 403);
  }
}

function checkoutIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 128) {
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", "Checkout idempotency key must contain 8 to 128 characters");
  }
  return value.trim();
}

function checkoutCommitKey(value: string): string {
  return `checkout:${createHash("sha256").update(value).digest("hex")}`;
}

function checkoutQuote(value: unknown): SignedQuote {
  const result = SignedQuoteSchema.safeParse(value);
  if (!result.success) throw new DomainError("INVALID_SIGNED_QUOTE", "Signed quote is invalid");
  return result.data;
}

function checkoutMandate(value: unknown) {
  const result = PaymentMandateSchema.safeParse(value);
  if (!result.success) throw new DomainError("INVALID_MANDATE", "Payment mandate is invalid");
  return result.data;
}

function hostedAuthorizeReturnTo(value: unknown, config: Config): string {
  if (typeof value !== "string") throw new DomainError("HANDOFF_RETURN_INVALID", "OAuth return URL is required", 400);
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new DomainError("HANDOFF_RETURN_INVALID", "OAuth return URL is invalid", 400);
  }
  if (target.origin !== new URL(config.publicBaseUrl).origin || target.pathname !== "/authorize") {
    throw new DomainError("HANDOFF_RETURN_INVALID", "Browser handoff may return only to Antspace authorization", 400);
  }
  return target.href;
}

async function requireWebSession(request: Request, identity: IdentityService, role?: UserRole): Promise<AuthSession> {
  const session = await identity.authenticateSessionToken(requireSessionBearer(request));
  if (role && session.role !== role) throw new DomainError("FORBIDDEN", "This account cannot access the requested workspace", 403);
  return session;
}

function requireSessionBearer(request: Request): string {
  const token = bearerToken(request.header("authorization")) ?? cookieValue(request.header("cookie"), "payl_consumer_session");
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
