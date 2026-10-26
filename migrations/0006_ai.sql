-- M6: AI embeddings for semantic search
-- Stores per-note embedding vectors in D1 (JSON text).
-- Cosine similarity computed in Worker JS (brute-force, fine for <1000 notes).

CREATE TABLE note_embeddings (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  vector TEXT NOT NULL, -- JSON array of numbers
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
