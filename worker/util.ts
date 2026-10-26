/** Shared helpers: ids, time, hashing, constant-time comparison. */

const HEX = "0123456789abcdef";

export function now(): number {
  return Date.now();
}

export function newId(): string {
  return crypto.randomUUID();
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0x0f];
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export function randomTokenHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

/**
 * Compare two secret strings without leaking length or prefix timing:
 * hash both sides first (equal length), then XOR byte-by-byte.
 */
export async function safeEqualSecret(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = ha.length ^ hb.length;
  const len = Math.min(ha.length, hb.length);
  for (let i = 0; i < len; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
