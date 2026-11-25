import { describe, expect, it } from 'vitest';
import type { Report } from '@website-check/scanner/report';
import { loadReportPage, REPORT_PAGE_TRIES, type ReportPageApi } from '../lib/report-page';
import { isScanId, type ApiResult, type ApiScan } from '../lib/scan-api';

const ID = 'abcdefghijklmnopqrstuvwxyz';
const REPORT = { id: ID } as unknown as Report;
const scan = (status: ApiScan['status'], extra: Partial<ApiScan> = {}): ApiResult<ApiScan> => ({
  ok: true,
  value: { id: ID, status, displayHost: 'roesterei-muster.de', queuePosition: null, startedAt: null, cancelToken: null, errorReason: null, ...extra },
});

/** An API that gives the answers in order (the last one repeats) and counts the calls. */
function api(reports: ApiResult<Report>[], statuses: ApiResult<ApiScan>[] = []) {
  const calls = { report: 0, status: 0, sleeps: 0 };
  const pick = <T>(list: T[], i: number): T => list[Math.min(i, list.length - 1)] as T;
  const value: ReportPageApi = {
    report: async () => pick(reports, calls.report++),
    status: async () => pick(statuses, calls.status++),
    sleep: async () => {
      calls.sleeps += 1;
    },
  };
  return { value, calls };
}

describe('the report page of a real scan (B3 part 2)', () => {
  it('shows the report the API gives', async () => {
    const a = api([{ ok: true, value: REPORT }]);
    expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'report', report: REPORT });
    expect(a.calls).toEqual({ report: 1, status: 0, sleeps: 0 });
  });

  it('a malformed id is "not found" without a request', async () => {
    const a = api([{ ok: true, value: REPORT }]);
    for (const id of ['', 'kurz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', `${ID}a`, '../../api/scans']) expect(await loadReportPage(id, a.value, isScanId)).toEqual({ kind: 'not-found' });
    expect(a.calls.report).toBe(0);
  });

  it('a 404 is "not found" at once', async () => {
    const a = api([{ ok: false, status: 404 }]);
    expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'not-found' });
    expect(a.calls).toEqual({ report: 1, status: 0, sleeps: 0 });
  });

  it('409: a scan that waits or runs is "not ready", with its address and a way to the scan screen', async () => {
    for (const status of ['queued', 'running'] as const) {
      const a = api([{ ok: false, status: 409 }], [scan(status)]);
      expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'not-ready', id: ID, displayHost: 'roesterei-muster.de' });
    }
  });

  it('409: a scan that ended without a report says why (cancelled, the day cap, our error)', async () => {
    for (const reason of ['cancelled', 'daily-limit', 'other'] as const) {
      const a = api([{ ok: false, status: 409 }], [scan('error', { errorReason: reason })]);
      expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'ended', reason, displayHost: 'roesterei-muster.de' });
    }
  });

  it('409 and then done: the report was stored in between and is asked for again after the pause', async () => {
    const a = api([{ ok: false, status: 409 }, { ok: true, value: REPORT }], [scan('done')]);
    expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'report', report: REPORT });
    expect(a.calls).toEqual({ report: 2, status: 1, sleeps: 1 });
    // Done without a stored report: three rounds with pauses, then our error (review of B3 part 2).
    const b = api([{ ok: false, status: 409 }], [scan('done')]);
    expect(await loadReportPage(ID, b.value, isScanId)).toEqual({ kind: 'error' });
    expect(b.calls).toEqual({ report: REPORT_PAGE_TRIES, status: REPORT_PAGE_TRIES, sleeps: REPORT_PAGE_TRIES - 1 });
  });

  it('409 and a 404 of the status: "not found"', async () => {
    const a = api([{ ok: false, status: 409 }], [{ ok: false, status: 404 }]);
    expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'not-found' });
  });

  it('no usable answer (no connection, 5xx, a report that fails the validator): our error after a few tries', async () => {
    for (const failure of [0, 500, 503]) {
      const a = api([{ ok: false, status: failure }]);
      expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'error' });
      expect(a.calls).toEqual({ report: REPORT_PAGE_TRIES, status: 0, sleeps: REPORT_PAGE_TRIES - 1 });
    }
  });

  it('a failure that passes: the report of the second try', async () => {
    const a = api([{ ok: false, status: 0 }, { ok: true, value: REPORT }]);
    expect(await loadReportPage(ID, a.value, isScanId)).toEqual({ kind: 'report', report: REPORT });
    expect(a.calls.sleeps).toBe(1);
  });
});
