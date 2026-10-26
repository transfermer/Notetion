/**
 * S3-compatible client for off-site backups.
 *
 * Supports:
 *  - PUT (upload object)
 *  - DELETE (remove object)
 *
 * Uses AWS Signature Version 4 for authentication.
 * Compatible with AWS S3, Cloudflare R2, MinIO, etc.
 */

export interface S3Config {
  endpoint: string; // e.g. https://s3.amazonaws.com or https://<account>.r2.cloudflarestorage.com
  region: string; // e.g. us-east-1 or auto
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Client {
  constructor(private config: S3Config) {}

  async put(key: string, data: ArrayBuffer, contentType = "application/octet-stream"): Promise<void> {
    const url = `${this.config.endpoint}/${this.config.bucket}/${key}`;
    const method = "PUT";
    const headers = new Headers({
      "Content-Type": contentType,
    });

    // Sign request.
    const signedHeaders = await this.signRequest(method, url, headers, data);

    const response = await fetch(url, {
      method,
      headers: signedHeaders,
      body: data,
    });

    if (!response.ok) {
      throw new Error(`S3 PUT failed: ${response.status} ${response.statusText}`);
    }
  }

  async delete(key: string): Promise<void> {
    const url = `${this.config.endpoint}/${this.config.bucket}/${key}`;
    const method = "DELETE";
    const headers = new Headers();

    // Sign request.
    const signedHeaders = await this.signRequest(method, url, headers);

    const response = await fetch(url, {
      method,
      headers: signedHeaders,
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE failed: ${response.status} ${response.statusText}`);
    }
  }

  private async signRequest(
    method: string,
    url: string,
    headers: Headers,
    body?: ArrayBuffer,
  ): Promise<Headers> {
    const signedHeaders = new Headers(headers);
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");

    signedHeaders.set("x-amz-date", amzDate);
    signedHeaders.set("x-amz-content-sha256", await this.sha256Hex(body || new ArrayBuffer(0)));

    // Create canonical request.
    const canonicalUri = new URL(url).pathname;
    const canonicalQuerystring = "";
    const canonicalHeaders = Array.from(signedHeaders.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
      .join("\n") + "\n";
    const signedHeadersList = Array.from(signedHeaders.keys())
      .map((k) => k.toLowerCase())
      .sort()
      .join(";");
    const payloadHash = await this.sha256Hex(body || new ArrayBuffer(0));

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeadersList,
      payloadHash,
    ].join("\n");

    // Create string to sign.
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await this.sha256Hex(canonicalRequest),
    ].join("\n");

    // Calculate signature.
    const signingKey = await this.getSignatureKey(this.config.secretAccessKey, dateStamp, this.config.region);
    const signature = await this.hmacHex(signingKey, stringToSign);

    // Add authorization header.
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
    signedHeaders.set("Authorization", authorization);

    return signedHeaders;
  }

  private async sha256Hex(data: ArrayBuffer | string): Promise<string> {
    const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async hmacHex(key: ArrayBuffer, data: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async getSignatureKey(key: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
    const kDate = await this.hmac(`AWS4${key}`, dateStamp);
    const kRegion = await this.hmac(kDate, region);
    const kService = await this.hmac(kRegion, "s3");
    return this.hmac(kService, "aws4_request");
  }

  private async hmac(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      typeof key === "string" ? new TextEncoder().encode(key) : key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  }
}
