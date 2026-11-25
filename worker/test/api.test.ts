import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsp, checkHsts, checkPermissionsPolicy, checkReferrerPolicy, checkXcto, createUrlGuard, type Resolver } from '@website-check/scanner';
import { base32, isScanId, newScanId } from '../src/api/ids.ts';
import { visitorKeyOf } from '../src/api/rate-limit.ts';
import { API_HEADERS, MAX_BODY_BYTES } from '../src/api/router.ts';
import { HSTS, PERMISSIONS_POLICY, SITE_HEADERS } from '../src/api/site-headers.ts';
import { purgeBefore, saveResult } from '../src/db/store.ts';
import worker from '../src/app.ts';
import { localApi } from './api-local.ts';
import { D1_TEST_TIMEOUT_MS, localD1, TABLES, WORKER_ROOT, type LocalD1 } from './d1.ts';

// Tests against the local D1 measure no time; the timeout only stops one whose local D1 never answers (test/d1.ts).
vi.setConfig({ testTimeout: D1_TEST_TIMEOUT_MS, hookTimeout: D1_TEST_TIMEOUT_MS });

/**
 * The API on the local D1 (session A5 part 2): cache, rate limit, refusals before the queue, ids,
 * status and report. Names resolve through a fake resolver; nothing leaves the machine.
 */

const PUBLIC = '93.184.215.14';
const NAMES: Record<string, string[] | 'fail'> = {
  'intern-beispiel.de': ['127.0.0.1'],
  'heimnetz-beispiel.de': [PUBLIC, '192.168.1.10'],
  'leer-beispiel.de': [],
  'dnsfehler-beispiel.de': 'fail',
};
const resolver: Resolver = async (host) => {
  const answer = NAMES[host];
  if (answer === 'fail') throw new Error('resolver down');
  return answer ?? [PUBLIC];
};

let d1: LocalD1;
let clock = Date.UTC(2026, 10, 23, 9, 0, 0);
const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';

function api(dispatch?: (scan: { id: string; url: string }) => Promise<void>): (request: Request) => Promise<Response> {
  const guard = createUrlGuard({ resolve: resolver });
  return localApi({ db: d1.db, check: (url) => guard.check(url), secret: SECRET, now: () => clock, ...(dispatch !== undefined ? { dispatch } : {}) });
}

function post(url: unknown, ip: string | null = '203.0.113.7', init: { contentType?: string; body?: BodyInit } = {}): Request {
  const headers: Record<string, string> = { 'content-type': init.contentType ?? 'application/json' };
  if (ip !== null) headers['cf-connecting-ip'] = ip;
  return new Request('https://website-check.test/api/scans', { method: 'POST', headers, body: init.body ?? JSON.stringify({ url }) });
}

async function start(url: string, ip?: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await api()(post(url, ip));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function count(table: string): Promise<number> {
  const result = await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all<{ n: number }>();
  return result.results[0]?.n ?? -1;
}

async function finish(id: string, state: 'complete' | 'quick' | 'blocked' | 'failed', report = '{"schemaVersion":1}', mode: 'full' | 'quick' = state === 'quick' ? 'quick' : 'full'): Promise<void> {
  await saveResult(d1.db, { id, now: clock, state, mode, reportVersion: 1, reportJson: report, country: 'IT', colo: 'MXP', findings: [], hosts: [] });
}

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.clear();
  clock = Date.UTC(2026, 10, 23, 9, 0, 0);
});

