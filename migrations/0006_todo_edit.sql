-- Hub changes are no longer only status changes: adds, edits, deletes and restores are kept too.
-- field: status | create | title | assignees | teams | due | delete | restore
CREATE TABLE todo_changes_new (
  id INTEGER PRIMARY KEY,
  page_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,        -- the nickname at the time
  field TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  at INTEGER NOT NULL
);
INSERT INTO todo_changes_new (id, page_id, user_id, user_name, field, from_value, to_value, at)
  SELECT id, page_id, user_id, user_name, 'status', from_status, to_status, at FROM todo_changes;
DROP TABLE todo_changes;
ALTER TABLE todo_changes_new RENAME TO todo_changes;
CREATE INDEX todo_changes_page ON todo_changes(page_id, at);
-- The sync leaves pages changed since it started alone, and pages show the latest changes.
CREATE INDEX todo_changes_at ON todo_changes(at);
