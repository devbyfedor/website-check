import { buildReport, DEFAULT_RULES, REPORT_SCHEMA_VERSION, RULES_FILE, SCANNER_VERSION, validateReport, type Capture, type Report } from '@website-check/scanner';
import { markError, markRunning, saveResult, type FindingRow } from '../db/store.ts';
import type { QueueJob, ScanMode } from './core.ts';

/**
 * One scan from the queue to D1 (session A5 part 3): mark it running, capture (full with the browser, or
 * the quick check without), build the report, check it against the schema, store it with its findings and
 * hosts. A capture that failed (blocked, refused, unreachable) is a report with that state, not an error;
 * only our own failure (an exception, a report that breaks its schema) is `markError`.
 */

export interface VisitPlace {
  country: string | null;
  colo: string | null;
}

export interface CaptureOutcome {
  capture: Capture;
  visit: VisitPlace;
}

export interface ScanJobDeps {
  db: D1Database;
  now(): number;
  capture(url: string, mode: ScanMode): Promise<CaptureOutcome>;
  /** Pause between write attempts (default: a timer). */
  sleep?(ms: number): Promise<void>;
}

/** Pauses before the second and third attempt to write a result to D1 (session fix-a5, review finding 44). */
export const WRITE_PAUSES_MS = [500, 2_000] as const;

export interface ScanJobResult {
  outcome: 'saved' | 'skipped' | 'error';
  state: Report['state'] | null;
  reportBytes: number;
  findings: number;
  hosts: number;
  /** For `error`: a short reason without the address. */
  error?: string;
  /** D1 took neither the report nor the error: the scan is still `running` there, the queue records the error later. */
  unrecorded?: boolean;
}

async function withRetries<T>(work: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= WRITE_PAUSES_MS.length; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      const pause = WRITE_PAUSES_MS[attempt];
      if (pause !== undefined) await sleep(pause);
    }
  }
  throw last;
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.split('\n')[0]?.slice(0, 160) ?? 'error';
}

export function findingRows(report: Report): FindingRow[] {
  return report.findings.map((f) => ({ findingId: f.id, area: f.area, kind: f.kind, risk: f.risk, textId: f.textId, serviceKey: f.serviceKey }));
}

export async function runScanJob(job: QueueJob, mode: ScanMode, deps: ScanJobDeps): Promise<ScanJobResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Our own failure as the scan's end in D1, retried like the report; when D1 takes nothing, the caller keeps it.
  const recordError = async (reason: string): Promise<ScanJobResult> => {
    const result: ScanJobResult = { outcome: 'error', state: null, reportBytes: 0, findings: 0, hosts: 0, error: reason };
    try {
      await withRetries(() => markError(deps.db, job.id, reason, deps.now()), sleep);
      return result;
    } catch {
      return { ...result, unrecorded: true };
    }
  };
  // Another run already finished it (a retry after a restart), or it ended as an error: nothing to do.
  if (!(await markRunning(deps.db, job.id, deps.now()))) {
    const again = await deps.db.prepare("SELECT status FROM scans WHERE id = ?1").bind(job.id).all<{ status: string }>();
    if (again.results[0]?.status !== 'running') return { outcome: 'skipped', state: null, reportBytes: 0, findings: 0, hosts: 0 };
  }
  try {
    const { capture, visit } = await deps.capture(job.url, mode);
    const built = buildReport({
      id: job.id,
      createdAt: new Date(job.createdAt).toISOString(),
      siteUrl: job.url,
      mode,
      capture,
      rules: DEFAULT_RULES,
      scannerVersion: SCANNER_VERSION,
      rulesUpdated: RULES_FILE.updated,
      visit,
    });
    const problems = validateReport(built.report);
    if (problems.length > 0) {
      const first = problems[0];
      const reason = `report-invalid: ${problems.length} errors, first ${first?.path ?? ''} ${first?.message ?? ''}`.slice(0, 160);
      return await recordError(reason);
    }
    const reportJson = JSON.stringify(built.report);
    // A passing failure of D1 must not throw the report away (session fix-a5, review finding 44): two more tries.
    try {
      await withRetries(
        () =>
          saveResult(deps.db, {
            id: job.id,
            now: deps.now(),
            state: built.report.state,
            mode,
            reportVersion: REPORT_SCHEMA_VERSION,
            reportJson,
            country: built.report.visit.country,
            colo: built.report.visit.colo,
            findings: findingRows(built.report),
            hosts: built.networkHosts,
          }),
        sleep,
      );
    } catch (error) {
      return await recordError(`save-failed: ${shortError(error)}`.slice(0, 160));
    }
    return { outcome: 'saved', state: built.report.state, reportBytes: new TextEncoder().encode(reportJson).byteLength, findings: built.report.findings.length, hosts: built.networkHosts.length };
  } catch (error) {
    return await recordError(`scan-failed: ${shortError(error)}`);
  }
}
