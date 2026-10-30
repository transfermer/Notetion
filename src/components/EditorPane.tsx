import { useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import type { Note } from "../api";
import { folders, refreshLists, trashNote, updateNoteMeta } from "../store";
import { relTime, t } from "../i18n";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { PreviewPane } from "./PreviewPane";
import { OutlinePanel } from "./OutlinePanel";
import { VersionHistory } from "./VersionHistory";
import { BacklinksPanel } from "./BacklinksPanel";
import { ShareManager } from "./ShareManager";
import { cycleLayout, dualPane, setDualPane, type PaneState } from "../panes";
import { AutosaveController, type SaveState, type SavedNote } from "../autosave";
import { signal } from "@preact/signals";

interface Props {
  pane: PaneState;
  focusMode: boolean;
  typewriterMode: boolean;
}

const jumpToLine = signal<number | null>(null);

/** Refresh the sidebar list at most once per few seconds while typing. */
let listRefreshTimer: number | undefined;
function refreshListsSoon(): void {
  if (listRefreshTimer !== undefined) return;
  listRefreshTimer = window.setTimeout(() => {
    listRefreshTimer = undefined;
    void refreshLists().catch(() => undefined);
  }, 3000);
}

/** A 409 from PATCH /api/notes/:id carries the server's current note. */
function conflictFrom(err: unknown): SavedNote | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const n = (err.data as { note?: Note } | null)?.note;
  return n && typeof n.version === "number" ? { version: n.version, title: n.title, content: n.content } : null;
}

/**
 * NOTE: EditorPane is keyed by noteId in <Workspace>, so one instance always
 * edits exactly one note. All save state lives in AutosaveController (not in
 * render closures), and the latest text lives in `textRef`.
 */
