import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUrlGuard, validateReport, type Resolver } from '@website-check/scanner';
import { handleRequest, queueClient } from '../src/app.ts';
import { createApi } from '../src/api/router.ts';
import { parseStartInput, type DispatchResult } from '../src/api/start.ts';
import { localApi } from './api-local.ts';
import { endStuckScans, getReportText, getScan, STUCK_MS } from '../src/db/store.ts';
import type { QueueJob } from '../src/queue/core.ts';
import { runScanJob } from '../src/queue/job.ts';
import { shopCapture } from '../../scanner/test/report-helpers.ts';
import { localD1, type LocalD1 } from './d1.ts';

/**
 * Session A5 part 3: one scan from the queue to D1 (`runScanJob`) on the local D1 with a synthetic capture
 * of an invented shop, and the API's side of the queue (place in the queue, the day cap, the client of the
 * queue object). No browser, no network.
 */

const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';
const resolver: Resolver = async () => ['93.184.215.14'];
let d1: LocalD1;
let clock = Date.UTC(2026, 10, 23, 9, 0, 0);

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);
afterAll(async () => {
  await d1?.dispose();
});
beforeEach(async () => {
  await d1.clear();
});

function api(options: { dispatch?: (scan: { id: string; url: string; createdAt: number }) => Promise<DispatchResult | void>; position?: (id: string) => Promise<number | null>; ratePerHour?: number; dailyGate?: { until: number } } = {}) {
  const guard = createUrlGuard({ resolve: resolver });
  return localApi({ db: d1.db, check: (url) => guard.check(url), secret: SECRET, now: () => clock, dailyGate: { until: 0 }, ...options });
}

async function start(handler: (r: Request) => Promise<Response>, url: string, ip = '203.0.113.7'): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await handler(new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ url }) }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers };
}

async function queuedJob(url = 'https://www.beispiel-roesterei.de/'): Promise<QueueJob> {
  const started = await start(api(), url);
  expect(started.status).toBe(202);
  return { id: String(started.body.id), url, createdAt: clock, enqueuedAt: clock, attempts: 1, startedAt: clock };
}

describe('a scan from the queue to D1', () => {
  it('stores a report that validates against the schema, with its findings and hosts', async () => {
    const job = await queuedJob();
    const result = await runScanJob(job, 'full', { db: d1.db, now: () => clock + 9_000, capture: async () => ({ capture: shopCapture(), visit: { country: 'AT', colo: 'VIE' } }) });
    expect(result).toMatchObject({ outcome: 'saved', state: 'complete' });
    const scan = await getScan(d1.db, job.id);
    expect(scan).toMatchObject({ status: 'done', state: 'complete', country: 'AT' });
    const stored = await getReportText(d1.db, job.id);
    const report = JSON.parse(stored?.report ?? 'null') as { id: string; visit: { country: string; colo: string }; findings: unknown[] };
    expect(validateReport(report)).toEqual([]);
    expect(report.id).toBe(job.id);
    expect(report.visit).toMatchObject({ country: 'AT', colo: 'VIE' });
    const findings = await d1.db.prepare('SELECT COUNT(*) AS n FROM findings WHERE scan_id = ?1').bind(job.id).all<{ n: number }>();
    expect(findings.results[0]?.n).toBe(report.findings.length);
    expect(result.findings).toBe(report.findings.length);
    const hosts = await d1.db.prepare('SELECT COUNT(*) AS n FROM network_requests WHERE scan_id = ?1').bind(job.id).all<{ n: number }>();
    expect(hosts.results[0]?.n).toBe(result.hosts);
  });

  it('takes the country of the visit from the capture when the queue does not pass one', async () => {
    const job = await queuedJob();
    const capture = { ...shopCapture(), visit: { country: 'IT', colo: 'MXP', source: 'browser-trace' as const } };
    await runScanJob(job, 'full', { db: d1.db, now: () => clock, capture: async () => ({ capture, visit: { country: 'IT', colo: 'MXP' } }) });
    expect((await getScan(d1.db, job.id))?.country).toBe('IT');
  });

  it('records our own failure as an error without a report, never as a clean site', async () => {
    const job = await queuedJob();
    const result = await runScanJob(job, 'full', {
      db: d1.db,
      now: () => clock,
      capture: async () => {
        throw new Error('browser disconnected');
      },
    });
    expect(result.outcome).toBe('error');
    expect(await getScan(d1.db, job.id)).toMatchObject({ status: 'error', state: null });
    expect((await getReportText(d1.db, job.id))?.report).toBeNull();
  });

  it('does not run a scan twice', async () => {
    const job = await queuedJob();
    const deps = { db: d1.db, now: () => clock, capture: async () => ({ capture: shopCapture(), visit: { country: null, colo: null } }) };
    expect((await runScanJob(job, 'full', deps)).outcome).toBe('saved');
    expect((await runScanJob(job, 'full', deps)).outcome).toBe('skipped');
  });

  it('builds a quick report with the notice and the browser parts not checked', async () => {
    const job = await queuedJob();
    const base = shopCapture();
    const quick = { ...base, adapter: 'quick-fetch' as const, axe: null, requests: base.requests.filter((r) => r.resourceType === 'document') };
    await runScanJob(job, 'quick', { db: d1.db, now: () => clock, capture: async () => ({ capture: quick, visit: { country: 'DE', colo: 'FRA' } }) });
    const report = JSON.parse((await getReportText(d1.db, job.id))?.report ?? 'null') as Record<string, unknown> & { notice: { textId: string }; sections: Record<string, { status: string; reason: string | null }>; scan: { mode: string } };
    expect(validateReport(report)).toEqual([]);
    expect(report.state).toBe('quick');
    expect(report.scan.mode).toBe('quick');
    expect(report.notice.textId).toBe('report-quick-incomplete');
    expect(report.sections.thirdParty).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(report.sections.accessibility).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(report.sections.legal?.status).toBe('checked');
    expect(report.sections.security?.status).toBe('checked');
    expect((await getScan(d1.db, job.id))?.state).toBe('quick');
  });
});

