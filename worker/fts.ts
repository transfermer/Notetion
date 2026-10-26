/**
 * Shared keyword search used by /api/search, /api/search/hybrid and /mcp/search.
 *
 * Why this exists: the three endpoints each had their own copy of the FTS query,
 * and only one had been made safe. Problems solved here, once:
 *  - user text must never reach `MATCH` raw (FTS5 syntax errors / operators);
 *  - SQLite's `unicode61` tokenizer does NOT split CJK, so a Chinese substring
 *    query returns 0 FTS rows without any error → add a LIKE substring scan;
 *  - LIKE wildcards (% _) typed by the user must be escaped.
 */

/** Minimal structural type of D1Database (so this module is testable without Workers types). */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T = unknown>(): Promise<{ results?: T[] }> };
  };
}

export interface KeywordHit {
  id: string;
  title: string;
  folder_id: string | null;
  version: number;
  favorite: number;
  pinned: number;
  archived: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  /** FTS hits: raw text with literal <mark>…</mark>. LIKE hits: raw markdown excerpt. NOT HTML-safe. */
  snippet: string | null;
}

const CJK_RE = /[㐀-䶿一-鿿぀-ヿ가-힯]/;
const MAX_TOKENS = 8;

export function containsCJK(s: string): boolean {
  return CJK_RE.test(s);
}

function tokens(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
}

/**
 * Turn raw user input into a safe FTS5 MATCH expression: every whitespace
 * separated token becomes a quoted phrase (AND-ed). Plain alphanumeric tokens
 * get a prefix wildcard ("not" → "not"*) so search-as-you-type works.
 * Returns null when there is nothing searchable.
 */
export function ftsSafeQuery(q: string): string | null {
  const parts = tokens(q).map((tok) => {
    const quoted = `"${tok.replace(/"/g, '""')}"`;
    return /^[\p{L}\p{N}_]+$/u.test(tok) && !containsCJK(tok) ? `${quoted}*` : quoted;
  });
  return parts.length ? parts.join(" ") : null;
}

/** Escape LIKE wildcards; pair with `ESCAPE '\'`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

const COLS = `n.id, n.title, n.folder_id, n.version, n.favorite, n.pinned, n.archived,
                n.deleted_at, n.created_at, n.updated_at`;

export async function keywordSearch(
  db: D1Like,
  accountId: string,
  q: string,
  limit: number,
): Promise<KeywordHit[]> {
  const toks = tokens(q.trim());
  if (toks.length === 0) return [];

  const hits: KeywordHit[] = [];
  const seen = new Set<string>();
  const add = (rows: KeywordHit[] | undefined) => {
    for (const r of rows ?? []) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        hits.push(r);
      }
    }
  };

  let ftsFailed = false;
  const fts = ftsSafeQuery(q);
  if (fts) {
    try {
      const { results } = await db
        .prepare(
          `SELECT ${COLS},
                  snippet(notes_fts, 1, '<mark>', '</mark>', '…', 24) AS snippet
             FROM notes_fts
             JOIN notes n ON n.rowid = notes_fts.rowid
            WHERE notes_fts MATCH ?1 AND n.account_id = ?2 AND n.deleted_at IS NULL
            ORDER BY rank
            LIMIT ?3`,
        )
        .bind(fts, accountId, limit)
        .all<KeywordHit>();
      add(results);
    } catch (err) {
      ftsFailed = true;
      console.error("fts search failed", err);
    }
  }

  // Substring scan: needed for CJK (no word boundaries) and as a fallback if FTS errored.
  if (containsCJK(q) || ftsFailed) {
    const conds = toks
      .map((_, i) => `(n.title LIKE ?${i + 4} ESCAPE '\\' OR n.content LIKE ?${i + 4} ESCAPE '\\')`)
      .join(" AND ");
    const { results } = await db
      .prepare(
        `SELECT ${COLS},
                substr(n.content, max(1, instr(lower(n.content), lower(?2)) - 40), 100) AS snippet
           FROM notes n
          WHERE n.account_id = ?1 AND n.deleted_at IS NULL AND ${conds}
          ORDER BY n.updated_at DESC
          LIMIT ?3`,
      )
      .bind(accountId, toks[0], limit, ...toks.map((t) => `%${escapeLike(t)}%`))
      .all<KeywordHit>();
    add(results);
  }

  return hits.slice(0, limit);
}