describe('POST /api/scans and the 24-hour cache', () => {
  it('a new address gets a new random id and a queued scan', async () => {
    const { status, body } = await start('kaffee-beispiel.de');
    expect(status).toBe(202);
    expect(body).toMatchObject({ status: 'queued', cached: false, state: null, createdAt: '2026-11-23T09:00:00.000Z' });
    expect(isScanId(String(body.id))).toBe(true);
    expect(body.statusUrl).toBe(`/api/scans/${String(body.id)}`);
    const site = await d1.db.prepare('SELECT url, host FROM sites').all();
    expect(site.results).toEqual([{ url: 'https://kaffee-beispiel.de/', host: 'kaffee-beispiel.de' }]);
  });

  it('the same normalized address within 24 hours gets the same id, also in other spellings', async () => {
    const first = await start('kaffee-beispiel.de');
    for (const spelling of ['KAFFEE-BEISPIEL.DE', 'https://kaffee-beispiel.de/shop/?seite=2#oben', 'kaffee-beispiel.de.', ' https://kaffee-beispiel.de:443 ']) {
      clock += 60_000;
      const again = await start(spelling, '198.51.100.20');
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id: first.body.id, cached: true });
    }
    expect(await count('scans')).toBe(1);
    // http:// and www. are other addresses: the scan starts where the visitor said.
    expect((await start('http://kaffee-beispiel.de')).status).toBe(202);
    expect((await start('www.kaffee-beispiel.de')).status).toBe(202);
  });

  it('a finished complete or blocked scan is reused for 24 hours, then a new scan starts', async () => {
    const first = await start('kaffee-beispiel.de');
    await finish(String(first.body.id), 'complete');
    clock += 24 * 3_600_000 - 1000;
    expect((await start('kaffee-beispiel.de')).body).toMatchObject({ id: first.body.id, cached: true, status: 'done', state: 'complete' });
    clock += 2000;
    const later = await start('kaffee-beispiel.de');
    expect(later.status).toBe(202);
    expect(later.body.id).not.toBe(first.body.id);

    const blocked = await start('geblockt-beispiel.de');
    await finish(String(blocked.body.id), 'blocked');
    expect((await start('geblockt-beispiel.de')).body).toMatchObject({ id: blocked.body.id, cached: true });
  });

  it('a quick check or a failed scan is not reused', async () => {
    const quick = await start('schnell-beispiel.de');
    await finish(String(quick.body.id), 'quick');
    const failed = await start('fehler-beispiel.de');
    await finish(String(failed.body.id), 'failed');
    clock += 60_000;
    expect((await start('schnell-beispiel.de')).status).toBe(202);
    expect((await start('fehler-beispiel.de')).status).toBe(202);
  });

  it('a queued scan is joined for 10 minutes, then taken as stuck', async () => {
    const first = await start('kaffee-beispiel.de');
    clock += 9 * 60_000;
    expect((await start('kaffee-beispiel.de')).body).toMatchObject({ id: first.body.id, cached: true, status: 'queued' });
    clock += 2 * 60_000;
    expect((await start('kaffee-beispiel.de')).status).toBe(202);
  });

  it('two visitors at the same moment get one scan', async () => {
    const [a, b] = await Promise.all([start('kaffee-beispiel.de', '203.0.113.1'), start('kaffee-beispiel.de', '203.0.113.2')]);
    expect(a?.body.id).toBe(b?.body.id);
    expect([a?.status, b?.status].sort()).toEqual([200, 202]);
    expect(await count('scans')).toBe(1);
  });

  it('hands a new scan to the queue, and a queue that fails gives 503 and no stuck scan', async () => {
    const handed: string[] = [];
    const ok = await api(async (scan) => void handed.push(scan.url))(post('kaffee-beispiel.de'));
    expect(ok.status).toBe(202);
    expect(handed).toEqual(['https://kaffee-beispiel.de/']);
    const failing = await api(async () => {
      throw new Error('down');
    })(post('tee-beispiel.de'));
    expect(failing.status).toBe(503);
    const rows = await d1.db.prepare("SELECT status FROM scans WHERE site_id = (SELECT id FROM sites WHERE url = 'https://tee-beispiel.de/')").all<{ status: string }>();
    expect(rows.results).toEqual([{ status: 'error' }]);
    // The failed scan is not a cache entry: the next try starts again.
    expect((await start('tee-beispiel.de')).status).toBe(202);
  });
});

