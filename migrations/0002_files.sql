-- M1: attachments — binary blobs live in FILES_KV; metadata here.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  kv_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'attachment',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_files_account ON files(account_id, created_at DESC);
CREATE INDEX idx_files_note ON files(note_id);
