/**
 * S3-compatible client (AWS S3, Cloudflare R2, MinIO, …) using AWS Signature V4.
 *
 * Fixes vs. the previous version:
 *  - `host` is now part of the signed headers (S3 rejects requests without it,
 *    so every previous S3 backup failed with a signature/AccessDenied error);
 *  - the canonical URI is encoded per RFC 3986 segment-by-segment as S3 requires;
 *  - the signing logic is a pure function, verified against AWS's published
 *    SigV4 test vectors (see tests/s3.test.ts).
 */

export interface S3Config {
  endpoint: string; // e.g. https://<account>.r2.cloudflarestorage.com
  region: string; // e.g. us-east-1, or "auto" for R2
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function hmac(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

/** RFC 3986 percent-encoding as required by SigV4 (also encodes ! ' ( ) *). */
function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface SignInput {
  method: string;
  url: string;
  /** Extra headers to send AND sign (e.g. content-type). host / x-amz-* are added automatically. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** ISO basic format, e.g. 20130524T000000Z */
  amzDate: string;
  service?: string;
}

/** Returns the headers to send (everything except `host`, which fetch sets itself). */
export async function signRequest(i: SignInput): Promise<Record<string, string>> {
  const service = i.service ?? "s3";
  const u = new URL(i.url);
  const dateStamp = i.amzDate.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = v;
  headers["x-amz-date"] = i.amzDate;
  headers["x-amz-content-sha256"] = i.payloadHash;

  const signable: Record<string, string> = { ...headers, host: u.host };
  const names = Object.keys(signable).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signable[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalUri = u.pathname
    .split("/")
    .map((seg) => uriEncode(decodeURIComponent(seg)))
    .join("/");
  const canonicalQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [i.method, canonicalUri || "/", canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");

  const scope = `${dateStamp}/${i.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(`AWS4${i.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, i.region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

export function amzDateNow(d = new Date()): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export class S3Client {
  private readonly config: S3Config;
  constructor(config: S3Config) {
    this.config = config;
  }

  private objectUrl(key: string): string {
    const base = this.config.endpoint.replace(/\/+$/, "");
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `${base}/${encodeURIComponent(this.config.bucket)}/${path}`;
  }

  async put(key: string, data: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    const url = this.objectUrl(key);
    const headers = await signRequest({
      method: "PUT",
      url,
      headers: { "content-type": contentType },
      payloadHash: await sha256Hex(data),
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      amzDate: amzDateNow(),
    });
    const res = await fetch(url, { method: "PUT", headers, body: data as BodyInit, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`S3 PUT failed: HTTP ${res.status}`);
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const headers = await signRequest({
      method: "DELETE",
      url,
      payloadHash: await sha256Hex(new Uint8Array(0)),
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      amzDate: amzDateNow(),
    });
    const res = await fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(25_000) });
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed: HTTP ${res.status}`);
  }
}
