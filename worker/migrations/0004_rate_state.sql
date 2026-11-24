-- Migration 0004 (session fix-a5, 24.11.2026, review findings 89 and 91): the rate limit keeps no time that a
-- copy of the database could match with the creation time of a scan. `rate_events` (hash and millisecond time of
-- every scan) and `rate_daily` (hash, day, count) are replaced by one row per visitor and UTC day: the visitor
-- hash (HMAC with the Worker secret over the day's salt), the day, and the state encrypted with a key derived
-- from the secret and the salt (the times of the last hour and the counts of the day, padded to a fixed length).
-- Every start counts in it, also one answered from the 24-hour cache (finding 89). Rows of earlier days are
-- deleted with the salt of the new day and by the hourly cleanup. Rows written per scan: docs/d1.md.
-- No real database existed when this was written; a migration that was applied once is not edited.
DROP TABLE rate_events;
DROP TABLE rate_daily;
CREATE TABLE rate_state (
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (visitor, day)
) WITHOUT ROWID;