describe('the API and the queue', () => {
  it('passes a new scan to the queue and shows its place while it waits', async () => {
    const dispatched: { id: string; url: string; createdAt: number }[] = [];
    const handler = api({ dispatch: async (scan) => (dispatched.push(scan), { accepted: true, position: 3 }), position: async () => 2 });
    const started = await start(handler, 'beispiel-baeckerei.de');
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'queued', queuePosition: 3, cached: false });
    expect(dispatched).toEqual([{ id: started.body.id, url: 'https://beispiel-baeckerei.de/', createdAt: clock }]);
    const status = await handler(new Request(`https://website-check.test/api/scans/${String(started.body.id)}`));
    expect(await status.json()).toMatchObject({ status: 'queued', queuePosition: 2 });
  });

  it('answers 503 daily-limit when the queue refuses, then refuses further starts without writing to D1', async () => {
    const gate = { until: 0 };
    let asked = 0;
    const handler = api({ dailyGate: gate, dispatch: async () => (asked++, { accepted: false, reason: 'daily-limit', retryAfterSeconds: 3_600 }) });
    const refused = await start(handler, 'beispiel-baeckerei.de');
    expect(refused.status).toBe(503);
    expect(refused.body).toEqual({ error: 'daily-limit', retryAfterSeconds: 3_600 });
    expect(refused.headers.get('retry-after')).toBe('3600');
    // The slot is kept: the hourly limit still bounds a visitor who retries (review of A5 part 3).
    const events = await d1.db.prepare('SELECT COUNT(*) AS n FROM rate_events').all<{ n: number }>();
    expect(events.results[0]?.n).toBe(1);
    const scans = await d1.db.prepare("SELECT status, error FROM scans").all<{ status: string; error: string }>();
    expect(scans.results).toEqual([{ status: 'error', error: 'daily-limit' }]);
    // Further starts in this isolate: 503 at once, nothing written, the queue not asked again.
    for (let i = 0; i < 4; i += 1) {
      const again = await start(handler, `andere-${i}.de`, `203.0.113.${20 + i}`);
      expect(again.status).toBe(503);
      expect(again.body.retryAfterSeconds).toBe(3_600);
    }
    expect(asked).toBe(1);
    expect((await d1.db.prepare('SELECT COUNT(*) AS n FROM scans').all<{ n: number }>()).results[0]?.n).toBe(1);
    expect((await d1.db.prepare('SELECT COUNT(*) AS n FROM rate_events').all<{ n: number }>()).results[0]?.n).toBe(1);
    // An error is never reused by the cache: the next day a new scan starts.
    clock += 24 * 3600 * 1000;
    expect((await start(api(), 'beispiel-baeckerei.de')).status).toBe(202);
    clock -= 24 * 3600 * 1000;
  });

  it('allows the lab a higher hourly limit, the default stays 5', async () => {
    const lab = api({ ratePerHour: 7 });
    for (let i = 0; i < 7; i += 1) expect((await start(lab, `beispiel-${i}.de`)).status).toBe(202);
    expect((await start(lab, 'beispiel-7.de')).status).toBe(429);
    await d1.clear();
    const normal = api();
    for (let i = 0; i < 5; i += 1) expect((await start(normal, `beispiel-${i}.de`)).status).toBe(202);
    expect((await start(normal, 'beispiel-5.de')).status).toBe(429);
  });

  it('ends scans stuck for half an hour in the hourly cleanup', async () => {
    const job = await queuedJob();
    expect(await endStuckScans(d1.db, clock + STUCK_MS - 1)).toBe(0);
    expect(await endStuckScans(d1.db, clock + STUCK_MS + 1)).toBe(1);
    expect(await getScan(d1.db, job.id)).toMatchObject({ status: 'error' });
  });
});

