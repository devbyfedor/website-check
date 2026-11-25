import type { Report } from '@website-check/scanner/report';
import type { ApiResult, ApiScan, ScanErrorReason } from './scan-api';

// The report page of a real scan (session B3 part 2): `/bericht?id=…`. What the page shows comes from the API's
// answers: the report (shown only after `fetchReport` checked its version and validated it), or a state without
// design: the report is not ready yet, the id is unknown, the scan ended without a report, or our own error.
// A pure function of the API calls it is given, tested without a browser (web/test/report-page.test.ts).

export type ReportPageState =
  | { kind: 'loading' }
  | { kind: 'report'; report: Report }
  /** The scan waits or runs: the report comes later; the page leads to the scan screen. */
  | { kind: 'not-ready'; id: string; displayHost: string | null }
  /** The scan ended without a report (its last visitor cancelled it, the day's cap, our error). */
  | { kind: 'ended'; reason: ScanErrorReason; displayHost: string | null }
  /** The id is malformed, or the API does not know it (or no longer keeps it). */
  | { kind: 'not-found' }
  /** No usable answer after several tries (no connection, a server error, a report that fails the validator). */
  | { kind: 'error' };

export interface ReportPageApi {
  report: (id: string) => Promise<ApiResult<Report>>;
  status: (id: string) => Promise<ApiResult<ApiScan>>;
  sleep: (ms: number) => Promise<void>;
}

/** Requests before the page gives up and shows our error. */
export const REPORT_PAGE_TRIES = 3;
/** Between two tries. */
export const REPORT_PAGE_RETRY_MS = 3_000;

/**
 * What the page shows for an id: the report (200), "not found" (404 of the report, or of the status), the scan's own
 * state when the report is not ready (409: the status says whether it waits, runs or ended without a report), and our
 * error when no try gave a usable answer. A scan that became done between the two requests is asked again.
 */
export async function loadReportPage(id: string, api: ReportPageApi, isId: (value: string) => boolean): Promise<ReportPageState> {
  if (!isId(id)) return { kind: 'not-found' };
  for (let attempt = 1; attempt <= REPORT_PAGE_TRIES; attempt += 1) {
    const report = await api.report(id);
    if (report.ok) return { kind: 'report', report: report.value };
    if (report.status === 404) return { kind: 'not-found' };
    if (report.status === 409) {
      const status = await api.status(id);
      if (status.ok) {
        const scan = status.value;
        if (scan.status === 'queued' || scan.status === 'running') return { kind: 'not-ready', id, displayHost: scan.displayHost };
        if (scan.status === 'error') return { kind: 'ended', reason: scan.errorReason ?? 'other', displayHost: scan.displayHost };
        // done: the report was stored between the two requests; ask for it again at once.
        continue;
      }
      if (status.status === 404) return { kind: 'not-found' };
    }
    if (attempt < REPORT_PAGE_TRIES) await api.sleep(REPORT_PAGE_RETRY_MS);
  }
  return { kind: 'error' };
}
