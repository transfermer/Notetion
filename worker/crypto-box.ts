/**
 * Authenticated encryption for secrets stored in D1 (backup credentials).
 *
 *  - AES-256-GCM, random 96-bit IV per message.
 *  - The key is derived with HKDF-SHA-256 from a Worker SECRET
 *    (`BACKUP_ENCRYPTION_KEY`). The previous design derived its "key" from the
 *    account id + Durable Object id, neither of which is secret, and also kept
 *    the plaintext copy in D1 — i.e. no real protection.
 *  - `aad` binds a ciphertext to its row (e.g. `${accountId}:${configId}`), so
 *    a sealed blob copied onto another row fails to decrypt.
 *
 * Wire format: `v1.<base64 iv>.<base64 ciphertext+tag>`
 */

export const MIN_SECRET_LENGTH = 32;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class SecretNotConfiguredError extends Error {
  constructor() {
    super(`BACKUP_ENCRYPTION_KEY must be set (>= ${MIN_SECRET_LENGTH} characters)`);
    this.name = "SecretNotConfiguredError";
  }
}

export function assertSecret(secret: string | undefined | null): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new SecretNotConfiguredError();
  return secret;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("notetion/backup-credentials/salt/v1"), info: enc.encode("aes-256-gcm") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isSealed(value: string): boolean {
  return value.startsWith("v1.");
}

export async function sealJson(secret: string | undefined | null, aad: string, value: unknown): Promise<string> {
  const key = await deriveKey(assertSecret(secret));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
      key,
      enc.encode(JSON.stringify(value)),
    ),
  );
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openJson<T>(secret: string | undefined | null, aad: string, sealed: string): Promise<T> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("not a sealed value");
  const key = await deriveKey(assertSecret(secret));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(parts[1]), additionalData: enc.encode(aad) },
    key,
    unb64(parts[2]),
  );
  return JSON.parse(dec.decode(pt)) as T;
}
