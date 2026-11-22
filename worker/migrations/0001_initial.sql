-- Migration 0001 (session A5 part 2, 23.11.2026): the tables of the brief (sites, scans, findings,
-- network_requests, leads) and two tables for the rate limit. Applied with
-- `npx wrangler d1 migrations apply website-check --local -c worker/wrangler.jsonc`.
-- Times are milliseconds since 1970-01-01 UTC. Raw IP addresses are never stored.
-- Rows written per scan and the free-plan budget: docs/d1.md.

-- One row per normalized address (scheme, host, "/"), the key of the 24-hour cache.
CREATE TABLE sites (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row per scan. `created_at` is the date by which old reports are deleted (retention chosen in stage C).
-- `report` is the report JSON (scanner/schema/report.v1.schema.json) as the Durable Object stored it;
-- the Worker returns it without parsing.
CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites (id),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error')),
  state TEXT CHECK (state IS NULL OR state IN ('complete', 'quick', 'blocked', 'not-allowed', 'failed')),
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  country TEXT,
  colo TEXT,
  report_version INTEGER,
  report_bytes INTEGER,
  report TEXT,
  CHECK ((status = 'done') = (report IS NOT NULL AND state IS NOT NULL))
);

-- The cache lookup: the newest scan of a site.
CREATE INDEX scans_site_created ON scans (site_id, created_at);

-- Every item of a report that is not a pass (finding, manual check, hint, not checked), for statistics
-- and the revisions of stage D. The texts stay in the report; this is an index of it.
CREATE TABLE findings (
  scan_id TEXT NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  finding_id TEXT NOT NULL,
  area TEXT NOT NULL,
  kind TEXT NOT NULL,
  risk TEXT,
  text_id TEXT NOT NULL,
  service_key TEXT,
  PRIMARY KEY (scan_id, position)
) WITHOUT ROWID;

-- The requests of a scan, one row per host (not per request: a page makes 70 to 1,000 requests,
-- which would use up the free write limit; see docs/d1.md).
CREATE TABLE network_requests (
  scan_id TEXT NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  host TEXT NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('first', 'third')),
  service_key TEXT,
  request_count INTEGER NOT NULL,
  first_start_ms INTEGER NOT NULL,
  last_end_ms INTEGER,
  before_banner INTEGER,
  PRIMARY KEY (scan_id, position)
) WITHOUT ROWID;

-- Lead form of stage C: table only, columns provisional until the form is designed.
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  scan_id TEXT REFERENCES scans (id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'answered', 'closed'))
);

-- Rate limit (brief <architecture>): a random salt per UTC day, deleted when the next day starts.
CREATE TABLE rate_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
) WITHOUT ROWID;

-- One row per started scan: the salted hash of the visitor's address and the time. Rows older than
-- the window (one hour) are deleted on the next start.
CREATE TABLE rate_events (
  visitor TEXT NOT NULL,
  at INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  PRIMARY KEY (visitor, at, nonce)
) WITHOUT ROWID;
