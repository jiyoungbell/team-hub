-- The to-do board's messages in the Discord channel, edited in place. hash: what each one shows now.
CREATE TABLE discord_board (
  channel TEXT NOT NULL,
  slot INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (channel, slot)
);

-- One update at a time.
CREATE TABLE discord_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  busy_at INTEGER
);
INSERT INTO discord_meta (id) VALUES (1);
