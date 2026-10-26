-- M4: wiki links, backlinks, block references, embeds
-- Track wiki links between notes for backlinks and graph view.

CREATE TABLE wiki_links (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  target_title TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'wiki', -- 'wiki', 'block', 'embed'
  block_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_wiki_links_source ON wiki_links(source_note_id);
CREATE INDEX idx_wiki_links_target ON wiki_links(target_note_id);
CREATE INDEX idx_wiki_links_title ON wiki_links(target_title);

-- Block-level content for block references and embeds.
CREATE TABLE note_blocks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL, -- ^block-id from markdown
  block_type TEXT NOT NULL, -- 'paragraph', 'heading', 'list', 'code', 'quote', 'callout', 'math', 'mermaid'
  content TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(note_id, block_id)
);
CREATE INDEX idx_note_blocks_note ON note_blocks(note_id);
CREATE INDEX idx_note_blocks_block_id ON note_blocks(block_id);
