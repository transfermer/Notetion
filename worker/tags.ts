import { newId } from "./util";
import { extractTags } from "./tags-extract";

export { extractTags };

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
