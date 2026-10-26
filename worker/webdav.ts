/**
 * WebDAV client for off-site backups (basic auth over HTTPS).
 * Fixes: base URL without a trailing slash used to REPLACE its last path segment
 * (`new URL("a.json", "https://h/dav")` → `https://h/a.json`), uploading to the wrong
 * folder; file names are now percent-encoded; requests have a timeout.
 */

export interface WebDAVConfig {
  url: string; // base URL, e.g. https://dav.example.com/backups/
  username: string;
  password: string;
}

export class WebDAVClient {
  private readonly config: WebDAVConfig;
  constructor(config: WebDAVConfig) {
    this.config = config;
  }

  private target(path: string): string {
    const base = this.config.url.endsWith("/") ? this.config.url : this.config.url + "/";
    return base + path.split("/").map(encodeURIComponent).join("/");
  }

  private auth(): string {
    const raw = new TextEncoder().encode(`${this.config.username}:${this.config.password}`);
    let bin = "";
    for (const b of raw) bin += String.fromCharCode(b); // UTF-8 safe (btoa(string) throws on non-Latin1)
    return `Basic ${btoa(bin)}`;
  }

  async put(path: string, data: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    const res = await fetch(this.target(path), {
      method: "PUT",
      headers: { Authorization: this.auth(), "Content-Type": contentType },
      body: data as BodyInit,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`WebDAV PUT failed: HTTP ${res.status}`);
  }

  async mkcol(path: string): Promise<void> {
    const res = await fetch(this.target(path), {
      method: "MKCOL",
      headers: { Authorization: this.auth() },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok && res.status !== 405) throw new Error(`WebDAV MKCOL failed: HTTP ${res.status}`); // 405 = exists
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(this.target(path), {
      method: "DELETE",
      headers: { Authorization: this.auth() },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`WebDAV DELETE failed: HTTP ${res.status}`);
  }
}
