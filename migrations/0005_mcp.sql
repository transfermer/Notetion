-- M5: API keys, OAuth 2.1 + PKCE, MCP endpoints
-- API keys for programmatic access (ink_... prefix).

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT 'read', -- JSON array: ["read","write","delete","trash"]
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER, -- NULL = never expires
  revoked_at INTEGER
);
CREATE INDEX idx_api_keys_account ON api_keys(account_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- OAuth 2.1 clients (third-party applications).
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, name)
);

-- OAuth authorization codes (short-lived, single-use).
CREATE TABLE oauth_codes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  code_challenge TEXT NOT NULL, -- PKCE S256 challenge
  scope TEXT NOT NULL DEFAULT 'read',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL -- 10 minutes
);
CREATE INDEX idx_oauth_codes_hash ON oauth_codes(code_hash);

-- OAuth access tokens (long-lived, refreshable).
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'read',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, -- 24 hours
  refresh_expires_at INTEGER NOT NULL -- 30 days
);
CREATE INDEX idx_oauth_tokens_access ON oauth_tokens(access_token_hash);
CREATE INDEX idx_oauth_tokens_refresh ON oauth_tokens(refresh_token_hash);

-- OAuth grants (audit log of authorized clients).
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(client_id, account_id)
);
CREATE INDEX idx_oauth_grants_account ON oauth_grants(account_id);

-- MCP request log (audit trail for API access).
CREATE TABLE mcp_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  oauth_token_id TEXT REFERENCES oauth_tokens(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_mcp_requests_account ON mcp_requests(account_id, created_at DESC);
