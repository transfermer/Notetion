import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now } from "./util";
import { extractTags, fetchNoteTags, syncNoteTags } from "./tags";
import { parseWikiLinks } from "./wiki";
import { generateEmbedding, storeEmbedding, EMBEDDING_MODEL } from "./ai";

export const notesRoutes = new Hono<AppEnv>();
notesRoutes.use("*", requireAuth);

/** Notify SyncHub when a note changes. */
async function notifySyncHub(env: Env, accountId: string, noteId: string, action: "create" | "update" | "delete" | "restore"): Promise<void> {
  try {
    const syncHub = env.SYNC_HUB;
    const id = syncHub.idFromName(accountId);
    const stub = syncHub.get(id);
    // Use RPC to call the notify method directly.
    await (stub as any).notify(accountId, { type: "note", id: noteId, action, timestamp: now() });
  } catch (err) {
    console.error("[notes] SyncHub notify failed:", err);
  }
}

/**
 * Sync wiki links for a note: delete old links, insert new ones.
 * Resolves target_note_id by looking up notes with matching title.
 */
export async function syncWikiLinks(
  db: D1Database,
  accountId: string,
  noteId: string,
  content: string,
): Promise<void> {
  const { links } = parseWikiLinks(content);

  // Delete old links.
  await db.prepare(`DELETE FROM wiki_links WHERE source_note_id = ?1`).bind(noteId).run();

  if (links.length === 0) return;

  // Insert new links.
  const ts = now();
  const stmts: D1PreparedStatement[] = [];

  for (const link of links) {
    // Try to resolve target note by title.
    let targetNoteId: string | null = null;
    if (link.target) {
      const target = await db
        .prepare(`SELECT id FROM notes WHERE account_id = ?1 AND title = ?2 AND deleted_at IS NULL LIMIT 1`)
        .bind(accountId, link.target)
        .first<{ id: string }>();
      targetNoteId = target?.id ?? null;
    }

    stmts.push(
      db
        .prepare(
          `INSERT INTO wiki_links (id, source_note_id, target_note_id, target_title, link_type, block_id, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(newId(), noteId, targetNoteId, link.target || noteId, link.type, link.blockId ?? null, ts),
    );
  }

  await db.batch(stmts);
}

/**
 * Get backlinks for a note (notes that link to this one).
 */
export async function getBacklinks(db: D1Database, accountId: string, noteId: string): Promise<Array<{ id: string; title: string; link_type: string }>> {
  const { results } = await db
    .prepare(
      `SELECT n.id, n.title, wl.link_type
         FROM wiki_links wl
         JOIN notes n ON n.id = wl.source_note_id
        WHERE wl.target_note_id = ?1 AND n.account_id = ?2 AND n.deleted_at IS NULL
        ORDER BY n.updated_at DESC
        LIMIT 100`,
    )
    .bind(noteId, accountId)
    .all();
  return (results ?? []) as Array<{ id: string; title: string; link_type: string }>;
}

interface NoteRow {
  id: string;
  account_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  version: number;
  favorite: number;
  pinned: number;
  archived: number;
  deleted_at: number | null;
  purge_at: number | null;
  created_at: number;
  updated_at: number;
}

const FULL_COLS =
  "id, account_id, folder_id, title, content, version, favorite, pinned, archived, deleted_at, purge_at, created_at, updated_at";
const LIST_COLS =
  "id, folder_id, title, version, favorite, pinned, archived, deleted_at, purge_at, created_at, updated_at";
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TITLE_MAX = 500;

function toFlag(value: unknown, fallback: number): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  return fallback;
}

async function folderExists(db: D1Database, accountId: string, folderId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM folders WHERE id = ?1 AND account_id = ?2`).bind(folderId, accountId).first();
  return row !== null && row !== undefined;
}

async function fetchNote(db: D1Database, accountId: string, id: string): Promise<NoteRow | null> {
  const row = await db.prepare(`SELECT ${FULL_COLS} FROM notes WHERE id = ?1 AND account_id = ?2`).bind(id, accountId).first<NoteRow>();
  return row ?? null;
}

// GET /api/notes?trash=1&archived=1&folder_id=<id>
notesRoutes.get("/", async (c) => {
  const accountId = c.get("account").id;
  const trash = c.req.query("trash") === "1";
  const archived = c.req.query("archived") === "1";
  const folderId = c.req.query("folder_id");

  const clauses = [
    "account_id = ?1",
    trash
      ? "deleted_at IS NOT NULL"
      : archived
        ? "deleted_at IS NULL AND archived = 1"
        : "deleted_at IS NULL AND archived = 0",
  ];
  const params: (string | number | null)[] = [accountId];
  if (folderId) {
    params.push(folderId);
    clauses.push(`folder_id = ?${params.length}`);
  }
  const order = trash ? "deleted_at DESC" : "pinned DESC, updated_at DESC";
  const { results } = await c.env.DB.prepare(
    `SELECT ${LIST_COLS}, substr(content, 1, 160) AS excerpt
       FROM notes
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${order}
      LIMIT 500`,
  )
    .bind(...params)
    .all();
  return c.json({ notes: results ?? [] });
});

// POST /api/notes
notesRoutes.post("/", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as
    | { title?: unknown; content?: unknown; folder_id?: unknown }
    | null;
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const title = typeof body.title === "string" ? body.title.slice(0, TITLE_MAX) : "";
  const content = typeof body.content === "string" ? body.content : "";
  const folderId = typeof body.folder_id === "string" ? body.folder_id : null;
  if (folderId && !(await folderExists(c.env.DB, accountId, folderId))) {
    return c.json({ error: "folder_not_found" }, 400);
  }

  const ts = now();
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO notes (id, account_id, folder_id, title, content, version, favorite, pinned, archived, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, 0, 0, ?6, ?6)`,
  )
    .bind(id, accountId, folderId, title, content, ts)
    .run();

  await syncNoteTags(c.env.DB, accountId, id, extractTags(content));
  await syncWikiLinks(c.env.DB, accountId, id, content);

  // Enqueue embedding generation (async via queue, or sync fallback).
  if (c.env.EMBEDDING_QUEUE) {
    try {
      await c.env.EMBEDDING_QUEUE.send({ noteId: id, accountId, content });
    } catch (err) {
      console.error("[notes] Queue enqueue failed:", err);
      // Fallback: generate embedding synchronously.
      const embedding = await generateEmbedding(c.env, content);
      if (embedding) {
        await storeEmbedding(c.env.DB, id, embedding, EMBEDDING_MODEL);
      }
    }
  } else if (c.env.AI) {
    // No queue configured, generate synchronously.
    const embedding = await generateEmbedding(c.env, content);
    if (embedding) {
      await storeEmbedding(c.env.DB, id, embedding, EMBEDDING_MODEL);
    }
  }

  const note = await fetchNote(c.env.DB, accountId, id);
  const tags = await fetchNoteTags(c.env.DB, accountId, id);
  await notifySyncHub(c.env, accountId, id, "create");
  return c.json({ note, tags }, 201);
});

// GET /api/notes/:id
notesRoutes.get("/:id", async (c) => {
  const accountId = c.get("account").id;
  const note = await fetchNote(c.env.DB, accountId, c.req.param("id"));
  if (!note) return c.json({ error: "not_found" }, 404);
  const tags = await fetchNoteTags(c.env.DB, accountId, note.id);
  return c.json({ note, tags });
});

// PATCH /api/notes/:id — optimistic concurrency via base_version.
notesRoutes.patch("/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");
  const db = c.env.DB;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const current = await fetchNote(db, accountId, id);
  if (!current) return c.json({ error: "not_found" }, 404);
  if (current.deleted_at !== null) return c.json({ error: "note_deleted" }, 409);

  if (typeof body.base_version === "number" && body.base_version !== current.version) {
    return c.json({ error: "version_conflict", current_version: current.version, note: current }, 409);
  }

  const title = typeof body.title === "string" ? body.title.slice(0, TITLE_MAX) : current.title;
  const content = typeof body.content === "string" ? body.content : current.content;
  const folderId =
    body.folder_id === null
      ? null
      : typeof body.folder_id === "string"
        ? body.folder_id
        : current.folder_id;
  if (folderId && folderId !== current.folder_id && !(await folderExists(db, accountId, folderId))) {
    return c.json({ error: "folder_not_found" }, 400);
  }
  const favorite = toFlag(body.favorite, current.favorite);
  const pinned = toFlag(body.pinned, current.pinned);
  const archived = toFlag(body.archived, current.archived);

  const ts = now();
  const textChanged = title !== current.title || content !== current.content;

  const stmts: D1PreparedStatement[] = [];
  if (textChanged) {
    // Snapshot the pre-edit state; retention policy arrives in M2.
    stmts.push(
      db
        .prepare(
          `INSERT INTO note_versions (id, note_id, account_id, version, title, content, source, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'edit', ?7)`,
        )
        .bind(newId(), id, accountId, current.version, current.title, current.content, ts),
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE notes
            SET title = ?3, content = ?4, folder_id = ?5, favorite = ?6, pinned = ?7, archived = ?8,
                version = version + 1, updated_at = ?9
          WHERE id = ?1 AND account_id = ?2 AND version = ?10 AND deleted_at IS NULL`,
      )
      .bind(id, accountId, title, content, folderId, favorite, pinned, archived, ts, current.version),
  );

  const results = await db.batch(stmts);
  const updateResult = results[results.length - 1];
  if (!updateResult || !updateResult.meta.changes) {
    const fresh = await fetchNote(db, accountId, id);
    return c.json({ error: "version_conflict", current_version: fresh?.version ?? null, note: fresh }, 409);
  }

  if (content !== current.content) {
    await syncNoteTags(db, accountId, id, extractTags(content));
    await syncWikiLinks(db, accountId, id, content);

    // Enqueue embedding generation.
    if (c.env.EMBEDDING_QUEUE) {
      try {
        await c.env.EMBEDDING_QUEUE.send({ noteId: id, accountId, content });
      } catch (err) {
        console.error("[notes] Queue enqueue failed:", err);
        const embedding = await generateEmbedding(c.env, content);
        if (embedding) {
          await storeEmbedding(c.env.DB, id, embedding, EMBEDDING_MODEL);
        }
      }
    } else if (c.env.AI) {
      const embedding = await generateEmbedding(c.env, content);
      if (embedding) {
        await storeEmbedding(c.env.DB, id, embedding, EMBEDDING_MODEL);
      }
    }
  }
  const note = await fetchNote(db, accountId, id);
  const tags = await fetchNoteTags(db, accountId, id);
  await notifySyncHub(c.env, accountId, id, "update");
  return c.json({ note, tags });
});

