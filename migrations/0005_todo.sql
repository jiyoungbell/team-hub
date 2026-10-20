-- A copy of the Notion TODO data source, replaced as a whole on every sync.
-- Dates are KST: YYYY-MM-DD, or YYYY-MM-DDTHH:MM when the date has a time.
CREATE TABLE todo_items (
  page_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT,
  teams TEXT NOT NULL,            -- JSON array
  assignees TEXT NOT NULL,        -- JSON array of Notion names
  category TEXT,
  due_start TEXT,
  due_end TEXT,
  stage TEXT,
  next_action TEXT,
  memo TEXT,
  basis TEXT,
  started TEXT,
  first_seen TEXT,
  done_on TEXT,
  hub_change TEXT,
  url TEXT NOT NULL,
  edited_at TEXT NOT NULL
);

CREATE TABLE todo_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  synced_at INTEGER,
  syncing_at INTEGER,
  failed_at INTEGER,
  error TEXT,
  options TEXT                    -- JSON {statuses, teams, assignees} from the data source schema
);
INSERT INTO todo_meta (id) VALUES (1);

CREATE TABLE todo_changes (
  id INTEGER PRIMARY KEY,
  page_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,        -- the nickname at the time
  from_status TEXT,
  to_status TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX todo_changes_page ON todo_changes(page_id, at);

-- Notion assignee name -> hub user, where the Discord nickname doesn't match.
CREATE TABLE todo_people (
  notion_name TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id)
);

-- "My teams" from settings. Not part of the profile team-gate syncs, so updated_at stays.
ALTER TABLE users ADD COLUMN teams TEXT;
