-- Assignee names set by hand on the admin page: added to the pick list (hidden = 0), or kept off it (hidden = 1).
CREATE TABLE todo_roster (
  name TEXT PRIMARY KEY,
  hidden INTEGER NOT NULL
);
