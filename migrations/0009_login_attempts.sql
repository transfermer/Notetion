-- Failed-login log used for per-IP rate limiting (cleaned up by the cron job).
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, attempted_at);
