/**
 * WebDAV client for off-site backups.
 *
 * Supports:
 *  - PUT (upload file)
 *  - MKCOL (create directory)
 *  - DELETE (remove file)
 *
 * Uses basic auth (username:password) over HTTPS.
 */

export interface WebDAVConfig {
  url: string; // base URL, e.g. https://dav.example.com/backups/
  username: string;
  password: string;
}

export class WebDAVClient {
  constructor(private config: WebDAVConfig) {}

  private getAuthHeader(): string {
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    return `Basic ${credentials}`;
  }

  async put(path: string, data: ArrayBuffer, contentType = "application/octet-stream"): Promise<void> {
    const url = new URL(path, this.config.url).toString();
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": contentType,
      },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`WebDAV PUT failed: ${response.status} ${response.statusText}`);
    }
  }

  async mkcol(path: string): Promise<void> {
    const url = new URL(path, this.config.url).toString();
    const response = await fetch(url, {
      method: "MKCOL",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok && response.status !== 405) {
      // 405 = already exists
      throw new Error(`WebDAV MKCOL failed: ${response.status} ${response.statusText}`);
    }
  }

  async delete(path: string): Promise<void> {
    const url = new URL(path, this.config.url).toString();
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok && response.status !== 404) {
      // 404 = already deleted
      throw new Error(`WebDAV DELETE failed: ${response.status} ${response.statusText}`);
    }
  }
}