export function EditorPane(props: Props) {
  const noteId = props.pane.noteId;
  const layout = props.pane.layout;

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const ctrlRef = useRef<AutosaveController | null>(null);
  const textRef = useRef({ title: "", content: "" });
  const noteRef = useRef<Note | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef(false);

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShareManager, setShowShareManager] = useState(false);

  // Keep refs in sync.
  noteRef.current = note;

  function adoptSaved(saved: Note): void {
    setNote(saved);
    updateNoteMeta(saved);
    refreshListsSoon();
  }

  // Load note on selection change or reload tick.
  useEffect(() => {
    // A reload means "take the server's version": drop the controller and any draft.
    ctrlRef.current?.discardMine();
    ctrlRef.current?.dispose();
    ctrlRef.current = null;
    setSaveState("idle");
    setLoadError(false);
    if (!noteId) {
      setNote(null);
      return;
    }
    let cancelled = false;
    api
      .getNote(noteId)
      .then((res) => {
        if (cancelled) return;
        const n = res.note;
        setNote(n);
        setTitle(n.title);
        setContent(n.content);
        textRef.current = { title: n.title, content: n.content };
        ctrlRef.current = new AutosaveController(
          { version: n.version, title: n.title, content: n.content },
          {
            save: async (patch, keepalive) => {
              const r = await api.patchNote(n.id, patch, { keepalive });
              adoptSaved(r.note);
              return r.note;
            },
            asConflict: conflictFrom,
            onState: setSaveState,
          },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setNote(null);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, reloadTick]);

  // Never lose pending edits: flush when the tab is hidden/closed and when this pane unmounts.
  useEffect(() => {
    const flushNow = () => void ctrlRef.current?.flush(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibility);
      ctrlRef.current?.dispose(); // flushes pending edits
      ctrlRef.current = null;
    };
  }, []);

  function onTitleInput(value: string): void {
    textRef.current = { ...textRef.current, title: value };
    setTitle(value);
    ctrlRef.current?.update(value, textRef.current.content);
  }

  function onContentChange(value: string): void {
    textRef.current = { ...textRef.current, content: value };
    setContent(value);
    ctrlRef.current?.update(textRef.current.title, value);
  }

  function reloadFromServer(): void {
    setReloadTick((v) => v + 1);
  }

  async function toggleFlag(flag: "favorite" | "pinned") {
    const ctrl = ctrlRef.current;
    const current = noteRef.current;
    if (!ctrl || !current) return;
    const nextValue = current[flag] ? 0 : 1;
    setNote({ ...current, [flag]: nextValue }); // optimistic
    try {
      // Runs with autosave paused, then adopts the bumped server version.
      const saved = await ctrl.exclusive(async () => {
        const res = await api.patchNote(current.id, { [flag]: nextValue, base_version: ctrl.version });
        return res.note;
      });
      setNote((prev) => (prev ? { ...prev, [flag]: saved[flag], version: saved.version, updated_at: saved.updated_at } : prev));
      updateNoteMeta(saved);
      refreshListsSoon();
    } catch (err) {
      setNote(current); // revert
      if (conflictFrom(err) || (err instanceof ApiError && err.status === 409)) setSaveState("conflict");
    }
  }

  async function moveToFolder(folderId: string | null) {
    const ctrl = ctrlRef.current;
    const current = noteRef.current;
    if (!ctrl || !current || (current.folder_id ?? null) === folderId) return;
    setNote({ ...current, folder_id: folderId }); // optimistic
    try {
      const saved = await ctrl.exclusive(async () => {
        const res = await api.patchNote(current.id, { folder_id: folderId, base_version: ctrl.version });
        return res.note;
      });
      setNote((prev) => (prev ? { ...prev, folder_id: saved.folder_id, version: saved.version, updated_at: saved.updated_at } : prev));
      updateNoteMeta(saved);
      refreshListsSoon();
    } catch (err) {
      setNote(current); // revert
      if (conflictFrom(err) || (err instanceof ApiError && err.status === 409)) setSaveState("conflict");
    }
  }

  async function trashCurrent() {
    await ctrlRef.current?.flush(); // don't leave unsaved edits behind a deleted note
    if (note) await trashNote(note.id);
  }

  // ---- Sync scroll (editor <-> preview) ----
  function onEditorScroll() {
    if (!syncScroll || layout !== "split") return;
    if (scrollLockRef.current) return;
    scrollLockRef.current = true;
    const ed = editorScrollRef.current;
    const pv = previewScrollRef.current;
    if (ed && pv) {
      const max = ed.scrollHeight - ed.clientHeight;
      const ratio = max > 0 ? ed.scrollTop / max : 0;
      const pmax = pv.scrollHeight - pv.clientHeight;
      pv.scrollTop = pmax * ratio;
    }
    requestAnimationFrame(() => {
      scrollLockRef.current = false;
    });
  }

  function onPreviewScroll() {
    if (!syncScroll || layout !== "split") return;
    if (scrollLockRef.current) return;
    scrollLockRef.current = true;
    const ed = editorScrollRef.current;
    const pv = previewScrollRef.current;
    if (ed && pv) {
      const max = pv.scrollHeight - pv.clientHeight;
      const ratio = max > 0 ? pv.scrollTop / max : 0;
      const emax = ed.scrollHeight - ed.clientHeight;
      ed.scrollTop = emax * ratio;
    }
    requestAnimationFrame(() => {
      scrollLockRef.current = false;
    });
  }

  const inTrash = note?.deleted_at !== null;
  const saveLabel =
    saveState === "saving"
      ? t("saving")
      : saveState === "saved"
        ? t("saved")
        : saveState === "error"
          ? t("saveError")
          : saveState === "conflict"
            ? t("conflict")
            : "";

  const showEditor = layout === "edit" || layout === "split";
  const showPreview = layout === "preview" || layout === "split";

  if (!noteId) {
    return (
      <div class="editor-pane">
        <div class="editor-empty">
          <div class="editor-empty-mark">📝</div>
          <p>{t("noSelection")}</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div class="editor-pane">
        <div class="editor-empty">
          <p>{t("loadError")}</p>
          <button class="btn small" onClick={() => reloadFromServer()}>
            {t("conflictReload")}
          </button>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div class="editor-pane">
        <div class="editor-empty">
          <p>{t("saving")}</p>
        </div>
      </div>
    );
  }

  return (
    <div class="editor-pane">
      <div class="editor-toolbar">
        <span class={`save-state ${saveState}`}>{saveLabel}</span>
        {saveState === "conflict" && (
          <>
            <button class="btn ghost small" onClick={() => reloadFromServer()}>
              {t("conflictReload")}
            </button>
            <button class="btn ghost small" onClick={() => void ctrlRef.current?.keepMine()}>
              {t("conflictKeepMine")}
            </button>
          </>
        )}
        <div class="toolbar-spacer" />
        <button
          class="btn ghost small"
          title={`Layout: ${layout}`}
          onClick={() => cycleLayout(props.pane.id as "left" | "right")}
        >
          {layout === "edit" ? "✎" : layout === "split" ? "⇔" : "◉"}
        </button>
        {props.pane.id === "left" ? (
          <button
            class={`btn ghost small ${dualPane.value ? "on" : ""}`}
            title={dualPane.value ? "Close second pane" : "Open second pane (side by side)"}
            onClick={() => setDualPane(!dualPane.value)}
          >
            ◫
          </button>
        ) : (
          <button class="btn ghost small" title="Close this pane" onClick={() => setDualPane(false)}>
            ✕
          </button>
        )}
        {showEditor && (
          <button class={`btn ghost small ${showOutline ? "on" : ""}`} title="Outline" onClick={() => setShowOutline((v) => !v)}>
            ☰
          </button>
        )}
        {!inTrash && (
          <>
            <select
              class="folder-select"
              title={t("moveToFolder")}
              value={note.folder_id ?? ""}
              onChange={(e) => void moveToFolder(e.currentTarget.value || null)}
            >
              <option value="">{t("noFolder")}</option>
              {folders.value.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button class="btn ghost small" title="Share" onClick={() => setShowShareManager(true)}>
              🔗
            </button>
            <button class="btn ghost small" title="Version history" onClick={() => void (ctrlRef.current?.flush() ?? Promise.resolve()).then(() => setShowVersionHistory(true))}>
              🕒
            </button>
            <button class="btn ghost small" title={t("favorite")} onClick={() => void toggleFlag("favorite")}>
              {note.favorite ? "★" : "☆"}
            </button>
            <button class="btn ghost small" title={t("pin")} onClick={() => void toggleFlag("pinned")}>
              {note.pinned ? "📌" : "📍"}
            </button>
            <button
              class="btn ghost small danger"
              onClick={() => {
                if (confirm(t("deleteConfirm"))) void trashCurrent();
              }}
            >
              {t("deleteNote")}
            </button>
          </>
        )}
      </div>

      <input
        class="title-input"
        value={title}
        placeholder={t("titlePlaceholder")}
        disabled={inTrash}
        onInput={(e) => {
          onTitleInput(e.currentTarget.value);
        }}
      />

      <div class="editor-body">
        {showEditor && (
          <div ref={editorScrollRef} class={`editor-col ${showPreview ? "half" : "full"}`} onScroll={onEditorScroll}>
            <CodeMirrorEditor
              value={content}
              onChange={onContentChange}
              readonly={inTrash}
              typewriter={props.typewriterMode}
              jumpToLine={jumpToLine.value}
            />
          </div>
        )}
        {showPreview && (
          <div ref={previewScrollRef} class={`preview-col ${showEditor ? "half" : "full"}`} onScroll={onPreviewScroll}>
            <PreviewPane source={content} />
          </div>
        )}
        {showOutline && showEditor && (
          <div class="outline-col">
            <OutlinePanel
              source={content}
              onJumpToLine={(line) => {
                jumpToLine.value = line;
                setTimeout(() => {
                  jumpToLine.value = null;
                }, 100);
              }}
            />
          </div>
        )}
      </div>

      <div class="editor-status">
        <span>
          {t("versionPrefix")} v{note.version}
        </span>
        <span>
          {t("updatedPrefix")} {relTime(note.updated_at)}
        </span>
        <span>{t("charCount", { n: content.length })}</span>
        <div class="toolbar-spacer" />
        {showPreview && showEditor && (
          <label class="sync-scroll-toggle">
            <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.currentTarget.checked)} />
            sync scroll
          </label>
        )}
      </div>

      <BacklinksPanel noteId={noteId} />
      <VersionHistory
        noteId={noteId}
        open={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        onRestored={() => {
          setShowVersionHistory(false);
          reloadFromServer();
        }}
      />
      <ShareManager noteId={noteId} open={showShareManager} onClose={() => setShowShareManager(false)} />
    </div>
  );
}
