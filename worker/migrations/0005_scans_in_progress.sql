-- Migration 0005 (session fix-a5, 24.11.2026, review finding 42): the hourly cleanup (`endStuckScans`) looks only
-- at scans that are queued or running. Without an index for them it read every row of `scans` each hour (the
-- table grows by up to 150 rows a day until the retention period of stage C). The index holds only the scans in
-- progress, so it stays a few rows long; it costs one row written when a scan is created and one when it ends
-- (docs/d1.md).
CREATE INDEX scans_in_progress ON scans (created_at) WHERE status IN ('queued', 'running');
