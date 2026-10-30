/** Pure SQL builders for the notes list and the tag list (unit-tested against the real migrations). */

export interface NoteListQuery {
  accountId: string;
  trash?: boolean;
  archived?: boolean;
  folderId?: string | null;
  tag?: string | null;
}

export function normalizeTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^#+/, "").toLowerCase();
  return t ? t.slice(0, 64) : null;
}

export function buildNoteListQuery(q: NoteListQuery, listCols: string): { sql: string; params: (string | number | null)[] } {
  const clauses = [
    "account_id = ?1",
    q.trash ? "deleted_at IS NOT NULL" : q.archived ? "deleted_at IS NULL AND archived = 1" : "deleted_at IS NULL AND archived = 0",
  ];
  const params: (string | number | null)[] = [q.accountId];
  if (q.folderId) {
    params.push(q.folderId);
    clauses.push(`folder_id = ?${params.length}`);
  }
  const tag = normalizeTag(q.tag);
  if (tag) {
    params.push(tag);
    clauses.push(
      `id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.account_id = ?1 AND t.name = ?${params.length})`,
    );
  }
  const order = q.trash ? "deleted_at DESC" : "pinned DESC, updated_at DESC";
  const sql = `SELECT ${listCols}, substr(content, 1, 160) AS excerpt
       FROM notes
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${order}
      LIMIT 500`;
  return { sql, params };
}

/** Tags with the number of live (not trashed, not archived) notes using them. */
export const TAG_LIST_SQL = `SELECT t.name AS name, COUNT(*) AS count
       FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id
       JOIN notes n ON n.id = nt.note_id
      WHERE t.account_id = ?1 AND n.account_id = ?1 AND n.deleted_at IS NULL AND n.archived = 0
      GROUP BY t.id
      ORDER BY count DESC, t.name
      LIMIT 200`;
