-- A separate entry point backed by the existing monitor service. Sessions are unchanged.
INSERT INTO tools (host, name, position, icon)
VALUES ('chart.rescene-remine.com', '차트', 3, 'chart')
ON CONFLICT(host) DO NOTHING;
