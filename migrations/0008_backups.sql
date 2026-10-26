-- M8: off-site backups
-- Backup configurations and history.

CREATE TABLE backup_configs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'webdav' or 's3'
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule TEXT, -- cron expression, NULL = manual only
  encryption_key_hash TEXT NOT NULL, -- encrypted by CredentialVault
  config_json TEXT NOT NULL, -- encrypted by CredentialVault
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, name)
);
CREATE INDEX idx_backup_configs_account ON backup_configs(account_id);

CREATE TABLE backup_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  config_id TEXT NOT NULL REFERENCES backup_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'pending', 'running', 'completed', 'failed'
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  bytes_uploaded INTEGER NOT NULL DEFAULT 0,
  notes_backed_up INTEGER NOT NULL DEFAULT 0,
  files_backed_up INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_backup_history_account ON backup_history(account_id, created_at DESC);
CREATE INDEX idx_backup_history_config ON backup_history(config_id);
