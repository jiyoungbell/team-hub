-- Lists open without signing in: created_by and updated_by are set only when the person was
-- signed in. SQLite can't drop NOT NULL in place, so the table is rebuilt.
CREATE TABLE slists_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  songs TEXT NOT NULL,            -- JSON {key: {title, sec, melon?, artist?, cover?}}
  items TEXT NOT NULL,            -- JSON array of song keys, in play order
  version INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
INSERT INTO slists_new (id, name, songs, items, version, created_by, updated_by, updated_at)
  SELECT id, name, songs, items, version, created_by, updated_by, updated_at FROM slists;
DROP TABLE slists;
ALTER TABLE slists_new RENAME TO slists;
CREATE INDEX slists_updated ON slists(updated_at);
