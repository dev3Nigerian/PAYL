import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { Config } from "./config.js";
import { inTransaction } from "./db.js";
import { DomainError, requireValue } from "./errors.js";
import { postJournal } from "./ledger.js";

const scryptAsync = promisify(scrypt);
export const SANDBOX_WELCOME_CREDIT_MINOR = 10_000n;

export type UserRole = "consumer" | "merchant_admin";

export type AuthSession = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  consumerId: string | null;
  merchantId: string | null;
  expiresAt: string;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  consumer_id: string | null;
  merchant_id: string | null;
  password_salt: string;
  password_hash: string;
  mfa_secret: string | null;
  status: string;
};

function sha256(value: string): string {
  return createHmac("sha256", "PAYL opaque token hash").update(value).digest("hex");
}

async function passwordDigest(password: string, salt: string): Promise<string> {
  const digest = await scryptAsync(password, Buffer.from(salt, "base64url"), 64) as Buffer;
  return digest.toString("base64url");
}

async function createPasswordRecord(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString("base64url");
  return { salt, hash: await passwordDigest(password, salt) };
}

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new DomainError("INVALID_MFA_SECRET", "MFA secret is invalid", 500);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function newTotpSecret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...randomBytes(20)].map((byte) => byte.toString(2).padStart(8, "0")).join("");
  let secret = "";
  for (let index = 0; index < bits.length; index += 5) secret += alphabet[Number.parseInt(bits.slice(index, index + 5), 2)];
  return secret;
}

function assertTotpCode(secret: string, code: unknown): void {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new DomainError("MFA_REQUIRED", "Enter the six-digit authenticator code", 403);
  const valid = [-1, 0, 1].some((step) => timingSafeEqual(Buffer.from(totpCode(secret, Date.now() + step * 30_000)), Buffer.from(code)));
  if (!valid) throw new DomainError("MFA_INVALID", "Authenticator code is invalid or expired", 403);
}

export function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24 |
    (digest[offset + 1] ?? 0) << 16 |
    (digest[offset + 2] ?? 0) << 8 |
    (digest[offset + 3] ?? 0);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

