-- M2: full-text search via FTS5 + version history retention + recents
-- FTS5 virtual table for notes (content + title).
-- D1 supports FTS5; we use the `unicode61` tokenizer with `remove_diacritics=2`
-- which handles CJK reasonably (character-by-character, no stemming).
-- For better CJK segmentation, a future migration can switch to `trigram`.

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content,
  content=notes,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS in sync with the notes table.
CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

-- Backfill FTS for existing notes.
INSERT INTO notes_fts(rowid, title, content)
  SELECT rowid, title, content FROM notes;

-- Version history retention: keep up to 50 snapshots per note.
-- Older snapshots are purged by the daily cron (see worker/cron.ts).
CREATE TABLE note_version_retention (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  max_versions INTEGER NOT NULL DEFAULT 50
);

-- Recents: track last-viewed notes per account (top 20).
CREATE TABLE recents (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, note_id)
);
CREATE INDEX idx_recents_account ON recents(account_id, viewed_at DESC);