describe('the API Worker only passes the start on (A5 part 5)', () => {
  function stub(answer: (path: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: { path: string; body: unknown }[] = [];
    return {
      calls,
      stub: {
        fetch: async (input: string, init?: RequestInit) => {
          const url = new URL(input);
          calls.push({ path: `${url.pathname}${url.search}`, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
          return answer(url.pathname, init);
        },
      },
    };
  }

  /** A D1 binding that fails the test on any use: the start must not touch D1 in the API Worker. */
  const noD1 = new Proxy({} as D1Database, {
    get: () => {
      throw new Error('the API Worker used D1 for a start');
    },
  });

  function startRequest(url: string, ip = '203.0.113.7'): Request {
    return new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ url }) });
  }

  it('sends the normalized address and the visitor key to the queue object, and nothing else', async () => {
    const s = stub(() => Response.json({ id: 'x', status: 'queued' }, { status: 202 }));
    const client = queueClient(s.stub);
    const handler = createApi({ db: noD1, start: (input) => client.start(input) });
    const response = await handler(startRequest('https://EXAMPLE.com/irgendwo?x=1'));
    expect(response.status).toBe(202);
    expect(s.calls).toEqual([{ path: '/start', body: { url: 'https://example.com/', visitor: '4:3405803783' } }]);
    // The lab's switches only when set.
    await createApi({ db: noD1, start: (input) => client.start(input), ratePerHour: 40, force: 'quick' })(startRequest('example.com', '2001:db8:aa:bbcc::1'));
    expect(s.calls[1]?.body).toEqual({ url: 'https://example.com/', visitor: '6:2001:db8:aa:bb00/56', ratePerHour: 40, force: 'quick' });
  });

  it('refuses an address by the rules without DNS before anything leaves the Worker', async () => {
    const s = stub(() => Response.json({}, { status: 202 }));
    const handler = createApi({ db: noD1, start: (input) => queueClient(s.stub).start(input) });
    for (const url of ['http://127.0.0.1/', 'localhost', 'https://beispiel.de:8080/', 'javascript:alert(1)']) expect((await handler(startRequest(url))).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it("returns the object's answer unparsed with the API's headers and Retry-After", async () => {
    const body = '{"error":"rate-limited","retryAfterSeconds":3300}';
    const handler = createApi({ db: noD1, start: async () => new Response(body, { status: 429, headers: { 'retry-after': '3300' } }) });
    const response = await handler(startRequest('example.com'));
    expect(response.status).toBe(429);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('retry-after')).toBe('3300');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 503 queue-unavailable when the object fails or cannot be reached', async () => {
    for (const start of [async () => new Response('{"error":"failed"}', { status: 500 }), async () => Promise.reject(new Error('object reset'))]) {
      const response = await createApi({ db: noD1, start })(startRequest('example.com'));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'queue-unavailable' });
      expect(response.headers.get('retry-after')).toBe('60');
    }
  });

  it('the object takes only the shape the API Worker sends', () => {
    expect(parseStartInput({ url: 'https://example.com/', visitor: '4:1' })).toEqual({ url: 'https://example.com/', visitor: '4:1' });
    expect(parseStartInput({ url: 'https://example.com/', visitor: '4:1', ratePerHour: 40, force: 'quick' })).toEqual({ url: 'https://example.com/', visitor: '4:1', ratePerHour: 40, force: 'quick' });
    for (const bad of [null, [], 'x', { url: 'https://example.com/' }, { url: 'https://EXAMPLE.com/x', visitor: '4:1' }, { url: 'http://127.0.0.1/', visitor: '4:1' }, { url: 'https://example.com/', visitor: '' }, { url: 'https://example.com/', visitor: '4:1', ratePerHour: 0 }, { url: 'https://example.com/', visitor: '4:1', ratePerHour: 1.5 }, { url: 'https://example.com/', visitor: '4:1', force: 'full' }]) {
      expect(parseStartInput(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('a start of the whole Worker entry goes to the queue binding, never to D1', async () => {
    const s = stub(() => Response.json({ cached: true }, { status: 200 }));
    const namespace = { jurisdiction: () => namespace, idFromName: (name: string) => name, get: () => s.stub } as unknown as DurableObjectNamespace;
    const response = await handleRequest(startRequest('example.com'), { DB: noD1, SCAN_QUEUE: namespace });
    expect(response.status).toBe(200);
    expect(s.calls.map((c) => c.path)).toEqual(['/start']);
  });

  it('in the object: a scan the queue cannot take is marked as an error and answered 503', async () => {
    const result = await start(api({ dispatch: () => Promise.reject(new Error('storage failed')) }), 'beispiel-baeckerei.de');
    expect(result.status).toBe(503);
    expect(result.body.error).toBe('queue-unavailable');
    expect(result.headers.get('retry-after')).toBe('60');
    const scans = await d1.db.prepare('SELECT status, error FROM scans').all<{ status: string; error: string }>();
    expect(scans.results).toEqual([{ status: 'error', error: 'dispatch failed' }]);
  });

  it('reads the position, and null when the object does not answer', async () => {
    expect(await queueClient(stub(() => Response.json({ position: 2 })).stub).position('abc')).toBe(2);
    expect(await queueClient(stub(() => Response.json({ position: null })).stub).position('abc')).toBeNull();
    expect(await queueClient(stub(() => new Response('x', { status: 500 })).stub).position('abc')).toBeNull();
  });
});
