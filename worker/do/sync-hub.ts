import { DurableObject } from "cloudflare:workers";

/**
 * SyncHub — realtime change notifications between online clients.
 *
 * SQLite-backed Durable Object (declared via `new_sqlite_classes` in
 * wrangler.jsonc migrations — required on the Workers Free plan).
 *
 * Uses the Hibernation API so idle hubs cost nothing (no duration billing
 * when no WebSockets are connected).
 *
 * Protocol:
 *  - Client connects: `GET /sync/:accountId`
 *  - Server accepts WebSocket, tags it with accountId.
 *  - When a note/folder changes, the Worker calls `syncHub.notify(accountId, event)`.
 *  - SyncHub broadcasts the event to all connected WebSockets for that account.
 *
 * M3: WebSocket endpoints with the Hibernation API.
 * M0: stub.
 */

interface SyncEvent {
  type: "note" | "folder" | "file";
  id: string;
  action: "create" | "update" | "delete" | "restore";
  timestamp: number;
}

export class SyncHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const accountId = url.pathname.split("/").pop();

    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Upgrade to WebSocket.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Tag the WebSocket with the account ID for fan-out.
    this.ctx.acceptWebSocket(server, [accountId]);

    server.addEventListener("message", (event) => {
      // Client messages are ignored in M3 (server-push only).
      console.log("[SyncHub] Client message:", event.data);
    });

    server.addEventListener("close", () => {
      console.log("[SyncHub] WebSocket closed");
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Notify all connected clients for a given account.
   * Called from the Worker when a note/folder/file changes.
   */
  async notify(accountId: string, event: SyncEvent): Promise<void> {
    const message = JSON.stringify({ type: "sync", event });
    const websockets = this.ctx.getWebSockets(accountId);

    for (const ws of websockets) {
      try {
        ws.send(message);
      } catch (err) {
        console.error("[SyncHub] Failed to send to WebSocket:", err);
      }
    }
  }

  /**
   * Handle WebSocket messages (for future bidirectional sync).
   */
  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    console.log("[SyncHub] WebSocket message:", message);
  }

  /**
   * Handle WebSocket close.
   */
  async webSocketClose(_ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    console.log("[SyncHub] WebSocket closed:", code, reason);
  }

  /**
   * Handle WebSocket error.
   */
  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("[SyncHub] WebSocket error:", error);
  }
}
