/**
 * D1 access for scans (session A5 part 2). Every function uses `run`, `all` or `batch`, whose results
 * carry `meta.rows_written`, so the budget test can count the rows each step writes (docs/d1.md).
 *
 * The report JSON is stored and read as text: the Worker never parses it (10 ms CPU per request on the
 * free plan); the Durable Object writes it in part 3.
 */

export const CACHE_MS = 24 * 60 * 60 * 1000;
/** A queued or running scan older than this is not joined by new visitors: it is taken as stuck (part 3 ends it). */
export const IN_PROGRESS_MS = 10 * 60 * 1000;

export type ScanStatus = 'queued' | 'running' | 'done' | 'error';
export type ScanState = 'complete' | 'quick' | 'blocked' | 'not-allowed' | 'failed';
/** How a finished scan was made: with the browser, or the quick check without one (session fix-a2). */
export type ScanMode = 'full' | 'quick';

export interface ScanRow {
  id: string;
  status: ScanStatus;
  state: ScanState | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  country: string | null;
  /** Session B2 part 2: the host of the site (ASCII), read with the status only (`getScan`). */
  host?: string | null;
}

/** One D1 row of `findings`, taken from the report's findings in their order. */
export interface FindingRow {
  findingId: string;
  area: string;
  kind: string;
  risk: string | null;
  textId: string;
  serviceKey: string | null;
}

/** One D1 row of `network_requests` (`NetworkHostRow` of the scanner). */
export interface HostRow {
  host: string;
  party: 'first' | 'third';
  serviceKey: string | null;
  requestCount: number;
  firstStartMs: number;
  lastEndMs: number | null;
  beforeBanner: boolean | null;
}

interface RawScan {
  id: string;
  status: ScanStatus;
  state: ScanState | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  country: string | null;
}

function toScan(row: RawScan): ScanRow {
  return { id: row.id, status: row.status, state: row.state, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, country: row.country };
}

/**
 * Which earlier scan a new request for the same address may reuse: a finished complete or blocked scan
 * of the last 24 hours that was a full check, or one that is still queued or running (and not stuck). A
 * quick check is not reused (the full check is possible again the next day), also when the site blocked
 * it (session fix-a2: `mode`, migration 0002; a block met without a browser says nothing about the full
 * check), nor a failed one (it may have been a passing problem). `?1` site url, `?2` oldest finished
 * scan, `?3` oldest scan in progress.
 */
const CACHE_CONDITION = `s.site_id = (SELECT id FROM sites WHERE url = ?1)
  AND s.created_at >= ?2
  AND ((s.status = 'done' AND s.state IN ('complete', 'blocked') AND s.mode = 'full') OR (s.status IN ('queued', 'running') AND s.created_at >= ?3))`;

export async function findCachedScan(db: D1Database, url: string, now: number): Promise<ScanRow | null> {
  const result = await db
    .prepare(`SELECT s.id, s.status, s.state, s.created_at, s.started_at, s.finished_at, s.country FROM scans s WHERE ${CACHE_CONDITION} ORDER BY s.created_at DESC LIMIT 1`)
    .bind(url, now - CACHE_MS, now - IN_PROGRESS_MS)
    .all<RawScan>();
  const row = result.results[0];
  return row === undefined ? null : toScan(row);
}

/**
 * Creates the site (if new) and a queued scan in one transaction, unless a reusable scan of the same
 * address appeared in the meantime (two visitors at the same moment): then nothing is written and the
 * existing scan is returned.
 */
export async function createScan(db: D1Database, input: { id: string; url: string; host: string; now: number }): Promise<{ created: true; scan: ScanRow } | { created: false; scan: ScanRow }> {
  // The scan that blocked the insert can change its state before it is read again (a quick check, an
  // error): then a second attempt creates the scan (review of A5 part 2).
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await tryCreateScan(db, input);
    if (result !== null) return result;
  }
  const newest = await db
    .prepare('SELECT s.id, s.status, s.state, s.created_at, s.started_at, s.finished_at, s.country FROM scans s WHERE s.site_id = (SELECT id FROM sites WHERE url = ?1) ORDER BY s.created_at DESC LIMIT 1')
    .bind(input.url)
    .all<RawScan>();
  const row = newest.results[0];
  if (row === undefined) throw new Error('scan was neither created nor found');
  return { created: false, scan: toScan(row) };
}

async function tryCreateScan(db: D1Database, input: { id: string; url: string; host: string; now: number }): Promise<{ created: true; scan: ScanRow } | { created: false; scan: ScanRow } | null> {
  const [, insert] = await db.batch([
    db.prepare('INSERT INTO sites (url, host, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (url) DO NOTHING').bind(input.url, input.host, input.now),
    db
      .prepare(
        `INSERT INTO scans (id, site_id, created_at, status)
         SELECT ?4, id, ?5, 'queued' FROM sites WHERE url = ?1
         AND NOT EXISTS (SELECT 1 FROM scans s WHERE ${CACHE_CONDITION})`,
      )
      .bind(input.url, input.now - CACHE_MS, input.now - IN_PROGRESS_MS, input.id, input.now),
  ]);
  if ((insert?.meta.changes ?? 0) === 1) {
    return { created: true, scan: { id: input.id, status: 'queued', state: null, createdAt: input.now, startedAt: null, finishedAt: null, country: null } };
  }
  const existing = await findCachedScan(db, input.url, input.now);
  return existing === null ? null : { created: false, scan: existing };
}

