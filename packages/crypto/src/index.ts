import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  timingSafeEqual,
} from "node:crypto";
import { CompactSign, compactVerify } from "jose";

export type SigningKey = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signingKeyFromSeed(seed: Uint8Array, kid: string): SigningKey {
  if (seed.byteLength !== 32) throw new Error("Ed25519 signing seeds must contain exactly 32 bytes");
  const ed25519Pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([ed25519Pkcs8Prefix, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  return { kid, privateKey, publicKey: createPublicKey(privateKey) };
}

// Deterministic keys make the local sandbox restartable. Production startup rejects this mode.
export function createDeterministicDevKey(label: string, kid: string): SigningKey {
  const seed = createHash("sha256").update(`PAYL SANDBOX KEY ONLY:${label}`).digest().subarray(0, 32);
  return signingKeyFromSeed(seed, kid);
}

// A hosted sandbox can keep signatures stable without committing private material. This is not a
// substitute for a KMS/HSM-backed signer and must never be used for live-money deployments.
export function createSecretDerivedKey(masterKey: Uint8Array, label: string, kid: string): SigningKey {
  if (masterKey.byteLength < 32) throw new Error("The signing master key must contain at least 32 bytes");
  const seed = createHmac("sha256", masterKey)
    .update(`PAYL HOSTED SANDBOX SIGNING KEY:v1:${label}`)
    .digest();
  return signingKeyFromSeed(seed, kid);
}

export async function signPayload(payload: unknown, key: SigningKey): Promise<string> {
  return new CompactSign(Buffer.from(canonicalJson(payload)))
    .setProtectedHeader({ alg: "EdDSA", kid: key.kid, typ: "payl+jws" })
    .sign(key.privateKey);
}

export async function verifyPayload<T>(jws: string, payload: T, publicKey: KeyObject): Promise<void> {
  const verified = await compactVerify(jws, publicKey, { algorithms: ["EdDSA"] });
  const signedBytes = Buffer.from(verified.payload);
  const expectedBytes = Buffer.from(canonicalJson(payload));
  if (signedBytes.length !== expectedBytes.length || !timingSafeEqual(signedBytes, expectedBytes)) {
    throw new Error("Signed payload does not match the supplied object");
  }
}
