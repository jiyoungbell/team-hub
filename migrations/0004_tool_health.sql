-- Last health check, shared by every Worker instance so pages never wait on the home server.
ALTER TABLE tools ADD COLUMN up INTEGER;          -- 1 | 0, null until first checked
ALTER TABLE tools ADD COLUMN checked_at INTEGER;
