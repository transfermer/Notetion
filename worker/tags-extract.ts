/** Pure inline-#tag extraction (no imports, unit-tested). */

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
    .replace(/`[^`\n]*`/g, "")
    .replace(/\[\[[^\]]*\]\]/g, " ") // [[wikilinks]] (incl. [[Note#Heading]])
    .replace(/\bhttps?:\/\/\S+/gi, " ") // URLs (#fragment)
    .replace(/\]\([^)]*\)/g, "]( )"); // markdown link targets

  const out = new Set<string>();
  // The `#` must start the text or follow whitespace/punctuation — not a word character (a&#39;, foo#bar).
  for (const m of stripped.matchAll(/(?<![\p{L}\p{N}_&])#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu)) {
    const raw = m[1] ?? "";
    if (/^[0-9a-f]{3,8}$/i.test(raw) && /^\d/.test(raw)) continue; // hex colours like #1a2b3c
    if (!/\p{L}/u.test(raw)) continue;
    const tag = raw.replace(/\/+$/g, "").slice(0, TAG_MAX_LEN).toLowerCase();
    if (tag) out.add(tag);
    if (out.size >= MAX_TAGS_PER_NOTE) break;
  }
  return [...out];
}
