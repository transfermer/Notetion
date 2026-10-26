/**
 * Safe rendering of search-result snippets.
 *
 * Snippets come from the server in two shapes:
 *  1. FTS5 `snippet()` → raw note text with literal `<mark>…</mark>` markers
 *     (note text itself is NOT escaped by SQLite);
 *  2. plain `substr()` excerpts of raw markdown (LIKE / hybrid results).
 *
 * Both contain arbitrary user text, so the ONLY safe way to put them in
 * innerHTML is: escape everything, then re-enable exactly the `<mark>` markers.
 * (Never "decode entities" — that turns note text into live markup.)
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Remove markdown syntax so excerpts read as plain text. */
export function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/^[\s]+|[\s]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML string that is safe for `dangerouslySetInnerHTML`. */
export function snippetToSafeHtml(raw: string): string {
  if (!raw) return "";
  const hasMarks = /<mark>[\s\S]*?<\/mark>/.test(raw);
  // Markdown stripping is skipped for FTS snippets: it is already a short window
  // around the match and stripping could eat characters next to the markers.
  const text = hasMarks ? raw : stripMarkdown(raw);
  return escapeHtml(text).replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
}
