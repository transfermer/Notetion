import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { openNoteInActive } from "../panes";

interface Props {
  noteId: string | null;
}

interface Backlink {
  id: string;
  title: string;
  link_type: string;
}

export function BacklinksPanel(props: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!props.noteId) {
      setBacklinks([]);
      return;
    }

    setLoading(true);
    api
      .getBacklinks(props.noteId)
      .then((res) => setBacklinks(res.backlinks))
      .catch((err) => console.error("load backlinks failed", err))
      .finally(() => setLoading(false));
  }, [props.noteId]);

  if (!props.noteId) return null;

  return (
    <div class="backlinks-panel">
      <div class="panel-header">
        <h3> Backlinks</h3>
      </div>
      <div class="backlinks-list">
        {loading && <div class="panel-loading">Loading…</div>}
        {!loading && backlinks.length === 0 && <div class="panel-empty">No backlinks yet</div>}
        {backlinks.map((b) => (
          <button
            key={b.id}
            class="backlink-item"
            onClick={() => {
              openNoteInActive(b.id);
            }}
          >
            <span class="backlink-icon">{b.link_type === "embed" ? "📥" : b.link_type === "block" ? "📎" : "🔗"}</span>
            <span class="backlink-title">{b.title || "(untitled)"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
