import { useState } from "preact/hooks";
import {
  account,
  activeFolderId,
  activeTag,
  changeLocale,
  changeTheme,
  createFolder,
  createNote,
  folders,
  logout,
  removeFolder,
  renameFolder,
  selectFolder,
  selectTag,
  tags,
  selectTrash,
  trashMode,
} from "../store";
import { locale, t } from "../i18n";
import { theme } from "../theme";
import { focusMode, typewriterMode } from "./Workspace";
import { api } from "../api";
import { GraphView } from "./GraphView";
import { ExportManager } from "./ExportManager";
import { BackupManager } from "./BackupManager";
import { SettingsPanel } from "./SettingsPanel";
import { VersionNotices } from "./VersionNotices";

interface SidebarProps {
  onShowApiKeys?: () => void;
}

export function Sidebar(props: SidebarProps) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [showGraph, setShowGraph] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotices, setShowNotices] = useState(false);

  async function submitFolder(e: Event) {
    e.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    await createFolder(name);
    setFolderName("");
    setAddingFolder(false);
  }

  function nextTheme(): "light" | "dark" | "system" {
    return theme.value === "dark" ? "light" : theme.value === "light" ? "system" : "dark";
  }

  async function onDropFolder(folderId: string | null, noteId: string) {
    try {
      await api.patchNote(noteId, { folder_id: folderId });
      const res = await api.getNote(noteId);
      const { updateNoteMeta } = await import("../store");
      updateNoteMeta(res.note);
      void (await import("../store")).refreshLists();
    } catch (err) {
      console.error("drop failed", err);
    }
  }

  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <span class="brand">Notetion</span>
        <button class="btn primary small" onClick={() => void createNote()} disabled={trashMode.value}>
          + {t("newNote")}
        </button>
      </div>

      <div class="sidebar-scroll">
      <div class="section-label">
        <span>{t("folders")}</span>
        <button class="btn ghost tiny" title={t("newFolder")} onClick={() => setAddingFolder((v) => !v)}>
          +
        </button>
      </div>

      {addingFolder && (
        <form class="folder-form" onSubmit={submitFolder}>
          <input
            value={folderName}
            placeholder={t("folderNamePrompt")}
            autoFocus
            onInput={(e) => setFolderName(e.currentTarget.value)}
            onBlur={() => {
              if (!folderName.trim()) setAddingFolder(false);
            }}
          />
        </form>
      )}

      <nav class="folder-list">
        <button
          class={!trashMode.value && activeFolderId.value === null && activeTag.value === null ? "scope active" : "scope"}
          onClick={() => void selectFolder(null)}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const noteId = e.dataTransfer?.getData("text/plain");
            if (noteId) void onDropFolder(null, noteId);
          }}
        >
          🗂️ {t("allNotes")}
        </button>

        {folders.value.map((f) => (
          <div
            class="folder-row"
            key={f.id}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const noteId = e.dataTransfer?.getData("text/plain");
              if (noteId) void onDropFolder(f.id, noteId);
            }}
          >
            <button
              class={!trashMode.value && activeFolderId.value === f.id ? "scope active" : "scope"}
              onClick={() => void selectFolder(f.id)}
            >
              📁 <span class="folder-name">{f.name}</span>
            </button>
            <button
              class="scope-del"
              title={t("renameFolder")}
              onClick={() => {
                const next = prompt(t("folderRenamePrompt"), f.name);
                if (next && next.trim() && next.trim() !== f.name) void renameFolder(f.id, next);
              }}
            >
              ✎
            </button>
            <button
              class="scope-del"
              title={t("deleteNote")}
              onClick={() => {
                if (confirm(t("folderDeleteConfirm", { name: f.name }))) void removeFolder(f.id);
              }}
            >
              ×
            </button>
          </div>
        ))}

        <button class={trashMode.value ? "scope active" : "scope"} onClick={() => void selectTrash()}>
          ️ {t("trash")}
        </button>
      </nav>

      <div class="section-label">
        <span>{t("tags")}</span>
      </div>
      <div class="tag-list">
        {tags.value.length === 0 && <div class="empty tiny">{t("noTags")}</div>}
        {tags.value.map((tg) => (
          <button
            key={tg.name}
            class={!trashMode.value && activeTag.value === tg.name ? "tag-chip active" : "tag-chip"}
            onClick={() => void selectTag(tg.name)}
          >
            #{tg.name} <span class="tag-count">{tg.count}</span>
          </button>
        ))}
      </div>
      </div>

      <footer class="sidebar-foot">
        <div class="foot-user">
          <span class="who" title={account.value?.username}>
            {account.value?.username}
          </span>
          <button class="btn small" onClick={() => void logout()}>
            {t("signOut")}
          </button>
        </div>
        <div class="foot-btns">
          <button
            class="btn ghost small"
            title={t("language")}
            onClick={() => void changeLocale(locale.value === "zh-TW" ? "en" : "zh-TW")}
          >
            {locale.value === "zh-TW" ? "EN" : "中"}
          </button>
          <button class="btn ghost small" title={t("theme")} onClick={() => void changeTheme(nextTheme())}>
            {theme.value === "dark" ? "🌙" : theme.value === "light" ? "☀️" : "🖥️"}
          </button>
          <button
            class={`btn ghost small ${focusMode.value ? "on" : ""}`}
            title="Focus mode"
            onClick={() => (focusMode.value = !focusMode.value)}
          >
            🎯
          </button>
          <button
            class={`btn ghost small ${typewriterMode.value ? "on" : ""}`}
            title="Typewriter mode"
            onClick={() => (typewriterMode.value = !typewriterMode.value)}
          >
            ⌨️
          </button>
          <button
            class={`btn ghost small ${showGraph ? "on" : ""}`}
            title="Graph view"
            onClick={() => setShowGraph((v) => !v)}
          >
            ️
          </button>
          <button
            class="btn ghost small"
            title="API Keys"
            onClick={() => props.onShowApiKeys?.()}
          >
            
          </button>
          <button
            class="btn ghost small"
            title="Export"
            onClick={() => setShowExport(true)}
          >
            📤
          </button>
          <button
            class="btn ghost small"
            title="Backups"
            onClick={() => setShowBackup(true)}
          >
            💾
          </button>
          <button
            class="btn ghost small"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            ⚙️
          </button>
          <button
            class="btn ghost small"
            title="What's New"
            onClick={() => setShowNotices(true)}
          >
            📢
          </button>
        </div>
      </footer>
      {showGraph && (
        <div class="graph-overlay" onClick={() => setShowGraph(false)}>
          <div class="graph-modal" onClick={(e) => e.stopPropagation()}>
            <div class="graph-header">
              <h2>Knowledge Graph</h2>
              <button class="btn ghost small" onClick={() => setShowGraph(false)}>
                ✕
              </button>
            </div>
            <GraphView />
          </div>
        </div>
      )}
      <ExportManager open={showExport} onClose={() => setShowExport(false)} />
      <BackupManager open={showBackup} onClose={() => setShowBackup(false)} />
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <VersionNotices
        currentVersion="0.9.0"
        open={showNotices}
        onClose={() => setShowNotices(false)}
      />
    </aside>
  );
}
