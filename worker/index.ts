import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { authRoutes } from "./auth";
import { notesRoutes } from "./notes";
import { foldersRoutes } from "./folders";
import { settingsRoutes } from "./settings";
import { filesRoutes } from "./files";
import { searchRoutes } from "./search";
import { apiKeysRoutes } from "./api-keys";
import { oauthRoutes, oauthAuthorizeRoutes, oauthTokenRoutes } from "./oauth";
import { mcpRoutes } from "./mcp";
import { sharesRoutes, publicShareRoutes } from "./shares";
import { exportRoutes } from "./export";
import { backupRoutes } from "./backups";
import { runCleanup } from "./cron";
import { generateEmbedding, storeEmbedding, EMBEDDING_MODEL } from "./ai";

// Durable Object classes must be exported from the Worker entrypoint.
export { SyncHub } from "./do/sync-hub";
export { CredentialVault } from "./do/credential-vault";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) =>
  c.json({ ok: true, app: "notetion", version: c.env.APP_VERSION ?? "dev", time: Date.now() }),
);

app.route("/api/auth", authRoutes);
app.route("/api/notes", notesRoutes);
app.route("/api/folders", foldersRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/files", filesRoutes);
app.route("/api", searchRoutes);
app.route("/api/api-keys", apiKeysRoutes);
app.route("/api/oauth", oauthRoutes);
app.route("/oauth", oauthAuthorizeRoutes);
app.route("/oauth", oauthTokenRoutes);
app.route("/mcp", mcpRoutes);
app.route("/api/shares", sharesRoutes);
app.route("/api/export", exportRoutes);
app.route("/api/backups", backupRoutes);

// Public share routes (no auth).
app.route("/s", publicShareRoutes);

// Graph endpoint (requires auth).
app.get("/api/graph", async (c) => {
  const { resolveAccount, readSessionToken } = await import("./session");
  const account = await resolveAccount(c.env.DB, readSessionToken(c));
  if (!account) return c.json({ error: "unauthorized" }, 401);

  const { results: notes } = await c.env.DB.prepare(
    `SELECT id, title FROM notes WHERE account_id = ?1 AND deleted_at IS NULL LIMIT 500`,
  )
    .bind(account.id)
    .all();

  const { results: links } = await c.env.DB.prepare(
    `SELECT source_note_id, target_note_id, link_type
       FROM wiki_links
      WHERE source_note_id IN (SELECT id FROM notes WHERE account_id = ?1 AND deleted_at IS NULL)
        AND target_note_id IS NOT NULL
      LIMIT 2000`,
  )
    .bind(account.id)
    .all();

  return c.json({
    nodes: (notes ?? []).map((n: any) => ({ id: n.id, title: n.title })),
    edges: (links ?? []).map((l: any) => ({
      source: l.source_note_id,
      target: l.target_note_id,
      type: l.link_type,
    })),
  });
});

// SyncHub WebSocket endpoint. Requires an authenticated session; the account
// id is taken from the session (NOT the URL) so users can only subscribe to
// their own hub.
app.get("/sync/me", async (c) => {
  const { resolveAccount, readSessionToken } = await import("./session");
  const account = await resolveAccount(c.env.DB, readSessionToken(c));
  if (!account) return c.json({ error: "unauthorized" }, 401);

  const syncHub = c.env.SYNC_HUB;
  const id = syncHub.idFromName(account.id);
  const stub = syncHub.get(id);
  return stub.fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "not_found", path: new URL(c.req.url).pathname }, 404));
app.onError((err, c) => {
  console.error("notetion_worker_error", JSON.stringify({ message: err.message, path: c.req.path }));
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: async (event, env, ctx) => {
    // Run daily cleanup.
    ctx.waitUntil(runCleanup(env));

    // Check for scheduled backups.
    const cronExpression = event.cron;
    if (cronExpression) {
      ctx.waitUntil(runScheduledBackups(env, cronExpression));
    }
  },
  // Queue consumer for background embedding generation.
  queue: async (batch, env, _ctx) => {
    for (const msg of batch.messages) {
      const { noteId, content } = msg.body as { noteId: string; accountId: string; content: string };
      try {
        const embedding = await generateEmbedding(env, content);
        if (embedding) {
          await storeEmbedding(env.DB, noteId, embedding, EMBEDDING_MODEL);
        }
        msg.ack();
      } catch (err) {
        console.error("[queue] Embedding job failed:", err);
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Run scheduled backups for all accounts with matching cron schedules.
 */
async function runScheduledBackups(env: Env, cronExpression: string): Promise<void> {
  const { results: configs } = await env.DB.prepare(
    `SELECT id, account_id, schedule FROM backup_configs WHERE enabled = 1 AND schedule = ?1`,
  )
    .bind(cronExpression)
    .all<{ id: string; account_id: string; schedule: string }>();

  for (const config of configs ?? []) {
    try {
      // Trigger backup via internal fetch.
      await env.DB.prepare(
        `INSERT INTO backup_history (id, account_id, config_id, status, started_at, created_at)
         VALUES (?1, ?2, ?3, 'running', ?4, ?4)`,
      )
        .bind(crypto.randomUUID(), config.account_id, config.id, Date.now())
        .run();

      // TODO: Implement actual backup logic here (fetch notes, upload to WebDAV/S3).
      console.log(`[backup] Scheduled backup triggered for config ${config.id}`);
    } catch (err) {
      console.error(`[backup] Scheduled backup failed for config ${config.id}:`, err);
    }
  }
}
