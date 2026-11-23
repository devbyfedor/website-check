import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUrlGuard, quickCapture, validateReport } from '@website-check/scanner';
import { getReportText } from '../src/db/store.ts';
import { chooseMode, MemoryKv, QUEUE_LIMITS, ScanQueue, type QueueJob } from '../src/queue/core.ts';
import { drain } from '../src/queue/drain.ts';
import { runScanJob } from '../src/queue/job.ts';
import { localApi } from './api-local.ts';
import { localD1, type LocalD1 } from './d1.ts';

/**
 * Session fix-a2, review findings 22 and 18 on the whole path: the API with its start, the local D1, the
 * real queue and `runScanJob`, the real quick check with a fake resolver and a fake fetch. No browser, no
 * network. The cases are the ones of the review's reproductions, with an invented site.
 */

const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';
const PUBLIC = '93.184.215.14';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const HOST = 'shop-beispiel.de';
const NORMAL = `<!doctype html><html lang="de"><head><title>Beispiel Shop</title></head><body><h1>Willkommen</h1><p>${'Text '.repeat(200)}</p><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></body></html>`;

let d1: LocalD1;
beforeAll(async () => {
  d1 = await localD1();
}, 60_000);
afterAll(async () => {
  await d1?.dispose();
});
beforeEach(async () => {
  await d1.clear();
});

function post(url: string, ip: string): Request {
  return new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ url }) });
}

interface Site {
  status: number;
  headers?: Record<string, string>;
  html: string;
}

/** The evening of a day whose browser time is used up: the queue itself chooses the quick check. */
async function setup(site: Site) {
  const state = { clock: Date.UTC(2026, 10, 23, 20, 0, 0), fetches: 0, browserOpened: 0 };
  const guard = createUrlGuard({ resolve: async () => [PUBLIC] });
  const fakeFetch = (async () => {
    state.fetches += 1;
    return new Response(site.html, { status: site.status, headers: { 'content-type': 'text/html; charset=utf-8', ...site.headers } });
  }) as unknown as typeof fetch;
  const queue = new ScanQueue(new MemoryKv(), QUEUE_LIMITS);
  await queue.addBrowserTime(QUEUE_LIMITS.browserBudgetMs, state.clock);
  const api = localApi({ db: d1.db, check: (u) => guard.check(u), secret: SECRET, now: () => state.clock, dispatch: async (scan) => queue.enqueue(scan, state.clock) });
  const modes: string[] = [];
  const run = async (): Promise<void> => {
    await drain({
      queue,
      browser: { ensure: async () => void (state.browserOpened += 1), openMs: () => 0, closeIfOpen: async () => undefined },
      now: () => state.clock,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
      runJob: async (job, mode) => {
        modes.push(mode);
        await runScanJob(job, mode, {
          db: d1.db,
          now: () => state.clock + 2_000,
          capture: async (url, m) => {
            if (m !== 'quick') throw new Error('unexpected full check in this test');
            return { capture: await quickCapture(url, { guard, userAgent: UA, fetch: fakeFetch, httpProbe: false }), visit: { country: 'DE', colo: 'FRA' } };
          },
        });
      },
      onJobError: async (_job, error) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
    });
  };
  const start = async (ip: string) => {
    const response = await api(post(HOST, ip));
    return { status: response.status, body: (await response.json()) as { id: string; cached: boolean; status: string; state: string | null } };
  };
  const row = async (id: string) => (await d1.db.prepare('SELECT status, state, mode, report FROM scans WHERE id = ?1').bind(id).all<{ status: string; state: string; mode: string | null; report: string }>()).results[0];
  return { state, queue, modes, run, start, row };
}

const BLOCKS: [string, Site][] = [
  ['HTTP 429', { status: 429, html: '<html><head><title>Too Many Requests</title></head><body>Slow down</body></html>' }],
  ['HTTP 403 with a challenge header', { status: 403, headers: { 'cf-mitigated': 'challenge' }, html: '<html><head><title>Just a moment...</title></head><body></body></html>' }],
  ['HTTP 403 of a firewall that refuses a plain fetch', { status: 403, html: '<html><head><title>403 Forbidden</title></head><body>Forbidden</body></html>' }],
  ['a check page with HTTP 200', { status: 200, html: '<html><head><title>Einen Moment bitte …</title></head><body>Bitte warten Sie, während Ihre Anfrage geprüft wird …</body></html>' }],
];

