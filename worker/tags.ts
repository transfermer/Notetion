import { newId } from "./util";

const MAX_TAGS_PER_NOTE = 50;
const TAG_MAX_LEN = 64;

/**
 * Extract inline #tags from note content (Obsidian-style):
 *  - code fences and inline code are stripped first (no false positives)
 *  - a tag must contain at least one letter (so "#2026" alone is not a tag)
 *  - trailing slashes are trimmed; names are lowercased and deduped
 */
export function extractTags(content: string): string[] {
  const stripped = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");

  const out = new Set<string>();
  for (const m of stripped.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu)) {
    const raw = m[1] ?? "";
    if (!/\p{L}/u.test(raw)) continue;
    const tag = raw.replace(/\/+$/g, "").slice(0, TAG_MAX_LEN).toLowerCase();
    if (tag) out.add(tag);
    if (out.size >= MAX_TAGS_PER_NOTE) break;
  }
  return [...out];
}

/** Replace a note's tag links: upsert tag rows, then re-link. */
export async function syncNoteTags(
  db: D1Database,
  accountId: string,
  noteId: string,
  tags: string[],
): Promise<void> {
  const ts = Date.now();
  const stmts: D1PreparedStatement[] = [db.prepare(`DELETE FROM note_tags WHERE note_id = ?1`).bind(noteId)];
  for (const name of tags) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO tags (id, account_id, name, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(account_id, name) DO NOTHING`,
        )
        .bind(newId(), accountId, name, ts),
    );
  }
  await db.batch(stmts);
  if (tags.length === 0) return;

  const placeholders = tags.map((_, i) => `?${i + 2}`).join(", ");
  const { results } = await db
    .prepare(`SELECT id FROM tags WHERE account_id = ?1 AND name IN (${placeholders})`)
    .bind(accountId, ...tags)
    .all<{ id: string }>();
  const rows = results ?? [];
  if (rows.length === 0) return;
  await db.batch(
    rows.map((r) =>
      db
        .prepare(`INSERT INTO note_tags (note_id, tag_id) VALUES (?1, ?2) ON CONFLICT(note_id, tag_id) DO NOTHING`)
        .bind(noteId, r.id),
    ),
  );
}

export async function fetchNoteTags(db: D1Database, accountId: string, noteId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT t.name AS name
         FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ?1 AND t.account_id = ?2
        ORDER BY t.name
        LIMIT 100`,
    )
    .bind(noteId, accountId)
    .all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}
