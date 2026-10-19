-- Times are Unix milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- Discord user id
  name TEXT NOT NULL,             -- server nickname, falling back to the global name
  avatar TEXT NOT NULL,
  refresh_token TEXT,             -- AES-GCM sealed with TOKEN_KEY
  check_result TEXT,              -- ok | no_role | left | revoked | unreachable
  checked_at INTEGER,
  theme TEXT,                     -- dark | light, null until chosen
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL     -- last change to name, avatar or theme; drives /api/gate/sync
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_revoked ON sessions(revoked_at);

-- Tickets are only issued for hosts listed here.
CREATE TABLE tools (
  host TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  icon TEXT
);

INSERT INTO tools (host, name, position) VALUES
  ('cert.rescene-remine.com', 'MAMA 인증 분류', 1),
  ('monitor.rescene-remine.com', '모니터', 2);
