import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now } from "./util";
import { hybridSearch, generateEmbedding, storeEmbedding, EMBEDDING_MODEL } from "./ai";
import { extractTags, syncNoteTags } from "./tags";
import { syncWikiLinks } from "./notes";
import { keywordSearch, escapeLike } from "./fts";

export const searchRoutes = new Hono<AppEnv>();
searchRoutes.use("*", requireAuth);

// GET /api/search?q=...&type=notes|folders|tags&limit=50
searchRoutes.get("/search", async (c) => {
  const accountId = c.get("account").id;
  const q = (c.req.query("q") ?? "").trim();
  const type = c.req.query("type") ?? "all";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  if (!q) return c.json({ results: [] });

  const results: any[] = [];

  // Search notes: FTS5 (safe query) + CJK substring scan; see worker/fts.ts.
  if (type === "all" || type === "notes") {
    const hits = await keywordSearch(c.env.DB, accountId, q, limit);
    results.push(...hits.map((r) => ({ ...r, type: "note" })));
  }

  // Search folders.
  if (type === "all" || type === "folders") {
    const { results: folderResults } = await c.env.DB.prepare(
      `SELECT id, parent_id, name, sort_order, created_at, updated_at
         FROM folders
        WHERE account_id = ?1 AND lower(name) LIKE ?2 ESCAPE '\\'
        ORDER BY updated_at DESC
        LIMIT ?3`,
    )
      .bind(accountId, `%${escapeLike(q.toLowerCase())}%`, limit)
      .all();
    results.push(...(folderResults ?? []).map((r: any) => ({ ...r, type: "folder" })));
  }

  // Search tags.
  if (type === "all" || type === "tags") {
    const { results: tagResults } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.created_at, COUNT(nt.note_id) AS note_count
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
        WHERE t.account_id = ?1 AND lower(t.name) LIKE ?2 ESCAPE '\\'
        GROUP BY t.id
        ORDER BY note_count DESC, t.name
        LIMIT ?3`,
    )
      .bind(accountId, `%${escapeLike(q.toLowerCase())}%`, limit)
      .all();
    results.push(...(tagResults ?? []).map((r: any) => ({ ...r, type: "tag" })));
  }

  return c.json({ results: results.slice(0, limit), query: q });
});

// GET /api/notes/:id/versions
searchRoutes.get("/notes/:id/versions", async (c) => {
  const accountId = c.get("account").id;
  const noteId = c.req.param("id");

  // Verify note belongs to account.
  const note = await c.env.DB.prepare(`SELECT id FROM notes WHERE id = ?1 AND account_id = ?2`)
    .bind(noteId, accountId)
    .first();
  if (!note) return c.json({ error: "not_found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, version, title, content, source, created_at
       FROM note_versions
      WHERE note_id = ?1 AND account_id = ?2
      ORDER BY version DESC
      LIMIT 100`,
  )
    .bind(noteId, accountId)
    .all();

  return c.json({ versions: results ?? [] });
});

// POST /api/notes/:id/versions/:version/restore
searchRoutes.post("/notes/:id/versions/:version/restore", async (c) => {
  const accountId = c.get("account").id;
  const noteId = c.req.param("id");
  const version = parseInt(c.req.param("version"), 10);

  if (!Number.isFinite(version) || version < 1) {
    return c.json({ error: "invalid_version" }, 400);
  }

  const snapshot = await c.env.DB.prepare(
    `SELECT id, title, content FROM note_versions WHERE note_id = ?1 AND account_id = ?2 AND version = ?3`,
  )
    .bind(noteId, accountId, version)
    .first<{ id: string; title: string; content: string }>();

  if (!snapshot) return c.json({ error: "version_not_found" }, 404);

  const ts = now();

  // Snapshot the CURRENT content before overwriting (so restore is reversible).
  const current = await c.env.DB.prepare(
    `SELECT title, content, version FROM notes WHERE id = ?1 AND account_id = ?2`,
  )
    .bind(noteId, accountId)
    .first<{ title: string; content: string; version: number }>();

  const stmts = [];
  if (current) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO note_versions (id, note_id, account_id, version, title, content, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pre-restore', ?7)`,
      ).bind(newId(), noteId, accountId, current.version, current.title, current.content, ts),
    );
  }
  stmts.push(
    c.env.DB.prepare(
      `UPDATE notes SET title = ?3, content = ?4, version = version + 1, updated_at = ?5
        WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NULL`,
    ).bind(noteId, accountId, snapshot.title, snapshot.content, ts),
  );
  await c.env.DB.batch(stmts);

  // Re-derive tags + wikilinks from restored content.
  await syncNoteTags(c.env.DB, accountId, noteId, extractTags(snapshot.content));
  await syncWikiLinks(c.env.DB, accountId, noteId, snapshot.content);

  // Re-embed (best-effort, async-safe).
  if (c.env.AI) {
    const emb = await generateEmbedding(c.env, snapshot.content);
    if (emb) await storeEmbedding(c.env.DB, noteId, emb, EMBEDDING_MODEL);
  }

  const updated = await c.env.DB.prepare(`SELECT * FROM notes WHERE id = ?1`).bind(noteId).first();
  return c.json({ note: updated });
});

// GET /api/recents
searchRoutes.get("/recents", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.title, n.folder_id, n.version, n.favorite, n.pinned, n.archived,
            n.deleted_at, n.created_at, n.updated_at, r.viewed_at
       FROM recents r
       JOIN notes n ON n.id = r.note_id
      WHERE r.account_id = ?1 AND n.deleted_at IS NULL
      ORDER BY r.viewed_at DESC
      LIMIT 20`,
  )
    .bind(accountId)
    .all();
  return c.json({ recents: results ?? [] });
});

// POST /api/recents/:noteId — record a view.
searchRoutes.post("/recents/:noteId", async (c) => {
  const accountId = c.get("account").id;
  const noteId = c.req.param("noteId");

  // Verify note exists.
  const note = await c.env.DB.prepare(`SELECT id FROM notes WHERE id = ?1 AND account_id = ?2`)
    .bind(noteId, accountId)
    .first();
  if (!note) return c.json({ error: "not_found" }, 404);

  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO recents (account_id, note_id, viewed_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(account_id, note_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
  )
    .bind(accountId, noteId, ts)
    .run();

  return c.json({ ok: true });
});

// GET /api/search/hybrid?q=...&limit=20 — hybrid keyword + semantic search.
searchRoutes.get("/search/hybrid", async (c) => {
  const accountId = c.get("account").id;
  const q = (c.req.query("q") ?? "").trim();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);

  if (!q) return c.json({ results: [] });

  const results = await hybridSearch(c.env.DB, c.env, q, accountId, limit);
  return c.json({ results });
});
