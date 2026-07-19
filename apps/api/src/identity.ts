import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { Config } from "./config.js";
import { DomainError, requireValue } from "./errors.js";

const scryptAsync = promisify(scrypt);

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

    const token = randomBytes(32).toString("base64url");
    const sessionId = `session_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60_000);
    await this.pool.query(
      `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, user.id, sha256(token), expiresAt],
    );
    return { session: this.sessionFromUser(user, sessionId, expiresAt), token };
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
    const valid = [-1, 0, 1].some((step) => {
      const expected = Buffer.from(totpCode(secret, Date.now() + step * 30_000));
      const supplied = Buffer.from(code);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    });
    if (!valid) throw new DomainError("MFA_INVALID", "Authenticator code is invalid or expired", 403);
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
