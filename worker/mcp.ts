import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { authenticateApiRequest } from "./api-keys";
import { newId, now } from "./util";
import { keywordSearch } from "./fts";

export const mcpRoutes = new Hono<AppEnv>();

/**
 * Middleware to authenticate MCP requests via API key or OAuth token.
 */
async function requireApiAuth(c: any, next: any) {
  const auth = await authenticateApiRequest(c.env.DB, c.req.header("Authorization"));
  if (!auth) return c.json({ error: "unauthorized" }, 401);

  c.set("apiAccountId" as any, auth.accountId);
  c.set("apiPermissions" as any, auth.permissions);
  c.set("apiAuthType" as any, auth.authType);

  await next();
}

mcpRoutes.use("*", requireApiAuth);

const CHUNK_SIZE = 10000; // characters per chunk

// GET /mcp/notes — list notes (paginated).
mcpRoutes.get("/notes", async (c) => {
  const accountId = c.get("apiAccountId" as any) as string;
  const permissions = c.get("apiPermissions" as any) as string[];
  if (!permissions.includes("read")) return c.json({ error: "forbidden" }, 403);

  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, folder_id, version, favorite, pinned, archived, deleted_at, created_at, updated_at
       FROM notes
      WHERE account_id = ?1 AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT ?2 OFFSET ?3`,
  )
    .bind(accountId, limit, offset)
    .all();

  return c.json({ notes: results ?? [], page, limit });
});

// GET /mcp/notes/:id — get note with chunked content.
mcpRoutes.get("/notes/:id", async (c) => {
  const accountId = c.get("apiAccountId" as any) as string;
  const permissions = c.get("apiPermissions" as any) as string[];
  if (!permissions.includes("read")) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const chunk = parseInt(c.req.query("chunk") || "0", 10);

  const note = await c.env.DB.prepare(
    `SELECT id, title, content, folder_id, version, favorite, pinned, archived, created_at, updated_at
       FROM notes
      WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(id, accountId)
    .first();

  if (!note) return c.json({ error: "not_found" }, 404);

  const totalChunks = Math.ceil((note.content as string).length / CHUNK_SIZE);
  const contentChunk = (note.content as string).slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE);

  // Log request.
  c.env.DB.prepare(
    `INSERT INTO mcp_requests (id, account_id, method, path, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(newId(), accountId, "GET", `/mcp/notes/${id}`, 200, now())
    .run()
    .catch(() => {});

  return c.json({
    note: { ...note, content: contentChunk },
    chunk,
    total_chunks: totalChunks,
    chunk_size: CHUNK_SIZE,
  });
});

// POST /mcp/notes — create note (version-safe).
mcpRoutes.post("/notes", async (c) => {
  const accountId = c.get("apiAccountId" as any) as string;
  const permissions = c.get("apiPermissions" as any) as string[];
  if (!permissions.includes("write")) return c.json({ error: "forbidden" }, 403);

  const body = (await c.req.json().catch(() => null)) as { title?: unknown; content?: unknown; folder_id?: unknown } | null;
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const title = typeof body.title === "string" ? body.title.slice(0, 500) : "";
  const content = typeof body.content === "string" ? body.content : "";
  const folderId = typeof body.folder_id === "string" ? body.folder_id : null;

  const ts = now();
  const id = newId();

  await c.env.DB.prepare(
    `INSERT INTO notes (id, account_id, folder_id, title, content, version, favorite, pinned, archived, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, 0, 0, ?6, ?6)`,
  )
    .bind(id, accountId, folderId, title, content, ts)
    .run();

  const note = await c.env.DB.prepare(`SELECT * FROM notes WHERE id = ?1`).bind(id).first();

  return c.json({ note }, 201);
});

// PATCH /mcp/notes/:id — update note (version-safe with CAS).
mcpRoutes.patch("/notes/:id", async (c) => {
  const accountId = c.get("apiAccountId" as any) as string;
  const permissions = c.get("apiPermissions" as any) as string[];
  if (!permissions.includes("write")) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const current = await c.env.DB.prepare(
    `SELECT * FROM notes WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(id, accountId)
    .first();

  if (!current) return c.json({ error: "not_found" }, 404);

  if (typeof body.base_version === "number" && body.base_version !== current.version) {
    return c.json({ error: "version_conflict", current_version: current.version }, 409);
  }

  const title = typeof body.title === "string" ? body.title.slice(0, 500) : current.title;
  const content = typeof body.content === "string" ? body.content : current.content;
  const folderId = body.folder_id === null ? null : typeof body.folder_id === "string" ? body.folder_id : current.folder_id;

  const ts = now();
  await c.env.DB.prepare(
    `UPDATE notes SET title = ?3, content = ?4, folder_id = ?5, version = version + 1, updated_at = ?6
      WHERE id = ?1 AND account_id = ?2 AND version = ?7 AND deleted_at IS NULL`,
  )
    .bind(id, accountId, title, content, folderId, ts, current.version)
    .run();

  const note = await c.env.DB.prepare(`SELECT * FROM notes WHERE id = ?1`).bind(id).first();

  return c.json({ note });
});

// DELETE /mcp/notes/:id — soft delete (move to trash).
mcpRoutes.delete("/notes/:id", async (c) => {
  const accountId = c.get("apiAccountId" as any) as string;
  const permissions = c.get("apiPermissions" as any) as string[];
  if (!permissions.includes("delete")) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const ts = now();

  const res = await c.env.DB.prepare(
    `UPDATE notes SET deleted_at = ?3, purge_at = ?4, updated_at = ?3
      WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(id, accountId, ts, ts + 30 * 24 * 60 * 60 * 1000)
    .run();

  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// GET /mcp/search — search notes (FTS5).
mcpRoutes.get("/search", async (c) => {
  const accountId = c.get("apiAccountId" as any) as string;
  const permissions = c.get("apiPermissions" as any) as string[];
  if (!permissions.includes("read")) return c.json({ error: "forbidden" }, 403);

  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ results: [] });

  try {
    // Shared keyword search: safe FTS query + CJK substring scan (worker/fts.ts).
    const hits = await keywordSearch(c.env.DB, accountId, q, 50);
    return c.json({
      results: hits.map((h) => ({
        id: h.id,
        title: h.title,
        folder_id: h.folder_id,
        version: h.version,
        updated_at: h.updated_at,
        snippet: h.snippet,
      })),
    });
  } catch {
    return c.json({ error: "search_failed" }, 500);
  }
});
