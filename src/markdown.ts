import MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-latex";
import katex from "katex";
import "katex/dist/katex.min.css"; // bundled locally (was a CDN link at a different version than the installed katex)

/**
 * Safe markdown renderer.
 *
 * SECURITY: `html: false` means raw user HTML is escaped, so stored-XSS via
 * note content is not possible. All custom syntax (wikilinks, callouts, math,
 * mermaid) is implemented as markdown-it rules whose renderers ESCAPE user
 * content or emit library-generated (trusted) markup only.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    // Return "" to fall back to default escaping; we override fence below for mermaid.
    const grammar = lang && Prism.languages[lang];
    if (grammar) {
      try {
        return Prism.highlight(str, grammar, lang);
      } catch {
        /* fall through */
      }
    }
    return "";
  },
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- Strip Obsidian comments %%...%% (core rule BEFORE normalize) ----
md.core.ruler.before("normalize", "strip_comments", (state) => {
  state.src = state.src.replace(/%%[\s\S]*?%%/g, "");
});

// ---- WikiLinks [[target]] / [[target|alias]] / [[target#^block]] / ![[embed]] ----
function wikiLinkInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== "[") return false;
  const embed = src[start + 1] === "!";
  const openIdx = embed ? start + 2 : start + 1;
  if (src[openIdx] !== "[") return false;
  const close = src.indexOf("]]", openIdx + 1);
  if (close === -1) return false;

  const inner = src.slice(openIdx + 1, close);
  if (!silent) {
    const token = state.push("wiki_link", "a", 0);
    token.content = inner;
    token.meta = { embed };
  }
  state.pos = close + 2;
  return true;
}
md.inline.ruler.before("link", "wiki_link", wikiLinkInline);

md.renderer.rules.wiki_link = (tokens, idx) => {
  const inner = tokens[idx].content;
  const embed = tokens[idx].meta?.embed;
  let target = inner;
  let alias: string | undefined;
  let blockId: string | undefined;
  const blockMatch = inner.match(/^(.*?)#(\^[A-Za-z0-9\-]+)$/);
  if (blockMatch) {
    target = blockMatch[1];
    blockId = blockMatch[2];
  }
  const aliasMatch = target.match(/^([^|]+)\|(.+)$/);
  if (aliasMatch) {
    target = aliasMatch[1];
    alias = aliasMatch[2];
  }
  const display = alias || target || "(untitled)";
  const cls = embed ? "wiki-link wiki-embed" : "wiki-link";
  const blockAttr = blockId ? ` data-block-id="${esc(blockId)}"` : "";
  return `<a href="#" class="${cls}" data-target="${esc(target)}"${blockAttr}>${esc(display)}</a>`;
};

// ---- Inline math $...$ ----
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== "$") return false;
  if (src[start + 1] === "$") return false; // block math handled elsewhere
  const close = src.indexOf("$", start + 1);
  if (close === -1 || close === start + 1) return false;
  const formula = src.slice(start + 1, close);
  if (!silent) {
    const token = state.push("math_inline", "span", 0);
    token.content = formula;
  }
  state.pos = close + 1;
  return true;
}
md.inline.ruler.before("escape", "math_inline", mathInline);
md.renderer.rules.math_inline = (tokens, idx) => {
  try {
    return katex.renderToString(tokens[idx].content, { throwOnError: false });
  } catch {
    return `<code>${esc(tokens[idx].content)}</code>`;
  }
};