describe('rate limit: 5 scans per hour per visitor, hashed IP with a daily salt', () => {
  it('allows 5 new scans, refuses the sixth with Retry-After, and allows again after the hour', async () => {
    for (let i = 1; i <= 5; i += 1) {
      expect((await start(`laden${i}-beispiel.de`)).status).toBe(202);
      clock += 60_000;
    }
    const response = await api()(post('laden6-beispiel.de'));
    expect(response.status).toBe(429);
    const body = (await response.json()) as { retryAfterSeconds: number };
    expect(body).toMatchObject({ error: 'rate-limited' });
    expect(body.retryAfterSeconds).toBe(3600 - 300);
    expect(response.headers.get('retry-after')).toBe(String(3600 - 300));
    expect(await count('scans')).toBe(5);
    clock += body.retryAfterSeconds * 1000;
    expect((await start('laden6-beispiel.de')).status).toBe(202);
  });

  it('counts each visitor apart, IPv6 by its /56, IPv4-mapped IPv6 as the IPv4 address', async () => {
    for (let i = 1; i <= 5; i += 1) expect((await start(`v6-${i}-beispiel.de`, `2001:db8:1:2${i}::${i}`)).status).toBe(202);
    expect((await start('v6-6-beispiel.de', '2001:db8:1:2:ffff:ffff:ffff:ffff')).status).toBe(429);
    // Another /64 of the same delegated /56 is the same visitor (review of A5 part 2).
    expect((await start('v6-6b-beispiel.de', '2001:db8:1:ff::1')).status).toBe(429);
    expect((await start('v6-7-beispiel.de', '2001:db8:1:100::1')).status).toBe(202);
    for (let i = 1; i <= 5; i += 1) expect((await start(`v4-${i}-beispiel.de`, '198.51.100.9')).status).toBe(202);
    expect((await start('v4-6-beispiel.de', '::ffff:198.51.100.9')).status).toBe(429);
    expect(visitorKeyOf('::ffff:198.51.100.9')).toBe(visitorKeyOf('198.51.100.9'));
    expect(visitorKeyOf(null)).toBe('unknown');
    expect(visitorKeyOf('kein-ip')).toBe('unknown');
  });

  it('a cached answer, a refused address and a refused request take no slot', async () => {
    const cached = await start('kaffee-beispiel.de');
    for (let i = 0; i < 10; i += 1) expect((await start('kaffee-beispiel.de')).body.id).toBe(cached.body.id);
    for (let i = 0; i < 10; i += 1) expect((await start('localhost')).status).toBe(400);
    expect(await count('rate_state')).toBe(1);
    for (let i = 2; i <= 5; i += 1) expect((await start(`laden${i}-beispiel.de`)).status).toBe(202);
    expect((await start('laden6-beispiel.de')).status).toBe(429);
    expect((await start('kaffee-beispiel.de')).status).toBe(200);
  });

  it('stores no raw IP address anywhere, and the salt changes every day', async () => {
    const ips = ['203.0.113.77', '2001:db8:abcd:12::99'];
    for (const ip of ips) await start(`ip-${ips.indexOf(ip)}-beispiel.de`, ip);
    const dump: string[] = [];
    for (const table of TABLES) dump.push(JSON.stringify((await d1.db.prepare(`SELECT * FROM ${table}`).all()).results));
    const all = dump.join('\n');
    for (const needle of ['203.0.113.77', '2001:db8:abcd:12', '2001:0db8', '4:3405803853', '6:2001:db8:abcd:0/56', SECRET]) expect(all).not.toContain(needle);

    const hashes = async (): Promise<string[]> => (await d1.db.prepare('SELECT visitor FROM rate_state ORDER BY day').all<{ visitor: string }>()).results.map((r) => r.visitor);
    await d1.clear();
    await start('tag1-beispiel.de', '203.0.113.77');
    const [day1] = await hashes();
    clock += 24 * 3_600_000;
    // The row of the day before is deleted with the salt of the new day.
    await start('tag2-beispiel.de', '203.0.113.77');
    const [day2] = await hashes();
    expect(day1).toMatch(/^[0-9a-f]{32}$/);
    expect(day2).toMatch(/^[0-9a-f]{32}$/);
    expect(day1).not.toBe(day2);
    const salts = await d1.db.prepare('SELECT day FROM rate_salts').all<{ day: string }>();
    expect(salts.results).toEqual([{ day: '2026-11-24' }]);
  });

  it('without the secret no scan starts (fail closed), and nothing is written', async () => {
    const guard = createUrlGuard({ resolve: resolver });
    for (const secret of [undefined, 'zu-kurz']) {
      const response = await localApi({ db: d1.db, check: (url) => guard.check(url), secret, now: () => clock })(post('kaffee-beispiel.de'));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'not-configured' });
    }
    for (const table of TABLES) expect(await count(table), table).toBe(0);
  });

  it('two starts of the same address at the same moment by one visitor take one slot', async () => {
    const [a, b] = await Promise.all([start('kaffee-beispiel.de'), start('kaffee-beispiel.de')]);
    expect([a?.status, b?.status].sort()).toEqual([200, 202]);
    expect(await count('rate_state')).toBe(1);
  });

  it('a request without the visitor header shares one limit', async () => {
    for (let i = 1; i <= 5; i += 1) expect((await start(`ohne${i}-beispiel.de`, null)).status).toBe(202);
    expect((await start('ohne6-beispiel.de', null)).status).toBe(429);
  });
});

