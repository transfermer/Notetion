/** Typed fetch wrapper for the Notetion JSON API (same-origin, cookie session). */

export interface Account {
  id: string;
  username: string;
  role: string;
}

export interface NoteMeta {
  id: string;
  folder_id: string | null;
  title: string;
  version: number;
  favorite: number;
  pinned: number;
  archived: number;
  deleted_at: number | null;
  purge_at: number | null;
  created_at: number;
  updated_at: number;
  excerpt?: string;
}

export interface Note extends NoteMeta {
  content: string;
}

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export type SettingsMap = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${status}`;
    super(msg);
    this.status = status;
    this.data = data;
  }
}

interface RequestSpec {
  method?: string;
  json?: unknown;
  /** Let the request outlive the page (pagehide flush). Browsers cap keepalive bodies at 64 KB. */
  keepalive?: boolean;
}

async function request<T>(path: string, spec: RequestSpec = {}): Promise<T> {
  const hasJson = spec.json !== undefined;
  const body = hasJson ? JSON.stringify(spec.json) : undefined;
  const res = await fetch(path, {
    method: spec.method ?? "GET",
    headers: hasJson ? { "Content-Type": "application/json" } : undefined,
    body,
    credentials: "same-origin",
    keepalive: spec.keepalive && (body?.length ?? 0) < 60_000 ? true : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>("/api/health"),

  login: (username: string, password: string) =>
    request<{ account: Account; settings: SettingsMap; seeded: boolean }>("/api/auth/login", {
      method: "POST",
      json: { username, password },
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ account: Account; settings: SettingsMap }>("/api/auth/me"),

  listNotes: (opts: { trash?: boolean; folderId?: string | null } = {}) => {
    const qs = new URLSearchParams();
    if (opts.trash) qs.set("trash", "1");
    else if (opts.folderId) qs.set("folder_id", opts.folderId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ notes: NoteMeta[] }>(`/api/notes${suffix}`);
  },
  getNote: (id: string) => request<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`),
  createNote: (input: { title?: string; content?: string; folder_id?: string | null }) =>
    request<{ note: Note }>("/api/notes", { method: "POST", json: input }),
  patchNote: (id: string, patch: Record<string, unknown>, opts: { keepalive?: boolean } = {}) =>
    request<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: patch,
      keepalive: opts.keepalive,
    }),
  deleteNote: (id: string, permanent = false) =>
    request<{ ok: boolean }>(`/api/notes/${encodeURIComponent(id)}${permanent ? "?permanent=1" : ""}`, {
      method: "DELETE",
    }),
  restoreNote: (id: string) =>
    request<{ ok: boolean }>(`/api/notes/${encodeURIComponent(id)}/restore`, { method: "POST" }),

  listFolders: () => request<{ folders: Folder[] }>("/api/folders"),
  createFolder: (name: string, parentId: string | null = null) =>
    request<{ folder: Folder }>("/api/folders", { method: "POST", json: { name, parent_id: parentId } }),
  patchFolder: (id: string, patch: Record<string, unknown>) =>
    request<{ folder: Folder }>(`/api/folders/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
  deleteFolder: (id: string) =>
    request<{ ok: boolean }>(`/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getSettings: () => request<{ settings: SettingsMap }>("/api/settings"),
  putSettings: (patch: SettingsMap) =>
    request<{ settings: SettingsMap }>("/api/settings", { method: "PUT", json: patch }),

  search: (q: string, type: "all" | "notes" | "folders" | "tags" = "all", limit = 50) => {
    const qs = new URLSearchParams({ q, type, limit: String(limit) });
    return request<{ results: Array<Record<string, unknown> & { type: string }> }>(`/api/search?${qs.toString()}`);
  },
  hybridSearch: (q: string, limit = 20) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return request<{ results: Array<{ id: string; title: string; score: number; source: string }> }>(`/api/search/hybrid?${qs.toString()}`);
  },
  getNoteVersions: (noteId: string) =>
    request<{ versions: Array<{ id: string; version: number; title: string; content: string; source: string; created_at: number }> }>(
      `/api/notes/${encodeURIComponent(noteId)}/versions`,
    ),
  restoreNoteVersion: (noteId: string, version: number) =>
    request<{ note: Note }>(`/api/notes/${encodeURIComponent(noteId)}/versions/${version}/restore`, { method: "POST" }),
  getBacklinks: (noteId: string) =>
    request<{ backlinks: Array<{ id: string; title: string; link_type: string }> }>(
      `/api/notes/${encodeURIComponent(noteId)}/backlinks`,
    ),
  getGraph: () =>
    request<{ nodes: Array<{ id: string; title: string }>; edges: Array<{ source: string; target: string; type: string }> }>(
      "/api/graph",
    ),
  getRecents: () => request<{ recents: NoteMeta[] }>("/api/recents"),
  recordRecent: (noteId: string) =>
    request<{ ok: boolean }>(`/api/recents/${encodeURIComponent(noteId)}`, { method: "POST" }),

  // API Keys
  getApiKeys: () =>
    request<{ keys: Array<{ id: string; name: string; permissions: string[]; created_at: number; last_used_at: number | null; expires_at: number | null; revoked_at: number | null }> }>(
      "/api/api-keys",
    ),
  createApiKey: (body: { name: string; permissions: string[]; expires_in_days?: number | null }) =>
    request<{ key: { id: string; name: string; permissions: string[]; created_at: number; last_used_at: number | null; expires_at: number | null; revoked_at: number | null; token: string } }>(
      "/api/api-keys",
      { method: "POST", json: body },
    ),
  revokeApiKey: (id: string) =>
    request<{ ok: boolean }>(`/api/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Shares
  getShares: () =>
    request<{ shares: Array<{ id: string; note_id: string; slug: string; has_passphrase: boolean; expires_at: number | null; view_count: number; created_at: number; note_title: string }> }>(
      "/api/shares",
    ),
  createShare: (body: { note_id: string; passphrase?: string; expires_in_days?: number }) =>
    request<{ share: { id: string; note_id: string; slug: string; has_passphrase: boolean; expires_at: number | null; created_at: number } }>(
      "/api/shares",
      { method: "POST", json: body },
    ),
  deleteShare: (id: string) =>
    request<{ ok: boolean }>(`/api/shares/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Export
  // Markdown comes back as plain text; request() would try to JSON-parse it and lose the content.
  exportNotes: async (format: "json" | "markdown" | "zip", note_ids?: string[]): Promise<unknown> => {
    if (format !== "markdown") return request<unknown>("/api/export", { method: "POST", json: { format, note_ids } });
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, note_ids }),
      credentials: "same-origin",
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, { error: text.slice(0, 200) });
    return text;
  },

  // Backups
  getBackupConfigs: () =>
    request<{ configs: Array<{ id: string; type: "webdav" | "s3"; name: string; enabled: number; schedule: string | null; created_at: number; updated_at: number }> }>(
      "/api/backups/configs",
    ),
  createBackupConfig: (body: { type: "webdav" | "s3"; name: string; config: unknown; schedule?: string }) =>
    request<{ config: { id: string; type: string; name: string; enabled: number; schedule: string | null; created_at: number; updated_at: number } }>(
      "/api/backups/configs",
      { method: "POST", json: body },
    ),
  deleteBackupConfig: (id: string) =>
    request<{ ok: boolean }>(`/api/backups/configs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runBackup: (config_id: string) =>
    request<{ ok: boolean; backup_id: string; bytes: number }>(
      "/api/backups/run",
      { method: "POST", json: { config_id } },
    ),
  getBackupHistory: () =>
    request<{ history: Array<{ id: string; config_id: string; config_name: string; status: string; started_at: number; completed_at: number | null; bytes_uploaded: number; notes_backed_up: number; files_backed_up: number; error: string | null; created_at: number }> }>(
      "/api/backups/history",
    ),
};