describe('finding 22: a block met by the quick check without a browser', () => {
  it.each(BLOCKS)('%s: stored with its mode, and not reused the next day, when the full check is possible again', async (_name, site) => {
    const t = await setup(site);
    const first = await t.start('203.0.113.7');
    expect(first.status).toBe(202);
    await t.run();
    expect(t.modes).toEqual(['quick']);
    expect(t.state.browserOpened).toBe(0);
    const stored = await t.row(first.body.id);
    expect(stored).toMatchObject({ status: 'done', state: 'blocked', mode: 'quick' });
    const report = JSON.parse(stored?.report ?? 'null') as { state: string; scan: { mode: string }; notice: { textId: string; params: Record<string, unknown> } };
    expect(validateReport(report)).toEqual([]);
    expect(report).toMatchObject({ state: 'blocked', scan: { mode: 'quick' } });
    // The report says that it was the quick check that was blocked: the full check is possible again the next day.
    expect(report.notice).toMatchObject({ textId: 'report-blocked', params: { quickCheck: true } });

    // The next UTC day, 09:00: the day's counters are new, the queue would run a full check.
    t.state.clock += 13 * 3_600_000;
    expect(chooseMode({}, await t.queue.day(t.state.clock), QUEUE_LIMITS, 0)).toBe('full');
    const jobsBefore = (await t.queue.jobs()).length;
    const next = await t.start('198.51.100.20');
    expect(next.status).toBe(202);
    expect(next.body.cached).toBe(false);
    expect(next.body.id).not.toBe(first.body.id);
    expect((await t.queue.jobs()).length - jobsBefore).toBe(1);
  });

  it('the same evening the blocked quick check is not reused either: every start is a new scan', async () => {
    const t = await setup(BLOCKS[0]?.[1] as Site);
    const first = await t.start('203.0.113.7');
    await t.run();
    t.state.clock += 60_000;
    const again = await t.start('198.51.100.21');
    expect(again.status).toBe(202);
    expect(again.body.id).not.toBe(first.body.id);
  });

  it('control: a block met by the full check with the browser is still reused for 24 hours', async () => {
    const t = await setup(BLOCKS[0]?.[1] as Site);
    const first = await t.start('203.0.113.7');
    const job: QueueJob = { id: first.body.id, url: `https://${HOST}/`, createdAt: t.state.clock, enqueuedAt: t.state.clock, attempts: 1, startedAt: t.state.clock };
    const guard = createUrlGuard({ resolve: async () => [PUBLIC] });
    const blocked = (async () => new Response('<html><head><title>Just a moment...</title></head><body></body></html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } })) as unknown as typeof fetch;
    // The capture of a blocked page as the browser adapter gives it: the same failure, adapter of the full check.
    const capture = { ...(await quickCapture(job.url, { guard, userAgent: UA, fetch: blocked, httpProbe: false })), adapter: 'cloudflare-browser-run' as const };
    await runScanJob(job, 'full', { db: d1.db, now: () => t.state.clock + 2_000, capture: async () => ({ capture, visit: { country: 'DE', colo: 'FRA' } }) });
    const stored = await t.row(first.body.id);
    expect(stored).toMatchObject({ state: 'blocked', mode: 'full' });
    expect((JSON.parse(stored?.report ?? 'null') as { notice: { params: Record<string, unknown> } }).notice.params).not.toHaveProperty('quickCheck');
    t.state.clock += 13 * 3_600_000;
    const next = await t.start('198.51.100.20');
    expect(next).toMatchObject({ status: 200, body: { id: first.body.id, cached: true, state: 'blocked' } });
  });

  it('control: a quick check of a normal page is `quick` with mode quick, and not reused (as before)', async () => {
    const t = await setup({ status: 200, html: NORMAL });
    const first = await t.start('203.0.113.7');
    await t.run();
    expect(await t.row(first.body.id)).toMatchObject({ status: 'done', state: 'quick', mode: 'quick' });
    t.state.clock += 13 * 3_600_000;
    expect((await t.start('198.51.100.20')).body.cached).toBe(false);
  });
});

describe('finding 18 through the API: an address entered with http://', () => {
  it('the quick check asks https:// too, and a site that answers there gets no "Seite ohne HTTPS"', async () => {
    const clock = Date.UTC(2026, 10, 23, 9, 0, 0);
    const guard = createUrlGuard({ resolve: async () => [PUBLIC] });
    const api = localApi({ db: d1.db, check: (u) => guard.check(u), secret: SECRET, now: () => clock, dailyGate: { until: 0 } });
    const started = await api(post(`http://${HOST}`, '203.0.113.7'));
    expect(started.status).toBe(202);
    const id = ((await started.json()) as { id: string }).id;
    const jobUrl = (await d1.db.prepare('SELECT s.url AS url FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ?1').bind(id).all<{ url: string }>()).results[0]?.url ?? '';
    expect(jobUrl).toBe(`http://${HOST}/`);
    const asked: Record<string, number> = { 'http:': 0, 'https:': 0 };
    const fake = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      asked[url.protocol] = (asked[url.protocol] ?? 0) + 1;
      return new Response(NORMAL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as unknown as typeof fetch;
    const job: QueueJob = { id, url: jobUrl, createdAt: clock, enqueuedAt: clock, attempts: 1, startedAt: clock };
    const result = await runScanJob(job, 'quick', { db: d1.db, now: () => clock + 2_000, capture: async (url) => ({ capture: await quickCapture(url, { guard, userAgent: UA, fetch: fake }), visit: { country: 'DE', colo: 'FRA' } }) });
    expect(result).toMatchObject({ outcome: 'saved', state: 'quick' });
    expect(asked['https:']).toBe(1);
    const report = JSON.parse((await getReportText(d1.db, id))?.report ?? 'null') as { site: { finalUrl: string }; security: { https: string; httpRedirect: string }; findings: { id: string; kind: string; risk: string | null; textId: string }[]; priorities: string[] };
    expect(validateReport(report)).toEqual([]);
    expect(report.site.finalUrl).toBe(`http://${HOST}/`);
    expect(report.security).toMatchObject({ https: 'pass', httpRedirect: 'fail' });
    expect(report.findings.filter((f) => f.id === 'security:https')).toEqual([]);
    expect(report.findings.filter((f) => f.risk === 'high')).toEqual([]);
    expect(report.findings.find((f) => f.id === 'security:http-redirect')).toMatchObject({ kind: 'finding', risk: 'medium', textId: 'security-http-no-redirect' });
  });
});
