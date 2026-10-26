import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { openNoteInActive } from "../panes";
import { refreshLists } from "../store";
import { signal } from "@preact/signals";
import { snippetToSafeHtml } from "../snippet";

// Global toggle for semantic search (persisted in localStorage).
const SEMANTIC_KEY = "notetion.semantic_search";
let initialSemantic = false;
try {
  initialSemantic = localStorage.getItem(SEMANTIC_KEY) === "1";
} catch {}
export const semanticSearchEnabled = signal<boolean>(initialSemantic);

function setSemanticEnabled(v: boolean) {
  semanticSearchEnabled.value = v;
  try {
    localStorage.setItem(SEMANTIC_KEY, v ? "1" : "0");
  } catch {}
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Result = {
  type: "note" | "folder" | "tag" | "action";
  id?: string;
  title?: string;
  name?: string;
  snippet?: string;
  note_count?: number;
  score?: number;
  source?: string;
  updated_at?: number;
  action?: () => void;
};

export function CommandPalette(props: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (props.open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        let res;
        if (semanticSearchEnabled.value) {
          // Use hybrid search (keyword + semantic).
          res = await api.hybridSearch(query.trim(), 20);
        } else {
          // Use keyword-only search.
          res = await api.search(query.trim(), "all", 20);
        }

        const mapped: Result[] = (res.results as any[]).map((r) => {
          // Handle both keyword search results (with type field) and hybrid results (with source field).
          const isNoteResult = r.type === "note" || r.source === "keyword" || r.source === "semantic" || r.source === "hybrid";
          if (isNoteResult) {
            return {
              type: "note" as const,
              id: String(r.id ?? ""),
              title: String(r.title ?? ""),
              snippet: r.snippet ? String(r.snippet) : undefined,
              score: r.score as number | undefined,
              source: r.source as string | undefined,
              updated_at: typeof r.updated_at === "number" ? r.updated_at : undefined,
              action: () => {
                const noteId = String(r.id ?? "");
                if (noteId) {
                  openNoteInActive(noteId);
                  void api.recordRecent(noteId);
                  void refreshLists();
                }
                props.onClose();
              },
            };
          }
          if (r.type === "folder") {
            return {
              type: "folder" as const,
              id: String(r.id ?? ""),
              name: String(r.name ?? ""),
              updated_at: typeof r.updated_at === "number" ? r.updated_at : undefined,
            };
          }
          if (r.type === "tag") {
            return {
              type: "tag" as const,
              id: String(r.id ?? ""),
              name: String(r.name ?? ""),
              note_count: Number(r.note_count ?? 0),
              updated_at: typeof r.updated_at === "number" ? r.updated_at : undefined,
            };
          }
          return { type: "note" as const, id: String(r.id ?? ""), title: String(r.title ?? "") };
        });
        // Sort: notes first (by updated_at DESC), then folders, then tags.
        mapped.sort((a, b) => {
          const typeOrder: Record<string, number> = { note: 0, folder: 1, tag: 2 };
          const ta = typeOrder[a.type] ?? 99;
          const tb = typeOrder[b.type] ?? 99;
          if (ta !== tb) return ta - tb;
          const ua = a.updated_at ?? 0;
          const ub = b.updated_at ?? 0;
          return ub - ua; // newest first
        });
        setResults(mapped);
        setSelectedIndex(0);
      } catch (err) {
        console.error("search failed", err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, props.open]);

  useEffect(() => {
    if (!props.open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        props.onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected?.action) selected.action();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, results, selectedIndex]);

  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (selected) selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!props.open) return null;

  return (
    <div class="command-palette-overlay" onClick={props.onClose}>
      <div class="command-palette" onClick={(e) => e.stopPropagation()}>
        <div class="command-header">
          <input
            ref={inputRef}
            class="command-input"
            type="text"
            placeholder={semanticSearchEnabled.value ? "Semantic search…" : "Search notes, folders, tags…"}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <button
            class={`btn ghost small ${semanticSearchEnabled.value ? "on" : ""}`}
            title="Toggle semantic search (requires Workers AI)"
            onClick={() => setSemanticEnabled(!semanticSearchEnabled.value)}
          >
            🧠
          </button>
        </div>
        <div ref={listRef} class="command-results">
          {results.length === 0 && query.trim() && (
            <div class="command-empty">No results</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id ?? r.name}-${i}`}
              class={`command-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => r.action?.()}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span class="command-icon">
                {r.type === "note" ? "📄" : r.type === "folder" ? "📁" : r.type === "tag" ? "🏷️" : ""}
              </span>
              <div class="command-content">
                <div class="command-title">
                  {r.title ?? r.name}
                  {r.source && r.source !== "keyword" && (
                    <span class={`source-badge source-${r.source}`}>{r.source}</span>
                  )}
                </div>
                {r.snippet && (
                  <div class="command-snippet" dangerouslySetInnerHTML={{ __html: snippetToSafeHtml(r.snippet) }} />
                )}
                {r.note_count !== undefined && (
                  <div class="command-meta">{r.note_count} notes</div>
                )}
              </div>
            </button>
          ))}
        </div>
        <div class="command-hints">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
