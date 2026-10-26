import { DurableObject } from "cloudflare:workers";

/**
 * DEPRECATED — no longer used. Backup credentials are now sealed with AES-GCM using the
 * BACKUP_ENCRYPTION_KEY Worker secret (worker/crypto-box.ts) and stored in D1. The class stays
 * exported only because the existing Durable Object migration in wrangler.jsonc declares it.
 *
 * CredentialVault — isolated storage for encrypted backup credentials.
 *
 * SQLite-backed Durable Object (see `new_sqlite_classes` in wrangler.jsonc).
 *
 * Stores:
 *  - WebDAV: { url, username, password }
 *  - S3: { endpoint, region, bucket, accessKeyId, secretAccessKey }
 *
 * All credentials are encrypted with AES-GCM-256 before storage.
 * The encryption key is derived from the account ID + a vault-specific salt.
 *
 * M0: stub. M8: per-account sealed boxes (WebCrypto AES-GCM) + a small
 *     RPC surface used only by the backup worker paths.
 */

export class CredentialVault extends DurableObject<Env> {
  private tableReady = false;

  private async ensureTable(): Promise<void> {
    if (this.tableReady) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.tableReady = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureTable();
    const url = new URL(request.url);
    const method = request.method;

    if (method === "POST" && url.pathname === "/store") {
      const body = (await request.json()) as {
        id: string;
        account_id: string;
        data: string; // plaintext JSON
      };

      // Generate encryption key from account_id + salt.
      const salt = this.ctx.id.toString();
      const key = await this.deriveKey(body.account_id, salt);

      // Encrypt data.
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(body.data);
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded,
      );

      // Store in SQLite.
      await this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO credentials (id, account_id, encrypted_data, iv, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        body.id,
        body.account_id,
        btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        btoa(String.fromCharCode(...iv)),
        Date.now(),
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "GET" && url.pathname === "/retrieve") {
      const id = url.searchParams.get("id");
      const account_id = url.searchParams.get("account_id");

      if (!id || !account_id) {
        return new Response("Missing id or account_id", { status: 400 });
      }

      const row = this.ctx.storage.sql
        .exec(`SELECT encrypted_data, iv FROM credentials WHERE id = ? AND account_id = ?`, id, account_id)
        .one() as { encrypted_data: string; iv: string } | undefined;

      if (!row) {
        return new Response("Not found", { status: 404 });
      }

      // Decrypt.
      const salt = this.ctx.id.toString();
      const key = await this.deriveKey(account_id, salt);
      const encrypted = Uint8Array.from(atob(row.encrypted_data), (c) => c.charCodeAt(0));
      const iv = Uint8Array.from(atob(row.iv), (c) => c.charCodeAt(0));

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encrypted,
      );

      const plaintext = new TextDecoder().decode(decrypted);
      return new Response(plaintext, {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "DELETE" && url.pathname === "/delete") {
      const id = url.searchParams.get("id");
      const account_id = url.searchParams.get("account_id");

      if (!id || !account_id) {
        return new Response("Missing id or account_id", { status: 400 });
      }

      this.ctx.storage.sql.exec(
        `DELETE FROM credentials WHERE id = ? AND account_id = ?`,
        id,
        account_id,
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async deriveKey(account_id: string, salt: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(account_id + salt),
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  // Initialize SQLite table on first access.
  async initialize(): Promise<void> {
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }
}
