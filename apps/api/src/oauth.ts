import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type pg from "pg";
import { SignJWT, jwtVerify } from "jose";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createDeterministicDevKey, sha256Hex } from "@payl/crypto";
import type { Config } from "./config.js";
import type { AuthSession } from "./identity.js";
import { DomainError, requireValue } from "./errors.js";

export const MCP_SCOPES = [
  "wallet:read",
  "wallet:pay",
  "commerce:read",
  "commerce:quote",
  "commerce:order",
] as const;

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_MILLISECONDS = 30 * 24 * 60 * 60_000;

type CodeRow = {
  user_id: string;
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  resource: string;
  expires_at: Date;
  consumed_at: Date | null;
};

type RefreshRow = {
  user_id: string;
  client_id: string;
  resource: string;
  scopes: string[];
  expires_at: Date;
  revoked_at: Date | null;
};

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function publicRedirectAllowed(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" ||
      ((url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") && url.protocol === "http:");
  } catch {
    return false;
  }
}

export class PaylOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly signingKey = createDeterministicDevKey("payl-oauth-access", "payl-oauth-sandbox-2026-01");
  private readonly issuer: string;
  private readonly resource: string;

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
  ) {
    this.issuer = new URL(config.publicBaseUrl).href;
    this.resource = new URL("/mcp", config.publicBaseUrl).href;
    this.clientsStore = {
      getClient: async (clientId) => {
        const row = (await this.pool.query<{ metadata: OAuthClientInformationFull }>(
          "SELECT metadata FROM oauth_clients WHERE client_id = $1 AND revoked_at IS NULL",
          [clientId],
        )).rows[0];
        return row?.metadata;
      },
      registerClient: async (client) => {
        const generated = client as OAuthClientInformationFull;
        if (!generated.client_id) throw new InvalidRequestError("Generated client_id is required");
        if (!client.redirect_uris.every(publicRedirectAllowed)) {
          throw new InvalidRequestError("Redirect URIs must use HTTPS or an HTTP loopback address");
        }
        const normalized: OAuthClientInformationFull = {
          ...generated,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        } as OAuthClientInformationFull;
        await this.pool.query(
          `INSERT INTO oauth_clients(client_id, metadata) VALUES ($1, $2::jsonb)
           ON CONFLICT (client_id) DO UPDATE SET metadata = excluded.metadata, revoked_at = NULL`,
          [normalized.client_id, JSON.stringify(normalized)],
        );
        return normalized;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, response: Response): Promise<void> {
    const session = response.locals.paylSession as AuthSession | undefined;
    if (!session) {
      const authorizeUrl = new URL("/authorize", this.config.publicBaseUrl);
      authorizeUrl.searchParams.set("client_id", client.client_id);
      authorizeUrl.searchParams.set("redirect_uri", params.redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("code_challenge", params.codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("scope", (params.scopes?.length ? params.scopes : [...MCP_SCOPES]).join(" "));
      authorizeUrl.searchParams.set("resource", params.resource?.href ?? this.resource);
      if (params.state) authorizeUrl.searchParams.set("state", params.state);
      const loginUrl = new URL("/login", this.config.approvalWebUrl);
      loginUrl.searchParams.set("returnTo", authorizeUrl.href);
      response.redirect(302, loginUrl.href);
      return;
    }
    if (session.role !== "consumer" || !session.consumerId) {
      throw new AccessDeniedError("A consumer account is required to authorize an AI payment client");
    }
    const resource = params.resource?.href ?? this.resource;
    if (resource !== this.resource) throw new InvalidTargetError("The requested MCP resource is not supported");
    const scopes = params.scopes?.length ? [...new Set(params.scopes)] : [...MCP_SCOPES];
    if (scopes.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) {
      throw new InvalidScopeError("One or more requested scopes are not supported");
    }

    const requestId = `consent_${randomUUID()}`;
    await this.pool.query(
      `INSERT INTO oauth_consent_requests(
         id, user_id, client_id, redirect_uri, scopes, code_challenge, resource, state, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '10 minutes')`,
      [requestId, session.userId, client.client_id, params.redirectUri, scopes, params.codeChallenge, resource, params.state ?? null],
    );
    const clientName = client.client_name ?? "MCP client";
    const scopeItems = scopes.map((scope) => `<li><code>${html(scope)}</code></li>`).join("");
    response.status(200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ${html(clientName)} · PAYL</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f2f3ee;color:#111914;font-family:Inter,system-ui,sans-serif}.card{width:min(100%,560px);padding:32px;border:1px solid #dce1d7;border-radius:24px;background:white;box-shadow:0 24px 70px rgba(30,52,38,.13)}.brand{color:#0b6b42;font-size:22px;font-weight:900}.eyebrow{margin:32px 0 7px;color:#0b6b42;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}h1{margin:0;font-size:34px;letter-spacing:-.04em}p{color:#627068;line-height:1.6}ul{padding:14px 14px 14px 34px;border-radius:14px;background:#f3f6ef;line-height:1.8}code{font-size:12px}.actions{display:grid;grid-template-columns:1fr 1.5fr;gap:12px;margin-top:24px}button{border:0;border-radius:13px;padding:15px;font:inherit;font-weight:800;cursor:pointer}.deny{background:#e9ece5}.allow{background:#c8f36b}</style></head>
<body><main class="card"><div class="brand">PAYL</div><p class="eyebrow">AI client authorization</p><h1>Connect ${html(clientName)}?</h1><p>Signed in as ${html(session.email)}. This client is requesting the following permissions:</p><ul>${scopeItems}</ul><form class="actions" method="post" action="/oauth/consent"><input type="hidden" name="request_id" value="${html(requestId)}"><button class="deny" name="decision" value="deny">Deny</button><button class="allow" name="decision" value="allow">Allow connection</button></form></main></body></html>`);
  }

  async decideConsent(session: AuthSession, request: Request, response: Response): Promise<void> {
    const requestId = typeof request.body?.request_id === "string" ? request.body.request_id : "";
    const decision = request.body?.decision;
    const row = requireValue(
      (await this.pool.query<{
        user_id: string;
        client_id: string;
        redirect_uri: string;
        scopes: string[];
        code_challenge: string;
        resource: string;
        state: string | null;
      }>(
        `UPDATE oauth_consent_requests SET decided_at = now()
         WHERE id = $1 AND user_id = $2 AND decided_at IS NULL AND expires_at > now()
         RETURNING user_id, client_id, redirect_uri, scopes, code_challenge, resource, state`,
        [requestId, session.userId],
      )).rows[0],
      "CONSENT_EXPIRED",
      "Authorization request is invalid or expired",
    );
    const redirect = new URL(row.redirect_uri);
    if (decision !== "allow") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "The consumer denied this connection");
      if (row.state) redirect.searchParams.set("state", row.state);
      response.redirect(302, redirect.href);
      return;
    }

    const code = randomBytes(32).toString("base64url");
    await this.pool.query(
      `INSERT INTO oauth_authorization_codes(
         code_hash, user_id, client_id, redirect_uri, scopes, code_challenge, resource, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '5 minutes')`,
      [sha256Hex(code), row.user_id, row.client_id, row.redirect_uri, row.scopes, row.code_challenge, row.resource],
    );
    await this.pool.query(
      `INSERT INTO oauth_grants(user_id, client_id, resource, scopes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, client_id, resource) DO UPDATE
       SET scopes = excluded.scopes, revoked_at = NULL, updated_at = now()`,
      [row.user_id, row.client_id, row.resource, row.scopes],
    );
    redirect.searchParams.set("code", code);
    if (row.state) redirect.searchParams.set("state", row.state);
    response.redirect(302, redirect.href);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = (await this.pool.query<{ code_challenge: string }>(
      `SELECT code_challenge FROM oauth_authorization_codes
       WHERE code_hash = $1 AND client_id = $2 AND consumed_at IS NULL AND expires_at > now()`,
      [sha256Hex(authorizationCode), client.client_id],
    )).rows[0];
    if (!row) throw new InvalidGrantError("Authorization code is invalid or expired");
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const code = (await this.pool.query<CodeRow>(
      `UPDATE oauth_authorization_codes SET consumed_at = now()
       WHERE code_hash = $1 AND client_id = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING *`,
      [sha256Hex(authorizationCode), client.client_id],
    )).rows[0];
    if (!code || (redirectUri && redirectUri !== code.redirect_uri) || (resource && resource.href !== code.resource)) {
      throw new InvalidGrantError("Authorization code is invalid or does not match the request");
    }
    return this.issueTokens(code.user_id, code.client_id, code.resource, code.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const refresh = (await this.pool.query<RefreshRow>(
      `UPDATE oauth_refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL AND expires_at > now()
       RETURNING *`,
      [sha256Hex(refreshToken), client.client_id],
    )).rows[0];
    if (!refresh || (resource && resource.href !== refresh.resource)) throw new InvalidGrantError("Refresh token is invalid or expired");
    const requested = scopes?.length ? scopes : refresh.scopes;
    if (requested.some((scope) => !refresh.scopes.includes(scope))) throw new InvalidScopeError("Refresh scope exceeds the original grant");
    return this.issueTokens(refresh.user_id, refresh.client_id, refresh.resource, requested);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const verified = await jwtVerify(token, this.signingKey.publicKey, { issuer: this.issuer, audience: this.resource });
      const payload = verified.payload;
      const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
      const userId = payload.sub ?? "";
      const consumerId = typeof payload.consumer_id === "string" ? payload.consumer_id : "";
      const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
      const jti = payload.jti ?? "";
      if (!clientId || !userId || !consumerId || !jti) throw new InvalidTokenError("Access token claims are incomplete");
      const [grant, revoked] = await Promise.all([
        this.pool.query(
          `SELECT 1 FROM oauth_grants
           WHERE user_id = $1 AND client_id = $2 AND resource = $3 AND revoked_at IS NULL
             AND scopes @> $4::text[]`,
          [userId, clientId, this.resource, scopes],
        ),
        this.pool.query("SELECT 1 FROM oauth_revoked_access_tokens WHERE jti = $1", [jti]),
      ]);
      if (!grant.rowCount || revoked.rowCount) throw new InvalidTokenError("Access token grant has been revoked");
      return {
        token,
        clientId,
        scopes,
        expiresAt: payload.exp,
        resource: new URL(this.resource),
        extra: { userId, consumerId },
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      throw new InvalidTokenError("Access token is invalid or expired");
    }
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const refreshed = await this.pool.query(
      `UPDATE oauth_refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL`,
      [sha256Hex(request.token), client.client_id],
    );
    if (refreshed.rowCount) return;
    try {
      const verified = await jwtVerify(request.token, this.signingKey.publicKey, { issuer: this.issuer, audience: this.resource });
      if (verified.payload.client_id !== client.client_id || !verified.payload.jti || !verified.payload.exp) return;
      await this.pool.query(
        `INSERT INTO oauth_revoked_access_tokens(jti, expires_at)
         VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING`,
        [verified.payload.jti, verified.payload.exp],
      );
    } catch {
      // RFC 7009 treats an unknown or already-revoked token as a successful no-op.
    }
  }

  private async issueTokens(userId: string, clientId: string, resource: string, scopes: string[]): Promise<OAuthTokens> {
    if (resource !== this.resource) throw new InvalidTargetError("The requested resource is not supported");
    const user = requireValue(
      (await this.pool.query<{ consumer_id: string | null; status: string }>(
        "SELECT consumer_id, status FROM auth_users WHERE id = $1",
        [userId],
      )).rows[0],
      "USER_NOT_FOUND",
      "User was not found",
    );
    if (!user.consumer_id || user.status !== "active") throw new AccessDeniedError("Consumer account is not active");
    const jti = `access_${randomUUID()}`;
    const accessToken = await new SignJWT({
      scope: scopes.join(" "),
      client_id: clientId,
      consumer_id: user.consumer_id,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: this.signingKey.kid, typ: "JWT" })
      .setIssuer(this.issuer)
      .setSubject(userId)
      .setAudience(resource)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(this.signingKey.privateKey);
    const refreshToken = randomBytes(48).toString("base64url");
    await this.pool.query(
      `INSERT INTO oauth_refresh_tokens(token_hash, user_id, client_id, resource, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sha256Hex(refreshToken), userId, clientId, resource, scopes, new Date(Date.now() + REFRESH_TOKEN_MILLISECONDS)],
    );
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }
}

export function toolScopeForRequest(request: Request, surface: "wallet" | "merchant"): string {
  const tool = request.body?.method === "tools/call" ? request.body?.params?.name : undefined;
  if (surface === "wallet") {
    if (tool === "payment.prepare") return "wallet:pay";
    return "wallet:read";
  }
  if (tool === "commerce.create_quote") return "commerce:quote";
  if (tool === "commerce.commit_order") return "commerce:order";
  return "commerce:read";
}

export function requireToolScope(request: Request, required: string): void {
  if (!request.auth?.scopes.includes(required)) {
    throw new DomainError("INSUFFICIENT_SCOPE", `MCP token requires ${required}`, 403);
  }
}
