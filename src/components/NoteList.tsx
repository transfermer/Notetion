import { activeFolderId, activeTag, folders, notes, trashMode } from "../store";
import { relTime, t } from "../i18n";
import { leftPane, openNoteInActive, rightPane, dualPane } from "../panes";
import { noteListCollapsed, setNoteListCollapsed } from "../layout";

/** Middle column: the notes of the selected folder / tag / trash. Collapsible to a thin rail. */
export function NoteList() {
  if (noteListCollapsed.value) {
    return (
      <aside class="notelist collapsed">
        <button class="btn ghost small" title={t("showNoteList")} onClick={() => setNoteListCollapsed(false)}>
          ›
        </button>
      </aside>
    );
  }

  const openIds = new Set<string | null>([leftPane.value.noteId, dualPane.value ? rightPane.value.noteId : null]);
  const scope = trashMode.value
    ? t("trash")
    : activeTag.value
      ? `#${activeTag.value}`
      : activeFolderId.value
        ? (folders.value.find((f) => f.id === activeFolderId.value)?.name ?? t("notesLabel"))
        : t("allNotes");

  return (
    <aside class="notelist">
      <div class="notelist-head">
        <span class="notelist-title" title={scope}>
          {scope} <span class="notelist-count">{notes.value.length}</span>
        </span>
        <button class="btn ghost small" title={t("hideNoteList")} onClick={() => setNoteListCollapsed(true)}>
          ‹
        </button>
      </div>

      <div class="note-list">
        {notes.value.length === 0 && <div class="empty">{trashMode.value ? t("noNotesTrash") : t("noNotes")}</div>}
        {notes.value.map((n) => (
          <button
            key={n.id}
            class={openIds.has(n.id) ? "note-item active" : "note-item"}
            draggable={!trashMode.value}
            onDragStart={(e) => {
              e.dataTransfer?.setData("text/plain", n.id);
            }}
            onClick={() => openNoteInActive(n.id)}
          >
            <span class="note-title">
              {n.pinned ? "📌 " : ""}
              {n.archived ? "🗄 " : ""}
              {n.title || t("untitled")}
            </span>
            <span class="note-time">{relTime(trashMode.value && n.deleted_at ? n.deleted_at : n.updated_at)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
