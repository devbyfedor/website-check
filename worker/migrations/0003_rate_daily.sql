-- Migration 0003 (session fix-a4, 24.11.2026): the daily limit of the rate limit, at most 15 new scans per
-- visitor per UTC day. One row per visitor hash and day: the hash (the same HMAC as in `rate_events`, the
-- salt is one per UTC day), the day and the count. No time is stored, so the row cannot be matched with the
-- creation time of a scan. Rows of earlier days are deleted with the salt of that day and by the hourly cleanup.
-- Rows written per scan: docs/d1.md.
CREATE TABLE rate_daily (
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  scans INTEGER NOT NULL,
  PRIMARY KEY (visitor, day)
) WITHOUT ROWID;
