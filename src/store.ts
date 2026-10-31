import { signal } from "@preact/signals";
import { api, ApiError } from "./api";
import type { Account, Folder, NoteMeta, SettingsMap, TagCount } from "./api";
import { setLocale } from "./i18n";
import type { Locale } from "./i18n";
import { setTheme } from "./theme";
import type { Theme } from "./theme";
import { cacheNoteLocally, enqueueNoteWrite, enqueueFolderWrite, syncPendingWrites } from "./sync";
import { wipeCaches, wipeLocalData } from "./privacy";

export const booting = signal(true);
export const account = signal<Account | null>(null);
export const settings = signal<SettingsMap>({});
export const folders = signal<Folder[]>([]);
export const notes = signal<NoteMeta[]>([]);
export const activeNoteId = signal<string | null>(null);
export const activeFolderId = signal<string | null>(null);
export const tags = signal<TagCount[]>([]);
export const activeTag = signal<string | null>(null);
export const trashMode = signal(false);
export const online = signal(navigator.onLine);

function applySettings(map: SettingsMap): void {
  settings.value = map ?? {};
  const loc = settings.value.locale;
  if (loc === "zh-TW" || loc === "en") setLocale(loc as Locale);
  const th = settings.value.theme;
  if (th === "light" || th === "dark" || th === "system") setTheme(th as Theme);
}

export async function refreshLists(): Promise<void> {
  const [notesRes, foldersRes, tagsRes] = await Promise.all([
    api.listNotes(trashMode.value ? { trash: true } : { folderId: activeFolderId.value, tag: activeTag.value }),
    api.listFolders(),
    api.listTags().catch(() => null), // tags are a convenience: never let them break the main lists
  ]);
  notes.value = notesRes.notes;
  folders.value = foldersRes.folders;
  if (tagsRes) {
    tags.value = tagsRes.tags;
    // The selected tag vanished (its last note was edited/deleted): fall back to all notes.
    if (activeTag.value && !tagsRes.tags.some((t) => t.name === activeTag.value)) {
      activeTag.value = null;
      return refreshLists(); // reload without the stale filter
    }
  }
}

export async function boot(): Promise<void> {
  try {
    const me = await api.me();
    account.value = me.account;
    applySettings(me.settings);
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Session gone: make sure no private API data lingers in CacheStorage.
      // (Queued offline writes are kept so they can still sync after re-login.)
      void wipeCaches();
    } else {
      console.error("boot failed", err);
    }
    account.value = null;
  } finally {
    booting.value = false;
  }
}

export async function login(username: string, password: string): Promise<void> {
  const res = await api.login(username, password);
  account.value = res.account;
  applySettings(res.settings);
  await refreshLists();
}