// DELETE /api/notes/:id[?permanent=1]
notesRoutes.delete("/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");
  const permanent = c.req.query("permanent") === "1";

  if (permanent) {
    const res = await c.env.DB.prepare(
      `DELETE FROM notes WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NOT NULL`,
    )
      .bind(id, accountId)
      .run();
    if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
    await notifySyncHub(c.env, accountId, id, "delete");
    return c.json({ ok: true, permanent: true });
  }

  const ts = now();
  const res = await c.env.DB.prepare(
    `UPDATE notes SET deleted_at = ?3, purge_at = ?4, updated_at = ?3
      WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(id, accountId, ts, ts + TRASH_RETENTION_MS)
    .run();
  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  await notifySyncHub(c.env, accountId, id, "delete");
  return c.json({ ok: true });
});

// POST /api/notes/:id/restore
notesRoutes.post("/:id/restore", async (c) => {
  const accountId = c.get("account").id;
  const res = await c.env.DB.prepare(
    `UPDATE notes SET deleted_at = NULL, purge_at = NULL, updated_at = ?3
      WHERE id = ?1 AND account_id = ?2 AND deleted_at IS NOT NULL`,
  )
    .bind(c.req.param("id"), accountId, now())
    .run();
  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  await notifySyncHub(c.env, accountId, c.req.param("id"), "restore");
  return c.json({ ok: true });
});

// GET /api/notes/:id/backlinks
notesRoutes.get("/:id/backlinks", async (c) => {
  const accountId = c.get("account").id;
  const backlinks = await getBacklinks(c.env.DB, accountId, c.req.param("id"));
  return c.json({ backlinks });
});