describe('refused addresses get 400 before anything is queued or counted', () => {
  it.each([
    ['localhost', 'address-not-allowed', 'host-name'],
    ['127.0.0.1', 'address-not-allowed', 'address'],
    ['http://10.1.2.3/', 'address-not-allowed', 'address'],
    ['http://[::1]/', 'address-not-allowed', 'address'],
    ['0x7f000001', 'address-not-allowed', 'address'],
    ['http://169.254.169.254/latest/meta-data/', 'address-not-allowed', 'address'],
    ['kaffee-beispiel.de:8080', 'address-not-allowed', 'port'],
    ['ftp://kaffee-beispiel.de/', 'address-not-allowed', 'scheme'],
    ['javascript:alert(1)', 'address-not-allowed', 'scheme'],
    ['https://nutzer:pass@kaffee-beispiel.de/', 'address-not-allowed', 'credentials'],
    ['intranet', 'address-not-allowed', 'host-name'],
    ['drucker.local', 'address-not-allowed', 'host-name'],
    ['intern-beispiel.de', 'address-not-allowed', 'address'],
    ['heimnetz-beispiel.de', 'address-not-allowed', 'address'],
    ['leer-beispiel.de', 'address-not-found', undefined],
    ['', 'invalid-address', undefined],
    ['kaffee beispiel.de', 'invalid-address', undefined],
  ])('%j → 400 %s', async (input, code, reason) => {
    const response = await api()(post(input));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; reason?: string };
    expect(body.error).toBe(code);
    expect(body.reason).toBe(reason);
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    expect(await count('scans')).toBe(0);
    expect(await count('sites')).toBe(0);
    expect(await count('rate_state')).toBe(0);
  });

  it('a resolver failure is unsure: 503, nothing queued', async () => {
    const response = await api()(post('dnsfehler-beispiel.de'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'dns-unavailable' });
    expect(await count('scans')).toBe(0);
  });

  it('refuses bodies that are not a small JSON object with a url', async () => {
    expect((await api()(post('kaffee-beispiel.de', '203.0.113.7', { contentType: 'text/plain' }))).status).toBe(415);
    expect((await api()(post(null, '203.0.113.7', { body: '{"url":' }))).status).toBe(400);
    expect((await api()(post(null, '203.0.113.7', { body: '{"url": 42}' }))).status).toBe(400);
    expect((await api()(post(null, '203.0.113.7', { body: '["kaffee-beispiel.de"]' }))).status).toBe(400);
    const big = JSON.stringify({ url: 'kaffee-beispiel.de', pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await api()(post(null, '203.0.113.7', { body: big }))).status).toBe(413);
    // Without a length header: the stream is read only up to the limit.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
      },
    });
    const chunked = new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await api()(chunked)).status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(await count('scans')).toBe(0);
  });

  it('answers 405 for other methods and 404 for other paths', async () => {
    const get = await api()(new Request('https://website-check.test/api/scans'));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await api()(new Request(`https://website-check.test/api/scans/${newScanId()}`, { method: 'DELETE' }))).status).toBe(405);
    expect((await api()(new Request('https://website-check.test/api/andere'))).status).toBe(404);
  });
});

