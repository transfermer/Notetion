import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { relTime } from "../i18n";
import { refreshLists, updateNoteMeta } from "../store";

interface Props {
  noteId: string | null;
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

interface Version {
  id: string;
  version: number;
  title: string;
  content: string;
  source: string;
  created_at: number;
}

export function VersionHistory(props: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (props.open && props.noteId) {
      setLoading(true);
      setVersions([]);
      setSelectedVersion(null);
      api
        .getNoteVersions(props.noteId)
        .then((res) => {
          setVersions(res.versions);
          if (res.versions.length > 0) setSelectedVersion(res.versions[0]);
        })
        .catch((err) => console.error("load versions failed", err))
        .finally(() => setLoading(false));
    }
  }, [props.open, props.noteId]);

  async function restoreVersion(version: number) {
    if (!props.noteId) return;
    try {
      const res = await api.restoreNoteVersion(props.noteId, version);
      updateNoteMeta(res.note);
      void refreshLists();
      props.onRestored?.();
      props.onClose();
    } catch (err) {
      console.error("restore version failed", err);
    }
  }

  if (!props.open) return null;

  return (
    <div class="version-history-overlay" onClick={props.onClose}>
      <div class="version-history" onClick={(e) => e.stopPropagation()}>
        <div class="version-header">
          <h2>Version History</h2>
          <button class="btn ghost small" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="version-body">
          <div class="version-list">
            {loading && <div class="version-loading">Loading…</div>}
            {!loading && versions.length === 0 && <div class="version-empty">No versions yet</div>}
            {versions.map((v) => (
              <button
                key={v.id}
                class={`version-item ${selectedVersion?.id === v.id ? "selected" : ""}`}
                onClick={() => setSelectedVersion(v)}
              >
                <div class="version-title">v{v.version} — {v.title || "(untitled)"}</div>
                <div class="version-meta">
                  {relTime(v.created_at)} · {v.source}
                </div>
              </button>
            ))}
          </div>

          <div class="version-preview">
            {selectedVersion ? (
              <>
                <div class="version-preview-header">
                  <h3>{selectedVersion.title || "(untitled)"}</h3>
                  <div class="version-preview-meta">
                    v{selectedVersion.version} · {relTime(selectedVersion.created_at)}
                  </div>
                </div>
                <pre class="version-preview-content">{selectedVersion.content}</pre>
                <div class="version-actions">
                  <button
                    class="btn primary small"
                    onClick={() => restoreVersion(selectedVersion.version)}
                  >
                    Restore this version
                  </button>
                </div>
              </>
            ) : (
              <div class="version-empty">Select a version to preview</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
