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
}

export interface ScanJobResult {
  outcome: 'saved' | 'skipped' | 'error';
  state: Report['state'] | null;
  reportBytes: number;
  findings: number;
  hosts: number;
  /** For `error`: a short reason without the address. */
  error?: string;
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.split('\n')[0]?.slice(0, 160) ?? 'error';
}

export function findingRows(report: Report): FindingRow[] {
  return report.findings.map((f) => ({ findingId: f.id, area: f.area, kind: f.kind, risk: f.risk, textId: f.textId, serviceKey: f.serviceKey }));
}

export async function runScanJob(job: QueueJob, mode: ScanMode, deps: ScanJobDeps): Promise<ScanJobResult> {
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
      await markError(deps.db, job.id, reason, deps.now());
      return { outcome: 'error', state: null, reportBytes: 0, findings: 0, hosts: 0, error: reason };
    }
    const reportJson = JSON.stringify(built.report);
    await saveResult(deps.db, {
      id: job.id,
      now: deps.now(),
      state: built.report.state,
      reportVersion: REPORT_SCHEMA_VERSION,
      reportJson,
      country: built.report.visit.country,
      colo: built.report.visit.colo,
      findings: findingRows(built.report),
      hosts: built.networkHosts,
    });
    return { outcome: 'saved', state: built.report.state, reportBytes: new TextEncoder().encode(reportJson).byteLength, findings: built.report.findings.length, hosts: built.networkHosts.length };
  } catch (error) {
    const reason = `scan-failed: ${shortError(error)}`;
    await markError(deps.db, job.id, reason, deps.now()).catch(() => undefined);
    return { outcome: 'error', state: null, reportBytes: 0, findings: 0, hosts: 0, error: reason };
  }
}
