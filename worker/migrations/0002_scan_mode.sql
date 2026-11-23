-- Migration 0002 (session fix-a2, 23.11.2026): how a scan was made, `full` (with the browser) or `quick`
-- (the quick check without one). The 24-hour cache reuses only full checks: a quick check that the site
-- blocked must not keep the next day's visitors from a full check. Null for a scan that is not finished.
ALTER TABLE scans ADD COLUMN mode TEXT CHECK (mode IS NULL OR mode IN ('full', 'quick'));