/** The status of a scan with the host of its site (session B2 part 2: the heading of the scan screen); one query, two rows read. */
export async function getScan(db: D1Database, id: string): Promise<ScanRow | null> {
  const result = await db
    .prepare('SELECT s.id, s.status, s.state, s.created_at, s.started_at, s.finished_at, s.country, si.host FROM scans s JOIN sites si ON si.id = s.site_id WHERE s.id = ?1')
    .bind(id)
    .all<RawScan & { host: string }>();
  const row = result.results[0];
  return row === undefined ? null : { ...toScan(row), host: row.host };
}

/** The stored report text, unparsed; null when the scan does not exist. */
export async function getReportText(db: D1Database, id: string): Promise<{ status: ScanStatus; report: string | null } | null> {
  const result = await db.prepare('SELECT status, report FROM scans WHERE id = ?1').bind(id).all<{ status: ScanStatus; report: string | null }>();
  return result.results[0] ?? null;
}

export async function markRunning(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db.prepare("UPDATE scans SET status = 'running', started_at = ?2 WHERE id = ?1 AND status = 'queued'").bind(id, now).run();
  return result.meta.changes === 1;
}

/**
 * Stores the finished report with its findings and hosts in one transaction. The rows go in as one JSON
 * parameter each and are unpacked by SQLite (`json_each`), so a scan costs three statements whatever its
 * size (D1 allows 100 bound parameters per statement and 50 queries per invocation on the free plan).
 */
export async function saveResult(
  db: D1Database,
  input: { id: string; now: number; state: ScanState; mode: ScanMode; reportVersion: number; reportJson: string; country: string | null; colo: string | null; findings: FindingRow[]; hosts: HostRow[] },
): Promise<boolean> {
  const findings = JSON.stringify(input.findings.map((f) => [f.findingId, f.area, f.kind, f.risk, f.textId, f.serviceKey]));
  const hosts = JSON.stringify(input.hosts.map((h) => [h.host, h.party, h.serviceKey, h.requestCount, h.firstStartMs, h.lastEndMs, h.beforeBanner === null ? null : h.beforeBanner ? 1 : 0]));
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE scans SET status = 'done', state = ?2, finished_at = ?3, report_version = ?4, report = ?5, report_bytes = ?6, country = ?7, colo = ?8, mode = ?9
         WHERE id = ?1 AND status IN ('queued', 'running')`,
      )
      .bind(input.id, input.state, input.now, input.reportVersion, input.reportJson, new TextEncoder().encode(input.reportJson).byteLength, input.country, input.colo, input.mode),
    db
      .prepare(
        `INSERT INTO findings (scan_id, position, finding_id, area, kind, risk, text_id, service_key)
         SELECT ?1, j.key, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]')
         FROM json_each(?2) AS j WHERE EXISTS (SELECT 1 FROM scans WHERE id = ?1 AND status = 'done' AND finished_at = ?3)
         AND NOT EXISTS (SELECT 1 FROM findings WHERE scan_id = ?1)`,
      )
      .bind(input.id, findings, input.now),
    db
      .prepare(
        `INSERT INTO network_requests (scan_id, position, host, party, service_key, request_count, first_start_ms, last_end_ms, before_banner)
         SELECT ?1, j.key, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'), json_extract(j.value, '$[6]')
         FROM json_each(?2) AS j WHERE EXISTS (SELECT 1 FROM scans WHERE id = ?1 AND status = 'done' AND finished_at = ?3)
         AND NOT EXISTS (SELECT 1 FROM network_requests WHERE scan_id = ?1)`,
      )
      .bind(input.id, hosts, input.now),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

/** Our own failure (the job crashed): no report. A capture that failed is a report with a state, not this. */
export async function markError(db: D1Database, id: string, reason: string, now: number): Promise<void> {
  await db.prepare("UPDATE scans SET status = 'error', error = ?2, finished_at = ?3 WHERE id = ?1 AND status IN ('queued', 'running')").bind(id, reason.slice(0, 200), now).run();
}

/** A queued or running scan older than this will not finish: the hourly cleanup ends it as an error (session A5 part 3). */
export const STUCK_MS = 30 * 60 * 1000;

/**
 * Ends scans that have been queued or running for more than `STUCK_MS` (the queue object was lost, or its
 * retry gave up without reaching D1), so the scan screen stops waiting. Our own failure: no report.
 */
export async function endStuckScans(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare("UPDATE scans SET status = 'error', error = 'stuck', finished_at = ?1 WHERE status IN ('queued', 'running') AND created_at < ?2")
    .bind(now, now - STUCK_MS)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Deletes every scan created before `before` with its findings and hosts (ON DELETE CASCADE), and the
 * sites that have no scan left. The retention period is chosen by Fedor in stage C.
 */
export async function purgeBefore(db: D1Database, before: number): Promise<{ scans: number; sites: number }> {
  // `changes` of the DELETE would include the rows deleted by the cascade, so the scans are counted first.
  const [count, , sites] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM scans WHERE created_at < ?1').bind(before),
    db.prepare('DELETE FROM scans WHERE created_at < ?1').bind(before),
    db.prepare('DELETE FROM sites WHERE NOT EXISTS (SELECT 1 FROM scans WHERE scans.site_id = sites.id)'),
  ]);
  return { scans: (count?.results[0] as { n?: number } | undefined)?.n ?? 0, sites: sites?.meta.changes ?? 0 };
}
