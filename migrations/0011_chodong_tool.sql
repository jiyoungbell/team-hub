-- Read-only PULSE sales dashboard, protected by the existing team-gate.
INSERT INTO tools (host, name, position, icon)
SELECT 'chodong.rescene-remine.com', '초동 집계', COALESCE(MAX(position), 0) + 1, 'chart'
FROM tools
WHERE true
ON CONFLICT(host) DO NOTHING;