// ---- Block math $$...$$ ----
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const lineText = state.src.slice(startPos, state.eMarks[startLine]);
  if (!lineText.startsWith("$$")) return false;
  // Single-line $$...$$?
  if (lineText.length > 2 && lineText.endsWith("$$") && lineText.length >= 4) {
    if (silent) return true;
    const token = state.push("math_block", "div", 0);
    token.content = lineText.slice(2, -2);
    state.line = startLine + 1;
    return true;
  }
  let next = startLine + 1;
  const buf: string[] = [];
  while (next < endLine) {
    const t = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
    if (t.trim() === "$$") break;
    buf.push(t);
    next++;
  }
  if (next >= endLine) return false;
  if (silent) return true;
  const token = state.push("math_block", "div", 0);
  token.content = buf.join("\n");
  state.line = next + 1;
  return true;
}
md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "blockquote"] });
md.renderer.rules.math_block = (tokens, idx) => {
  try {
    return `<div class="katex-block">${katex.renderToString(tokens[idx].content, { displayMode: true, throwOnError: false })}</div>`;
  } catch {
    return `<pre class="katex-error">${esc(tokens[idx].content)}</pre>`;
  }
};

// ---- Callouts: > [!type] title ----
function calloutBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const lineText = state.src.slice(startPos, state.eMarks[startLine]);
  const m = lineText.match(/^>\s*\[!([a-z]+)\]\s*(.*)$/i);
  if (!m) return false;
  if (silent) return true;

  const type = m[1].toLowerCase();
  const title = m[2].trim();
  const bodyLines: string[] = [];
  let next = startLine + 1;
  while (next < endLine) {
    const p = state.bMarks[next] + state.tShift[next];
    const t = state.src.slice(p, state.eMarks[next]);
    if (!t.startsWith(">")) break;
    bodyLines.push(t.replace(/^>\s?/, ""));
    next++;
  }

  const open = state.push("callout_open", "div", 1);
  open.meta = { type, title };
  const body = state.push("callout_body", "div", 0);
  body.content = bodyLines.join("\n");
  state.push("callout_close", "div", -1);
  state.line = next;
  return true;
}
md.block.ruler.before("blockquote", "callout", calloutBlock, { alt: ["paragraph", "blockquote"] });
md.renderer.rules.callout_open = (tokens, idx) => {
  const { type, title } = tokens[idx].meta as { type: string; title: string };
  const safeType = /^[a-z]+$/.test(type) ? type : "note";
  const titleHtml = title ? `<div class="callout-title">${esc(title)}</div>` : "";
  return `<div class="callout callout-${safeType}">${titleHtml}<div class="callout-body">`;
};
md.renderer.rules.callout_body = (tokens, idx) => md.render(tokens[idx].content);
md.renderer.rules.callout_close = () => `</div></div>`;

// ---- Mermaid fence: emit escaped source in a container (client hydrates later) ----
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const info = (tokens[idx].info || "").trim().toLowerCase();
  if (info === "mermaid") {
    return `<div class="mermaid-block" data-mermaid="${esc(tokens[idx].content)}"><pre class="mermaid-source">${esc(tokens[idx].content)}</pre></div>`;
  }
  if (defaultFence) return defaultFence(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

// ---- Task lists: - [ ] / - [x] ----
const originalListItemOpen = md.renderer.rules.list_item_open;
md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
  const next = tokens[idx + 1];
  let out = originalListItemOpen ? originalListItemOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  if (next && next.type === "inline" && next.content) {
    const m = next.content.match(/^\[([ xX])\]\s*/);
    if (m) {
      const checked = m[1].toLowerCase() === "x";
      next.content = next.content.slice(m[0].length);
      if (next.children && next.children.length) next.children.shift();
      out = out.replace(/<li>/, `<li class="task-item"><input type="checkbox" disabled${checked ? " checked" : ""}> `);
    }
  }
  return out;
};

export function renderMarkdown(source: string): string {
  return md.render(source);
}

export interface HeadingNode {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  line: number;
}

export function extractHeadings(source: string): HeadingNode[] {
  const tokens = md.parse(source, {});
  const out: HeadingNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === "heading_open") {
      const level = Number(tk.tag.slice(1)) as HeadingNode["level"];
      const inline = tokens[i + 1];
      const text = inline?.content ?? "";
      const line = tk.map ? tk.map[0] + 1 : 0;
      out.push({ level, text, line });
    }
  }
  return out;
}