export class IdentityService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
  ) {}

  async seedSandboxUsers(): Promise<void> {
    const consumerPassword = await createPasswordRecord(this.config.sandboxConsumerPassword);
    const merchantPassword = await createPasswordRecord(this.config.sandboxMerchantPassword);
    await this.pool.query(
      `INSERT INTO auth_users(
         id, email, display_name, role, consumer_id, password_salt, password_hash, mfa_secret
       ) VALUES ($1, $2, 'Demo Consumer', 'consumer', $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING`,
      [
        `user_${this.config.sandboxConsumerId}`,
        this.config.sandboxConsumerEmail,
        this.config.sandboxConsumerId,
        consumerPassword.salt,
        consumerPassword.hash,
        this.config.sandboxConsumerTotpSecret,
      ],
    );
    await this.pool.query(
      `INSERT INTO auth_users(
         id, email, display_name, role, merchant_id, password_salt, password_hash
       ) VALUES ($1, $2, 'Atlas Merchant Admin', 'merchant_admin', $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [
        `user_${this.config.sandboxMerchantId}`,
        this.config.sandboxMerchantEmail,
        this.config.sandboxMerchantId,
        merchantPassword.salt,
        merchantPassword.hash,
      ],
    );
  }

  async registerConsumer(input: { displayName: unknown; email: unknown; password: unknown }): Promise<{
    session: AuthSession;
    token: string;
    welcomeCredit: { amountMinor: string; currency: string; sandbox: true };
  }> {
    const displayName = validatedName(input.displayName, "Name");
    const { email, password: rawPassword } = validatedCredentials(input.email, input.password);
    const password = await createPasswordRecord(rawPassword);
    const consumerId = `consumer_${randomUUID().replaceAll("-", "")}`;
    const userId = `user_${randomUUID().replaceAll("-", "")}`;
    try {
      return await inTransaction(this.pool, async (client) => {
        await client.query("INSERT INTO consumers(id, display_name, status) VALUES ($1, $2, 'active')", [consumerId, displayName]);
        // The unique, normalized email is the account boundary. A duplicate rolls
        // back the consumer, wallet, grant, and session together.
        const user = requireValue((await client.query<UserRow>(
          `INSERT INTO auth_users(id, email, display_name, role, consumer_id, password_salt, password_hash)
           VALUES ($1, $2, $3, 'consumer', $4, $5, $6) RETURNING *`,
          [userId, email, displayName, consumerId, password.salt, password.hash],
        )).rows[0], "REGISTRATION_FAILED", "Account could not be created");
        for (const type of ["available", "reserved"]) {
          await client.query(
            "INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency) VALUES ($1, 'consumer', $2, $3, 'USD')",
            [`acct_${consumerId}_${type}`, consumerId, type],
          );
        }
        // Also support registration when demo-account bootstrapping is disabled.
        for (const [id, type] of [["acct_platform_clearing", "clearing"], ["acct_platform_fee", "fee_revenue"], ["acct_platform_provider_fee_expense", "provider_fee_expense"]]) {
          await client.query(
            "INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency) VALUES ($1, 'platform', 'payl', $2, 'USD') ON CONFLICT (id) DO NOTHING",
            [id, type],
          );
        }
        await client.query(
          `INSERT INTO spending_policies(consumer_id, version, auto_approve_limit_minor, per_transaction_limit_minor, daily_limit_minor, currency)
           VALUES ($1, 1, 5000, 50000, 100000, 'USD')`, [consumerId],
        );
        await postJournal(client, {
          eventType: "sandbox_signup_credit",
          idempotencyKey: `sandbox-signup:${consumerId}`,
          referenceType: "consumer", referenceId: consumerId,
          lines: [
            { accountId: `acct_${consumerId}_available`, amountMinor: SANDBOX_WELCOME_CREDIT_MINOR },
            { accountId: "acct_platform_clearing", amountMinor: -SANDBOX_WELCOME_CREDIT_MINOR },
          ],
        });
        await client.query(
          `INSERT INTO audit_events(correlation_id, actor_type, actor_id, event_type, object_type, object_id, metadata)
           VALUES ($1, 'consumer', $1, 'consumer.registered', 'consumer', $1, $2::jsonb)`,
          [consumerId, JSON.stringify({ welcomeCreditMinor: SANDBOX_WELCOME_CREDIT_MINOR.toString(), currency: "USD", sandbox: true })],
        );
        return { ...await this.createSession(user, client), welcomeCredit: { amountMinor: SANDBOX_WELCOME_CREDIT_MINOR.toString(), currency: "USD", sandbox: true as const } };
      });
    } catch (error) {
      if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "auth_users_email_key") {
        throw new DomainError("EMAIL_ALREADY_REGISTERED", "An Antspace account already uses this email. Sign in to continue.", 409);
      }
      throw error;
    }
  }

  async mfaStatus(userId: string): Promise<{ configured: boolean }> {
    const user = requireValue((await this.pool.query<{ mfa_secret: string | null }>("SELECT mfa_secret FROM auth_users WHERE id = $1 AND role = 'consumer'", [userId])).rows[0], "USER_NOT_FOUND", "Consumer was not found");
    return { configured: !!user.mfa_secret };
  }

  async startMfaEnrollment(userId: string): Promise<{ secret: string; account: string; issuer: string }> {
    const user = (await this.pool.query<{ mfa_pending_secret: string; email: string }>(
      `UPDATE auth_users SET mfa_pending_secret = COALESCE(mfa_pending_secret, $2)
       WHERE id = $1 AND role = 'consumer' AND mfa_secret IS NULL RETURNING mfa_pending_secret, email`,
      [userId, newTotpSecret()],
    )).rows[0];
    if (!user) throw new DomainError("MFA_ALREADY_CONFIGURED", "Your authenticator is already set up", 409);
    return { secret: user.mfa_pending_secret, account: user.email, issuer: "Antspace Sandbox" };
  }

  async confirmMfaEnrollment(userId: string, code: unknown): Promise<{ configured: true }> {
    return inTransaction(this.pool, async (client) => {
      const user = requireValue((await client.query<{ mfa_pending_secret: string | null; mfa_secret: string | null }>(
        "SELECT mfa_pending_secret, mfa_secret FROM auth_users WHERE id = $1 AND role = 'consumer' FOR UPDATE", [userId],
      )).rows[0], "USER_NOT_FOUND", "Consumer was not found");
      if (user.mfa_secret) return { configured: true };
      const secret = requireValue(user.mfa_pending_secret, "MFA_NOT_STARTED", "Start authenticator setup first");
      assertTotpCode(secret, code);
      await client.query("UPDATE auth_users SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL WHERE id = $1", [userId]);
      return { configured: true };
    });
  }

  async registerMerchant(input: {
    businessName: unknown;
    adminName: unknown;
    email: unknown;
    password: unknown;
  }): Promise<{
    session: AuthSession;
    token: string;
    merchant: { merchantId: string; name: string; currency: string; serverId: string; mcpUrl: string };
  }> {
    const businessName = validatedName(input.businessName, "Business name");
    const adminName = validatedName(input.adminName, "Administrator name");
    if (typeof input.email !== "string") throw new DomainError("INVALID_EMAIL", "Enter a valid email address");
    const email = input.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DomainError("INVALID_EMAIL", "Enter a valid email address");
    }
    if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) {
      throw new DomainError("INVALID_PASSWORD", "Password must contain 12 to 128 characters");
    }

    const suffix = randomUUID().replaceAll("-", "");
    const merchantId = `merchant_${suffix}`;
    const userId = `user_${randomUUID().replaceAll("-", "")}`;
    const serverId = `merchant_server_${suffix}`;
    const currency = "USD";
    const password = await createPasswordRecord(input.password);
    try {
      await inTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO merchants(id, name, server_id, currency, signing_key_id, status)
           VALUES ($1, $2, $3, $4, $5, 'active')`,
          [merchantId, businessName, serverId, currency, `${merchantId}-sandbox-2026-01`],
        );
        for (const accountType of ["pending_payable", "payable", "reserve", "payout_pending"] as const) {
          await client.query(
            `INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
             VALUES ($1, 'merchant', $2, $3, $4)`,
            [`acct_${merchantId}_${accountType}`, merchantId, accountType, currency],
          );
        }
        await client.query(
          "INSERT INTO merchant_settlement_configs(merchant_id) VALUES ($1)",
          [merchantId],
        );
        await client.query(
          `INSERT INTO auth_users(
             id, email, display_name, role, merchant_id, password_salt, password_hash
           ) VALUES ($1, $2, $3, 'merchant_admin', $4, $5, $6)`,
          [userId, email, adminName, merchantId, password.salt, password.hash],
        );
        await client.query(
          `INSERT INTO audit_events(
             correlation_id, actor_type, actor_id, event_type, object_type, object_id, metadata
           ) VALUES ($1, 'merchant', $1, 'merchant.registered', 'merchant', $1, $2::jsonb)`,
          [merchantId, JSON.stringify({ businessName, adminName, email, currency, serverId })],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("EMAIL_ALREADY_REGISTERED", "A merchant account already uses this email", 409);
      }
      throw error;
    }

    const login = await this.login(email, input.password, "merchant_admin");
    return {
      ...login,
      merchant: {
        merchantId,
        name: businessName,
        currency,
        serverId,
        mcpUrl: new URL(`/mcp/merchants/${merchantId}`, this.config.publicBaseUrl).href,
      },
    };
  }

  async login(email: unknown, password: unknown, expectedRole?: UserRole): Promise<{ session: AuthSession; token: string }> {
    if (typeof email !== "string" || typeof password !== "string") {
      throw new DomainError("INVALID_CREDENTIALS", "Email and password are required", 401);
    }
    const user = (await this.pool.query<UserRow>(
      "SELECT * FROM auth_users WHERE email = lower($1)",
      [email.trim()],
    )).rows[0];
    if (!user || user.status !== "active" || (expectedRole && user.role !== expectedRole)) {
      throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
    }
    const candidate = await passwordDigest(password, user.password_salt);
    const candidateBytes = Buffer.from(candidate);
    const expectedBytes = Buffer.from(user.password_hash);
    if (candidateBytes.length !== expectedBytes.length || !timingSafeEqual(candidateBytes, expectedBytes)) {
      throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
    }

    return this.createSession(user);
  }

  async createBrowserHandoff(session: AuthSession): Promise<string> {
    if (session.role !== "consumer") throw new DomainError("FORBIDDEN", "Consumer access is required", 403);
    const code = randomBytes(32).toString("base64url");
    await this.pool.query(
      `DELETE FROM auth_browser_handoffs
       WHERE expires_at < now() OR consumed_at < now() - interval '1 day'`,
    );
    await this.pool.query(
      `INSERT INTO auth_browser_handoffs(code_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '2 minutes')`,
      [sha256(code), session.userId],
    );
    const url = new URL("/api/auth/handoff", this.config.publicBaseUrl);
    url.searchParams.set("code", code);
    return url.href;
  }

  async consumeBrowserHandoff(code: unknown): Promise<{ session: AuthSession; token: string }> {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{40,80}$/.test(code)) {
      throw new DomainError("HANDOFF_INVALID", "Browser sign-in handoff is invalid or expired", 401);
    }
    const handoff = (await this.pool.query<{ user_id: string }>(
      `UPDATE auth_browser_handoffs SET consumed_at = now()
       WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sha256(code)],
    )).rows[0];
    if (!handoff) throw new DomainError("HANDOFF_INVALID", "Browser sign-in handoff is invalid or expired", 401);
    const user = (await this.pool.query<UserRow>(
      "SELECT * FROM auth_users WHERE id = $1 AND status = 'active'",
      [handoff.user_id],
    )).rows[0];
    if (!user) throw new DomainError("UNAUTHENTICATED", "Sign in to continue", 401);
    return this.createSession(user);
  }

  async authenticateSessionToken(token: string): Promise<AuthSession> {
    const row = (await this.pool.query<UserRow & { session_id: string; expires_at: Date }>(
        `UPDATE auth_sessions s SET last_seen_at = now()
         FROM auth_users u
         WHERE s.token_hash = $1 AND s.user_id = u.id
           AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'
         RETURNING u.*, s.id AS session_id, s.expires_at`,
        [sha256(token)],
      )).rows[0];
    if (!row) throw new DomainError("UNAUTHENTICATED", "Sign in to continue", 401);
    return this.sessionFromUser(row, row.session_id, row.expires_at);
  }

  async revokeSession(token: string): Promise<void> {
    await this.pool.query("UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1", [sha256(token)]);
  }

  async verifyApprovalMfa(userId: string, code: unknown): Promise<void> {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new DomainError("MFA_REQUIRED", "Enter the six-digit authenticator code", 403);
    }
    const secret = requireValue(
      (await this.pool.query<{ mfa_secret: string | null }>("SELECT mfa_secret FROM auth_users WHERE id = $1", [userId])).rows[0]?.mfa_secret,
      "MFA_NOT_CONFIGURED",
      "Authenticator MFA is not configured",
    );
    assertTotpCode(secret, code);
  }

  private async createSession(user: UserRow, queryable: pg.Pool | pg.PoolClient = this.pool): Promise<{ session: AuthSession; token: string }> {
    const token = randomBytes(32).toString("base64url");
    const sessionId = `session_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60_000);
    await queryable.query(
      `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, user.id, sha256(token), expiresAt],
    );
    return { session: this.sessionFromUser(user, sessionId, expiresAt), token };
  }

  async listGrants(userId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<{
      client_id: string;
      metadata: { client_name?: string };
      resource: string;
      scopes: string[];
      granted_at: Date;
    }>(
      `SELECT g.client_id, c.metadata, g.resource, g.scopes, g.granted_at
       FROM oauth_grants g JOIN oauth_clients c ON c.client_id = g.client_id
       WHERE g.user_id = $1 AND g.revoked_at IS NULL AND c.revoked_at IS NULL
       ORDER BY g.granted_at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      clientId: row.client_id,
      clientName: row.metadata.client_name ?? "MCP client",
      resource: row.resource,
      scopes: row.scopes,
      connectedAt: row.granted_at.toISOString(),
    }));
  }

  async revokeGrant(userId: string, clientId: string, resource: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE oauth_grants SET revoked_at = now(), updated_at = now()
       WHERE user_id = $1 AND client_id = $2 AND resource = $3 AND revoked_at IS NULL`,
      [userId, clientId, resource],
    );
    if (!result.rowCount) throw new DomainError("GRANT_NOT_FOUND", "Connected client was not found", 404);
    await this.pool.query(
      `UPDATE oauth_refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND client_id = $2 AND resource = $3 AND revoked_at IS NULL`,
      [userId, clientId, resource],
    );
  }

  private sessionFromUser(user: UserRow, sessionId: string, expiresAt: Date): AuthSession {
    return {
      sessionId,
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      consumerId: user.consumer_id,
      merchantId: user.merchant_id,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

function validatedCredentials(emailInput: unknown, password: unknown): { email: string; password: string } {
  if (typeof emailInput !== "string") throw new DomainError("INVALID_EMAIL", "Enter a valid email address");
  const email = emailInput.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("INVALID_EMAIL", "Enter a valid email address");
  if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new DomainError("INVALID_PASSWORD", "Password must contain 12 to 128 characters");
  return { email, password };
}

function validatedName(value: unknown, label: string): string {
  if (typeof value !== "string") throw new DomainError("INVALID_NAME", `${label} is required`);
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) {
    throw new DomainError("INVALID_NAME", `${label} must contain 2 to 120 characters`);
  }
  return name;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}
