import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { now } from "./util";

export const exportRoutes = new Hono<AppEnv>();
exportRoutes.use("*", requireAuth);

// POST /api/export
exportRoutes.post("/", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as { format?: unknown; note_ids?: unknown } | null;

  const format = typeof body?.format === "string" && ["json", "markdown", "zip"].includes(body.format) ? body.format : "json";
  const noteIds = Array.isArray(body?.note_ids) ? (body.note_ids as string[]) : null;

  // Fetch notes.
  let notesQuery = c.env.DB.prepare(
    `SELECT id, title, content, folder_id, favorite, pinned, archived, created_at, updated_at
       FROM notes
      WHERE account_id = ?1 AND deleted_at IS NULL`,
  ).bind(accountId);

  if (noteIds && noteIds.length > 0) {
    const placeholders = noteIds.map((_, i) => `?${i + 2}`).join(", ");
    notesQuery = c.env.DB.prepare(
      `SELECT id, title, content, folder_id, favorite, pinned, archived, created_at, updated_at
         FROM notes
        WHERE account_id = ?1 AND id IN (${placeholders}) AND deleted_at IS NULL`,
    ).bind(accountId, ...noteIds);
  }

  const { results } = await notesQuery.all();
  const notes = (results ?? []) as Array<{ id: string; title: string; content: string; folder_id: string | null; favorite: number; pinned: number; archived: number; created_at: number; updated_at: number }>;

  if (format === "json") {
    const exportData = {
      version: "1.0",
      exported_at: now(),
      account: accountId,
      notes,
    };
    return c.json(exportData);
  }

  if (format === "markdown") {
    // Return a single markdown file with all notes separated by ---.
    const markdown = notes
      .map((n) => `# ${n.title}\n\n${n.content}\n\n---\n\n`)
      .join("");
    return c.text(markdown, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": "attachment; filename=notetion-export.md",
    });
  }

  if (format === "zip") {
    // TODO: Implement ZIP generation with JSZip.
    // For now, return JSON with a note.
    return c.json({ error: "zip_not_implemented_yet", note: "Use JSON or Markdown format for now." }, 501);
  }

  return c.json({ error: "invalid_format" }, 400);
});
