import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now } from "./util";

export const filesRoutes = new Hono<AppEnv>();
filesRoutes.use("*", requireAuth);

/**
 * 5 MB cap: KV values may be up to 25 MB, but the Free plan gives only 10 ms
 * of CPU per invocation, so keep single-request buffering small. Larger media
 * belongs in the M8 off-site backup path, not inline attachments.
 */
const MAX_SIZE = 5 * 1024 * 1024;
const NAME_MAX = 180;

function sanitizeName(name: string): string {
  const base = name.replace(/[\r\n"\\/]+/g, "_").trim().slice(0, NAME_MAX);
  return base || "file";
}

// GET /api/files?note_id= — attachment metadata list
filesRoutes.get("/", async (c) => {
  const accountId = c.get("account").id;
  const noteId = c.req.query("note_id");
  const { results } = noteId
    ? await c.env.DB.prepare(
        `SELECT id, note_id, name, mime_type, size, kind, created_at FROM files
          WHERE account_id = ?1 AND note_id = ?2 ORDER BY created_at DESC LIMIT 200`,
      )
        .bind(accountId, noteId)
        .all()
    : await c.env.DB.prepare(
        `SELECT id, note_id, name, mime_type, size, kind, created_at FROM files
          WHERE account_id = ?1 ORDER BY created_at DESC LIMIT 200`,
      )
        .bind(accountId)
        .all();
  return c.json({ files: results ?? [] });
});

// POST /api/files — multipart/form-data with a "file" field (+ optional "note_id")
filesRoutes.post("/", async (c) => {
  const accountId = c.get("account").id;
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
  if (file.size === 0) return c.json({ error: "empty_file" }, 400);
  if (file.size > MAX_SIZE) return c.json({ error: "file_too_large", max_bytes: MAX_SIZE }, 413);

  const noteIdRaw = form?.get("note_id");
  const noteId = typeof noteIdRaw === "string" && noteIdRaw ? noteIdRaw : null;
  if (noteId) {
    const note = await c.env.DB.prepare(`SELECT id FROM notes WHERE id = ?1 AND account_id = ?2`)
      .bind(noteId, accountId)
      .first();
    if (!note) return c.json({ error: "note_not_found" }, 400);
  }

  const id = newId();
  const kvKey = `f/${accountId}/${id}`;
  const name = sanitizeName(file.name || "file");
  const mime = file.type || "application/octet-stream";
  await c.env.FILES_KV.put(kvKey, await file.arrayBuffer());
  await c.env.DB.prepare(
    `INSERT INTO files (id, account_id, note_id, kv_key, name, mime_type, size, kind, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'attachment', ?8)`,
  )
    .bind(id, accountId, noteId, kvKey, name, mime, file.size, now())
    .run();

  return c.json({ file: { id, url: `/api/files/${id}`, name, mime_type: mime, size: file.size } }, 201);
});

// GET /api/files/:id — serve the blob (immutable: ids are never reused)
filesRoutes.get("/:id", async (c) => {
  const accountId = c.get("account").id;
  const row = await c.env.DB.prepare(`SELECT kv_key, name, mime_type FROM files WHERE id = ?1 AND account_id = ?2`)
    .bind(c.req.param("id"), accountId)
    .first<{ kv_key: string; name: string; mime_type: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const blob = await c.env.FILES_KV.get(row.kv_key, "arrayBuffer");
  if (!blob) return c.json({ error: "blob_missing" }, 404);

  // SECURITY: never let uploaded HTML/SVG/XML execute in the app origin.
  const dangerous = /html|svg|xml|javascript/i.test(row.mime_type) || /\.(html?|svg|xml|js|mjs)$/i.test(row.name);
  const encodedName = encodeURIComponent(row.name).replace(/['()]/g, "");
  c.header("Content-Type", dangerous ? "application/octet-stream" : row.mime_type);
  c.header("Content-Disposition", `${dangerous ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  return c.body(blob);
});

// DELETE /api/files/:id
filesRoutes.delete("/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT kv_key FROM files WHERE id = ?1 AND account_id = ?2`)
    .bind(id, accountId)
    .first<{ kv_key: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.FILES_KV.delete(row.kv_key);
  await c.env.DB.prepare(`DELETE FROM files WHERE id = ?1 AND account_id = ?2`).bind(id, accountId).run();
  return c.json({ ok: true });
});
