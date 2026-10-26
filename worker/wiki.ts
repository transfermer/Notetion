/**
 * Wiki-link parser: extracts [[links]], ![[embeds]], block refs [[#^id]],
 * block IDs (^id at end of line), and Obsidian comments (%%...%%).
 */

export interface WikiLink {
  type: "wiki" | "embed" | "block";
  target: string; // note title or empty for self-ref
  alias?: string;
  blockId?: string;
  raw: string;
  startIndex: number;
  endIndex: number;
}

export interface BlockId {
  blockId: string;
  line: number;
  startIndex: number;
  endIndex: number;
}

export interface WikiParseResult {
  links: WikiLink[];
  blockIds: BlockId[];
}

/**
 * Parse wiki links and block IDs from markdown content.
 */
export function parseWikiLinks(content: string): WikiParseResult {
  const links: WikiLink[] = [];
  const blockIds: BlockId[] = [];

  // Match ![[...]] (embeds) and [[...]] (links).
  const linkRegex = /(!?)\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(content)) !== null) {
    const isEmbed = match[1] === "!";
    const inner = match[2];
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    // Parse inner: "title", "title|alias", "#^blockId", "title#^blockId"
    let target = inner;
    let alias: string | undefined;
    let blockId: string | undefined;

    // Check for block ref: #^blockId
    const blockMatch = inner.match(/^(.*?)#(\^[a-zA-Z0-9\-]+)$/);
    if (blockMatch) {
      target = blockMatch[1] || "";
      blockId = blockMatch[2];
    }

    // Check for alias: title|alias
    const aliasMatch = target.match(/^([^\|]+)\|(.+)$/);
    if (aliasMatch) {
      target = aliasMatch[1];
      alias = aliasMatch[2];
    }

    links.push({
      type: isEmbed ? "embed" : blockId ? "block" : "wiki",
      target: target.trim(),
      alias,
      blockId,
      raw: match[0],
      startIndex,
      endIndex,
    });
  }

  // Match block IDs at end of lines: ^block-id
  const blockIdRegex = /\s+\^([a-zA-Z0-9\-]+)\s*$/gm;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockIdRegex.exec(content)) !== null) {
    const line = content.substring(0, blockMatch.index).split("\n").length;
    blockIds.push({
      blockId: blockMatch[1],
      line,
      startIndex: blockMatch.index,
      endIndex: blockMatch.index + blockMatch[0].length,
    });
  }

  return { links, blockIds };
}

/**
 * Strip Obsidian-style comments (%%...%%) from content.
 */
export function stripComments(content: string): string {
  return content.replace(/%%[\s\S]*?%%/g, "");
}

/**
 * Extract callouts from markdown.
 * Callouts: > [!type] title\n> content
 * Returns array of { type, title, content }.
 */
export interface Callout {
  type: string;
  title: string;
  content: string;
  line: number;
}

export function extractCallouts(content: string): Callout[] {
  const callouts: Callout[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const calloutMatch = line.match(/^>\s*\[!([a-z]+)\]\s*(.*)$/i);

    if (calloutMatch) {
      const type = calloutMatch[1].toLowerCase();
      const title = calloutMatch[2].trim();
      const startLine = i + 1;
      const contentLines: string[] = [];
      i++;

      // Collect continuation lines (starting with >).
      while (i < lines.length && lines[i].startsWith(">") && !lines[i].match(/^>\s*\[!/)) {
        contentLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }

      callouts.push({
        type,
        title,
        content: contentLines.join("\n"),
        line: startLine,
      });
    } else {
      i++;
    }
  }

  return callouts;
}

/**
 * Extract front matter from markdown (YAML between --- delimiters).
 */
export interface FrontMatter {
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

export function extractFrontMatter(content: string): { frontMatter: FrontMatter | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontMatter: null, body: content };

  try {
    // Simple YAML parser for common fields.
    const yaml = match[1];
    const frontMatter: FrontMatter = {};
    const lines = yaml.split("\n");

    for (const line of lines) {
      const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        let value: unknown = kvMatch[2].trim();

        // Parse arrays: [tag1, tag2]
        if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
          value = value
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""));
        }
        // Parse booleans.
        else if (value === "true") value = true;
        else if (value === "false") value = false;
        // Parse numbers.
        else if (!isNaN(Number(value))) value = Number(value);
        // Strip quotes.
        else if (typeof value === "string" && (value.startsWith('"') || value.startsWith("'"))) {
          value = value.slice(1, -1);
        }

        frontMatter[key] = value;
      }
    }

    return { frontMatter, body: match[2] };
  } catch {
    return { frontMatter: null, body: content };
  }
}