describe('status and report', () => {
  it('gives the status of a scan and 404 for unknown or malformed ids', async () => {
    const { body } = await start('kaffee-beispiel.de');
    const status = await api()(new Request(`https://website-check.test/api/scans/${String(body.id)}`));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ id: body.id, status: 'queued', cached: false });
    expect((await api()(new Request(`https://website-check.test/api/scans/${newScanId()}`))).status).toBe(404);
    expect((await api()(new Request('https://website-check.test/api/scans/1234'))).status).toBe(404);
    expect((await api()(new Request("https://website-check.test/api/scans/a'%20OR%201=1"))).status).toBe(404);
  });

  it('returns the stored report text byte for byte, 409 while the scan runs', async () => {
    const { body } = await start('kaffee-beispiel.de');
    const id = String(body.id);
    const notReady = await api()(new Request(`https://website-check.test/api/scans/${id}/report`));
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toEqual({ error: 'not-ready', status: 'queued' });
    // Unusual spacing and key order: a Worker that parsed and serialized again would change them.
    const stored = `{ "schemaVersion" : 1,\n  "id":"${id}", "z": 1, "a": [1,2 ,3], "big": "${'ü'.repeat(300_000)}" }`;
    await finish(id, 'complete', stored);
    const report = await api()(new Request(`https://website-check.test/api/scans/${id}/report`));
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await report.text()).toBe(stored);
    const head = await api()(new Request(`https://website-check.test/api/scans/${id}/report`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('every answer says not to index and not to store it', async () => {
    const { body } = await start('kaffee-beispiel.de');
    const responses = [
      await api()(post('kaffee-beispiel.de')),
      await api()(post('localhost')),
      await api()(new Request(`https://website-check.test/api/scans/${String(body.id)}`)),
      await api()(new Request(`https://website-check.test/api/scans/${String(body.id)}/report`)),
      await api()(new Request('https://website-check.test/nichts')),
    ];
    for (const response of responses) {
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      // Session B5 part 2: the security headers of the site on every answer of the API too.
      expect(response.headers.get('strict-transport-security')).toBe(HSTS);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    }
  });

  it('every header of the site is one our own scanner counts (the five headers of the brief)', () => {
    const headers = { ...API_HEADERS };
    const checks = [
      checkCsp(headers['content-security-policy'], undefined, null),
      checkXcto(headers['x-content-type-options']),
      checkPermissionsPolicy(headers['permissions-policy'], undefined),
      checkHsts(headers['strict-transport-security'], true),
      checkReferrerPolicy(headers['referrer-policy'], null),
      checkReferrerPolicy(SITE_HEADERS['Referrer-Policy'], null),
    ];
    for (const c of checks) expect(c.counts, c.key).toBe(true);
    expect(PERMISSIONS_POLICY).toContain('camera=()');
    expect(PERMISSIONS_POLICY).toContain('clipboard-write=(self)');
    expect(PERMISSIONS_POLICY).not.toMatch(/\*/);
  });

  it('the Worker parses only the small request body, never a report', () => {
    const router = readFileSync(resolve(WORKER_ROOT, 'src/api/router.ts'), 'utf8');
    const store = readFileSync(resolve(WORKER_ROOT, 'src/db/store.ts'), 'utf8');
    expect(router.match(/JSON\.parse\(/g)).toHaveLength(1);
    expect(router).toMatch(/const text = await readSmallBody\(request\);[\s\S]{0,200}JSON\.parse\(text\)/);
    expect(store).not.toMatch(/JSON\.parse\(|\.json\(\)/);
  });
});

describe('store edge cases (review of A5 part 2)', () => {
  it('saving the same result twice returns false instead of failing, and adds no rows', async () => {
    const { body } = await start('kaffee-beispiel.de');
    const id = String(body.id);
    const input = { id, now: clock, state: 'complete' as const, mode: 'full' as const, reportVersion: 1, reportJson: '{}', country: null, colo: null, findings: [{ findingId: 'a11y:label', area: 'accessibility', kind: 'finding', risk: 'medium', textId: 'a11y-label', serviceKey: null }], hosts: [{ host: 'kaffee-beispiel.de', party: 'first' as const, serviceKey: null, requestCount: 3, firstStartMs: 0, lastEndMs: 90, beforeBanner: null }] };
    expect(await saveResult(d1.db, input)).toBe(true);
    expect(await saveResult(d1.db, input)).toBe(false);
    expect(await count('findings')).toBe(1);
    expect(await count('network_requests')).toBe(1);
  });

  it('the retention delete counts scans, not the rows of the cascade', async () => {
    for (const name of ['a', 'b']) {
      const { body } = await start(`${name}-beispiel.de`);
      await saveResult(d1.db, { id: String(body.id), now: clock, state: 'complete', mode: 'full', reportVersion: 1, reportJson: '{}', country: null, colo: null, findings: [{ findingId: 'a11y:label', area: 'accessibility', kind: 'finding', risk: 'medium', textId: 'a11y-label', serviceKey: null }], hosts: [] });
    }
    expect(await purgeBefore(d1.db, clock + 1)).toEqual({ scans: 2, sites: 2 });
    expect(await count('findings')).toBe(0);
  });

  it('the hourly cleanup deletes old salts and visitor rows without any scan', async () => {
    await start('kaffee-beispiel.de');
    clock += 25 * 3_600_000;
    const env = { DB: d1.db };
    await worker.scheduled({ scheduledTime: clock, cron: '0 * * * *', noRetry() {} } as ScheduledController, env);
    expect(await count('rate_salts')).toBe(0);
    expect(await count('rate_state')).toBe(0);
  });
});

describe('scan ids', () => {
  it('are 26 characters of base32 from 128 random bits, never repeated', () => {
    expect(base32(new TextEncoder().encode('foobar'))).toBe('mzxw6ytboi');
    expect(base32(new Uint8Array(16))).toBe('a'.repeat(26));
    const ids = new Set(Array.from({ length: 2000 }, () => newScanId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[a-z2-7]{26}$/);
  });
});
