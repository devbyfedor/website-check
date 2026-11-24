import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUrlGuard, type Resolver } from '@website-check/scanner';
import { newScanId } from '../src/api/ids.ts';
import { localApi } from './api-local.ts';
import { countingD1, localD1, type LocalD1 } from './d1.ts';

/**
 * Session B2 part 2: what the scan screen needs from the API. The status carries the address the visitor entered
 * (`displayHost`) for the heading; `POST /api/scans/{id}/cancel` passes "Prüfung abbrechen" to the queue object and
 * answers 204 whatever the queue did. Also the cost of one status request in D1 (`docs/d1.md`).
 */

const resolver: Resolver = async () => ['93.184.215.14'];
const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';
const clock = Date.UTC(2026, 10, 24, 9, 0, 0);
let d1: LocalD1;

function api(db: D1Database = d1.db, cancel?: (id: string, token: string) => Promise<void>): (request: Request) => Promise<Response> {
  const guard = createUrlGuard({ resolve: resolver });
  return localApi({ db, check: (url) => guard.check(url), secret: SECRET, now: () => clock, ...(cancel !== undefined ? { cancel } : {}) });
}

async function start(url: string): Promise<Record<string, unknown>> {
  const response = await api()(new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ url }) }));
  return (await response.json()) as Record<string, unknown>;
}

function cancelRequest(id: string, body: string, init: { method?: string; contentType?: string } = {}): Request {
  return new Request(`https://website-check.test/api/scans/${id}/cancel`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': init.contentType ?? 'application/json' },
    ...(init.method === 'GET' ? {} : { body }),
  });
}

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.clear();
});

describe('status for the scan screen', () => {
  it('the start and the status carry the entered address as the report shows it, decoded only for Latin letters', async () => {
    const started = await start('Bäckerei-Beispiel.de');
    expect(started.displayHost).toBe('bäckerei-beispiel.de');
    const status = (await (await api()(new Request(`https://website-check.test/api/scans/${String(started.id)}`))).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ id: started.id, status: 'queued', displayHost: 'bäckerei-beispiel.de' });
    // A cancel token is handed out only with the start, never with the status.
    expect(status).not.toHaveProperty('cancelToken');
  });

  it('one status request is one D1 query that reads two rows (the scan and its site)', async () => {
    const started = await start('kaffee-beispiel.de');
    const counting = countingD1(d1.db);
    const response = await api(counting.db)(new Request(`https://website-check.test/api/scans/${String(started.id)}`));
    expect(response.status).toBe(200);
    expect(counting.queries()).toBe(1);
    expect(counting.read()).toBe(2);
    expect(counting.written()).toBe(0);
  });
});

describe('POST /api/scans/{id}/cancel', () => {
  const id = newScanId();
  const token = newScanId();

  it('passes id and token to the queue and answers 204 without a body, whatever the queue did', async () => {
    const calls: string[] = [];
    const response = await api(d1.db, async (i, t) => void calls.push(`${i} ${t}`))(cancelRequest(id, JSON.stringify({ token })));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(calls).toEqual([`${id} ${token}`]);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses malformed calls before the queue: wrong method, id, token, type or size', async () => {
    const calls: string[] = [];
    const handler = api(d1.db, async (i) => void calls.push(i));
    expect((await handler(cancelRequest(id, '', { method: 'GET' }))).status).toBe(405);
    expect((await handler(cancelRequest('kein-id', JSON.stringify({ token })))).status).toBe(404);
    expect((await handler(cancelRequest(id, JSON.stringify({ token: 'kurz' })))).status).toBe(400);
    expect((await handler(cancelRequest(id, JSON.stringify([token])))).status).toBe(400);
    expect((await handler(cancelRequest(id, '{"token":'))).status).toBe(400);
    expect((await handler(cancelRequest(id, JSON.stringify({ token }), { contentType: 'text/plain' }))).status).toBe(415);
    expect((await handler(cancelRequest(id, JSON.stringify({ token, pad: 'x'.repeat(3000) })))).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('answers 503 when the queue object does not answer, and when there is no queue', async () => {
    const failing = api(d1.db, async () => {
      throw new Error('object unreachable');
    });
    expect((await failing(cancelRequest(id, JSON.stringify({ token })))).status).toBe(503);
    expect((await api()(cancelRequest(id, JSON.stringify({ token })))).status).toBe(503);
  });
});