export async function logout(): Promise<void> {
  // Push out queued offline edits first (best effort, max 3 s) so wiping the
  // device does not lose work that could still be saved.
  try {
    await Promise.race([syncPendingWrites(), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    /* ignore */
  }
  try {
    await api.logout();
  } catch (err) {
    console.error("logout request failed", err);
  } finally {
    // Leave the app immediately; never let a stuck cleanup keep the user signed in on screen.
    account.value = null;
    notes.value = [];
    folders.value = [];
    tags.value = [];
    activeTag.value = null;
    activeNoteId.value = null;
    activeFolderId.value = null;
    trashMode.value = false;
  }
  await Promise.race([wipeLocalData(), new Promise((r) => setTimeout(r, 2000))]);
}

export async function selectFolder(id: string | null): Promise<void> {
  activeFolderId.value = id;
  activeTag.value = null; // folder and tag are alternative scopes
  trashMode.value = false;
  await refreshLists();
}

/** Show the notes carrying `name`; selecting the active tag again (or null) clears the filter. */
export async function selectTag(name: string | null): Promise<void> {
  activeTag.value = name && name !== activeTag.value ? name : null;
  activeFolderId.value = null;
  trashMode.value = false;
  await refreshLists();
}

export async function selectTrash(): Promise<void> {
  trashMode.value = true;
  activeTag.value = null;
  await refreshLists();
}

export async function createNote(): Promise<void> {
  try {
    const res = await api.createNote({ folder_id: trashMode.value ? null : activeFolderId.value });
    await refreshLists();
    activeNoteId.value = res.note.id;
    // Cache locally.
    if (account.value) {
      await cacheNoteLocally(res.note, account.value.id);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      // If offline, create a local-only note.
      if (!navigator.onLine) {
        const localNote: NoteMeta = {
          id: crypto.randomUUID(),
          folder_id: trashMode.value ? null : activeFolderId.value,
          title: "",
          version: 1,
          favorite: 0,
          pinned: 0,
          archived: 0,
          deleted_at: null,
          purge_at: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        notes.value = [localNote, ...notes.value];
        activeNoteId.value = localNote.id;
        await enqueueNoteWrite("POST", null, { folder_id: localNote.folder_id });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
}

export async function createFolder(name: string): Promise<void> {
  try {
    await api.createFolder(name, null);
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && !navigator.onLine) {
      const localFolder: Folder = {
        id: crypto.randomUUID(),
        parent_id: null,
        name,
        sort_order: folders.value.length,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      folders.value = [...folders.value, localFolder];
      await enqueueFolderWrite("POST", null, { name, parent_id: null });
    } else {
      throw err;
    }
  }
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  try {
    await api.patchFolder(id, { name: clean });
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && !navigator.onLine) {
      folders.value = folders.value.map((f) => (f.id === id ? { ...f, name: clean } : f));
      await enqueueFolderWrite("PATCH", id, { name: clean });
    } else {
      throw err;
    }
  }
}

export async function removeFolder(id: string): Promise<void> {
  try {
    await api.deleteFolder(id);
    if (activeFolderId.value === id) activeFolderId.value = null;
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && !navigator.onLine) {
      folders.value = folders.value.filter((f) => f.id !== id);
      await enqueueFolderWrite("DELETE", id, null);
    } else {
      throw err;
    }
  }
}

export async function trashNote(id: string): Promise<void> {
  try {
    await api.deleteNote(id);
    if (activeNoteId.value === id) activeNoteId.value = null;
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && !navigator.onLine) {
      notes.value = notes.value.map((n) =>
        n.id === id ? { ...n, deleted_at: Date.now(), purge_at: Date.now() + 30 * 24 * 60 * 60 * 1000 } : n,
      );
      if (activeNoteId.value === id) activeNoteId.value = null;
      await enqueueNoteWrite("DELETE", id, null);
    } else {
      throw err;
    }
  }
}

export async function restoreNote(id: string): Promise<void> {
  try {
    await api.restoreNote(id);
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && !navigator.onLine) {
      notes.value = notes.value.map((n) =>
        n.id === id ? { ...n, deleted_at: null, purge_at: null } : n,
      );
      await enqueueNoteWrite("POST", `${id}/restore`, null);
    } else {
      throw err;
    }
  }
}

export async function purgeNote(id: string): Promise<void> {
  try {
    await api.deleteNote(id, true);
    if (activeNoteId.value === id) activeNoteId.value = null;
    await refreshLists();
  } catch (err) {
    if (err instanceof ApiError && !navigator.onLine) {
      notes.value = notes.value.filter((n) => n.id !== id);
      if (activeNoteId.value === id) activeNoteId.value = null;
      await enqueueNoteWrite("DELETE", `${id}?permanent=1`, null);
    } else {
      throw err;
    }
  }
}

export function updateNoteMeta(meta: NoteMeta): void {
  notes.value = notes.value.map((n) => (n.id === meta.id ? { ...n, ...meta } : n));
}

export async function persistSettings(patch: SettingsMap): Promise<void> {
  const res = await api.putSettings(patch);
  settings.value = res.settings;
}

export async function changeLocale(next: Locale): Promise<void> {
  setLocale(next);
  if (account.value) {
    try {
      await persistSettings({ locale: next });
    } catch {
      /* offline: keep local-only */
    }
  }
}

export async function changeTheme(next: Theme): Promise<void> {
  setTheme(next);
  if (account.value) {
    try {
      await persistSettings({ theme: next });
    } catch {
      /* offline: keep local-only */
    }
  }
}
