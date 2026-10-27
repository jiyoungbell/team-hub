-- Streaming lists (슴리). The songs travel inside the list, so a song typed in before release
-- is one entry that every row of it points at. Open without signing in: created_by and
-- updated_by are set only when the person was signed in.
CREATE TABLE slists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  songs TEXT NOT NULL,            -- JSON {key: {title, sec, melon?, artist?, cover?}}
  items TEXT NOT NULL,            -- JSON array of song keys, in play order
  version INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
CREATE INDEX slists_updated ON slists(updated_at);
