import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now } from "./util";

export const foldersRoutes = new Hono<AppEnv>();
foldersRoutes.use("*", requireAuth);

interface FolderRow {
  id: string;
  account_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const FOLDER_COLS = "id, parent_id, name, sort_order, created_at, updated_at";
const NAME_MAX = 120;

// GET /api/folders — flat list; the client builds the tree.
foldersRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${FOLDER_COLS} FROM folders WHERE account_id = ?1 ORDER BY sort_order ASC, created_at ASC LIMIT 500`,
  )
    .bind(c.get("account").id)
    .all();
  return c.json({ folders: results ?? [] });
});

// POST /api/folders
foldersRoutes.post("/", async (c) => {
  const accountId = c.get("account").id;
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => null)) as { name?: unknown; parent_id?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, NAME_MAX) : "";
  if (!name) return c.json({ error: "name_required" }, 400);

  const parentId = typeof body?.parent_id === "string" ? body.parent_id : null;
  if (parentId) {
    const parent = await db.prepare(`SELECT id FROM folders WHERE id = ?1 AND account_id = ?2`).bind(parentId, accountId).first();
    if (!parent) return c.json({ error: "parent_not_found" }, 400);
  }

  const maxRow = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM folders WHERE account_id = ?1 AND parent_id IS ?2`)
    .bind(accountId, parentId)
    .first<{ next: number }>();

  const ts = now();
  const folder = {
    id: newId(),
    parent_id: parentId,
    name,
    sort_order: maxRow?.next ?? 1,
    created_at: ts,
    updated_at: ts,
  };
  await db
    .prepare(
      `INSERT INTO folders (id, account_id, parent_id, name, sort_order, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    )
    .bind(folder.id, accountId, folder.parent_id, folder.name, folder.sort_order, ts)
    .run();
  return c.json({ folder }, 201);
});

// PATCH /api/folders/:id — rename / re-parent (cycle-safe) / reorder.
foldersRoutes.patch("/:id", async (c) => {
  const accountId = c.get("account").id;
  const db = c.env.DB;
  const id = c.req.param("id");

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const current = await db.prepare(`SELECT * FROM folders WHERE id = ?1 AND account_id = ?2`).bind(id, accountId).first<FolderRow>();
  if (!current) return c.json({ error: "not_found" }, 404);

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, NAME_MAX) : current.name;
  const sortOrder = typeof body.sort_order === "number" && Number.isFinite(body.sort_order) ? body.sort_order : current.sort_order;

  let parentId = current.parent_id;
  if ("parent_id" in body) {
    if (body.parent_id === null) {
      parentId = null;
    } else if (typeof body.parent_id === "string") {
      if (body.parent_id === id) return c.json({ error: "cycle_forbidden" }, 400);
      // Walk up from the new parent; `id` must never appear in its ancestor chain.
      let cursor: string | null = body.parent_id;
      let hops = 0;
      while (cursor && hops < 64) {
        if (cursor === id) return c.json({ error: "cycle_forbidden" }, 400);
        const row: { parent_id: string | null } | null = await db
          .prepare(`SELECT parent_id FROM folders WHERE id = ?1 AND account_id = ?2`)
          .bind(cursor, accountId)
          .first();
        if (!row) return c.json({ error: "parent_not_found" }, 400);
        cursor = row.parent_id;
        hops++;
      }
      parentId = body.parent_id;
    } else {
      return c.json({ error: "invalid_parent" }, 400);
    }
  }

  const ts = now();
  await db
    .prepare(`UPDATE folders SET name = ?3, parent_id = ?4, sort_order = ?5, updated_at = ?6 WHERE id = ?1 AND account_id = ?2`)
    .bind(id, accountId, name, parentId, sortOrder, ts)
    .run();
  const folder = await db.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE id = ?1`).bind(id).first();
  return c.json({ folder });
});

// DELETE /api/folders/:id — children are re-parented upward; notes become unfiled.
foldersRoutes.delete("/:id", async (c) => {
  const accountId = c.get("account").id;
  const db = c.env.DB;
  const id = c.req.param("id");

  const current = await db
    .prepare(`SELECT id, parent_id FROM folders WHERE id = ?1 AND account_id = ?2`)
    .bind(id, accountId)
    .first<{ id: string; parent_id: string | null }>();
  if (!current) return c.json({ error: "not_found" }, 404);

  const ts = now();
  await db.batch([
    db
      .prepare(`UPDATE folders SET parent_id = ?3, updated_at = ?4 WHERE parent_id = ?1 AND account_id = ?2`)
      .bind(id, accountId, current.parent_id, ts),
    db.prepare(`UPDATE notes SET folder_id = NULL, updated_at = ?3 WHERE folder_id = ?1 AND account_id = ?2`).bind(id, accountId, ts),
    db.prepare(`DELETE FROM folders WHERE id = ?1 AND account_id = ?2`).bind(id, accountId),
  ]);
  return c.json({ ok: true });
});
