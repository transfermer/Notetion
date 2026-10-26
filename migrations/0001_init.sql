-- Notetion schema v1 (M0)
-- Timestamps are Unix epoch milliseconds (INTEGER). Ids are TEXT (crypto.randomUUID()).

-- The sole admin account is created lazily on first successful login
-- (credentials come from ADMIN_USERNAME / ADMIN_PASSWORD env).
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Session tokens are stored hashed (SHA-256); raw token only lives in the cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_account ON sessions(account_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Multi-level folders with fractional sort_order for drag-drop reordering (M1).
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_folders_account ON folders(account_id, parent_id, sort_order);

-- Notes: soft-delete (trash) + purge deadline; `version` drives optimistic concurrency.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  favorite INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  purge_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_account ON notes(account_id, deleted_at, updated_at DESC);
CREATE INDEX idx_notes_folder ON notes(account_id, folder_id);

-- Version history snapshots (written on content-changing updates; retention policy in M2).
CREATE TABLE note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'edit',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_note_versions_note ON note_versions(note_id, version DESC);

-- Tags (extraction from note bodies arrives in M1/M2).
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

-- Per-account key/value settings (locale, theme, accent, ...).
CREATE TABLE settings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);
