-- M7: public sharing & export
-- Public share links with optional passphrase and expiry.

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE, -- public URL slug
  passphrase_hash TEXT, -- NULL = no passphrase
  expires_at INTEGER, -- NULL = never expires
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, note_id)
);
CREATE INDEX idx_shares_slug ON shares(slug);
CREATE INDEX idx_shares_account ON shares(account_id);

-- Export jobs (async ZIP generation for large notes).
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  format TEXT NOT NULL, -- 'json', 'zip', 'markdown'
  note_ids TEXT, -- JSON array of note IDs, NULL = all
  kv_key TEXT, -- KV key for the exported file
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_export_jobs_account ON export_jobs(account_id, created_at DESC);
