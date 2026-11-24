import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUrlGuard } from '@website-check/scanner';
import { START_LIMIT } from '../src/api/rate-limit.ts';
import { MemoryKv, QUEUE_LIMITS, ScanQueue } from '../src/queue/core.ts';
import { localApi } from './api-local.ts';
import { countingD1, localD1, TABLES, type LocalD1 } from './d1.ts';

/**
 * Review findings 89, 91 and 46 (session fix-a5), built from the review's reproductions (privacy and D1 of the
 * queue path) on the local D1 with a fake name resolver and invented addresses:
 * - 89: the cache answered without any limit, so a visitor who had used up the scans could still ask, for any
 *   list of addresses, which ones other visitors had checked (200 with the time of the other check, or 429);
 * - 91: the rate-limit event stored the start time to the millisecond, the same value as `scans.created_at`,
 *   so one JOIN by time tied a visitor's hash to the site;
 * - 46: the day cap of the queue lived only in the object's memory: after an eviction every refused start wrote
 *   seven or eight rows (a site, a scan with the error `daily-limit`, the rate-limit rows).
 */

const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';
const T0 = Date.UTC(2026, 10, 23, 9, 0, 0, 123);

let d1: LocalD1;
let clock = T0;
const guard = createUrlGuard({ resolve: async () => ['93.184.215.14'] });

function api(extra: Partial<Parameters<typeof localApi>[0]> = {}) {
  return localApi({ db: d1.db, check: (url) => guard.check(url), secret: SECRET, now: () => clock, ...extra });
}

async function post(handler: (r: Request) => Promise<Response>, url: string, ip: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handler(new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ url }) }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The first scan finished as a full check, so the 24-hour cache reuses it. */
async function finishAll(): Promise<void> {
  await d1.db.prepare("UPDATE scans SET status = 'done', state = 'complete', mode = 'full', report = '{}', started_at = created_at + 500, finished_at = created_at + 9000").run();
}

async function rows<T>(sql: string): Promise<T[]> {
  return (await d1.db.prepare(sql).all<T>()).results;
}

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.clear();
  clock = T0;
});

describe('finding 89: the cache is no free oracle of what others checked', () => {
  it('a visitor who used up the scans cannot ask more than the start budget, and then hit and miss look the same', async () => {
    const handler = api();
    // Another visitor checks a site.
    expect((await post(handler, 'friseur-muster-beispiel.de', '198.51.100.7')).status).toBe(202);
    await finishAll();
    clock += 5 * 3_600_000;
    // The prober uses up the five scans of the hour.
    for (let i = 1; i <= 5; i += 1) expect((await post(handler, `fueller-${i}-beispiel.de`, '198.51.100.9')).status).toBe(202);
    expect((await post(handler, 'nie-geprueft-beispiel.de', '198.51.100.9')).body.limit).toBe('hour');
    // 50 probes of the checked site, as in the review: before the fix all 50 answered 200 with the other check's times.
    let answered = 0;
    for (let i = 0; i < 50; i += 1) if ((await post(handler, 'friseur-muster-beispiel.de', '198.51.100.9')).status === 200) answered += 1;
    // Six starts were used above; the rest of the hour's 20 starts are the only answers.
    expect(answered).toBe(20 - 6);
    const hit = await post(handler, 'friseur-muster-beispiel.de', '198.51.100.9');
    const miss = await post(handler, 'nie-geprueft-2-beispiel.de', '198.51.100.9');
    expect(hit).toEqual(miss);
    expect(hit.status).toBe(429);
    expect(hit.body.limit).toBe('starts');
  });

  it('the start budget of the day holds across hours, and a new day starts again', async () => {
    const handler = api();
    expect((await post(handler, 'friseur-muster-beispiel.de', '198.51.100.7')).status).toBe(202);
    await finishAll();
    let answered = 0;
    for (let hour = 0; hour < 4; hour += 1) {
      for (let i = 0; i < 20; i += 1) if ((await post(handler, 'friseur-muster-beispiel.de', '198.51.100.9')).status === 200) answered += 1;
      clock += 3_600_000 + 1;
    }
    expect(answered).toBe(60);
    const refused = await post(handler, 'friseur-muster-beispiel.de', '198.51.100.9');
    expect(refused.status).toBe(429);
    expect(refused.body.limit).toBe('starts');
    clock = Date.UTC(2026, 10, 24, 0, 0, 1);
    expect((await post(handler, 'friseur-muster-beispiel.de', '198.51.100.9')).status).toBe(200);
  });

  it('the start budget is 20 per hour and 60 per UTC day', () => {
    expect(START_LIMIT).toEqual({ hour: 20, day: 60 });
  });

  it('control: an ordinary visitor still gets the cached report without using a scan', async () => {
    const handler = api();
    const first = await post(handler, 'friseur-muster-beispiel.de', '198.51.100.7');
    const again = await post(handler, 'friseur-muster-beispiel.de', '198.51.100.8');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    for (let i = 1; i <= 5; i += 1) expect((await post(handler, `laden-${i}-beispiel.de`, '198.51.100.8')).status).toBe(202);
  });
});

describe('finding 91: the database does not tie a visitor to a checked site', () => {
  it('no time of a start is stored with the visitor hash; no JOIN by time is possible', async () => {
    const handler = api();
    for (const [i, ip] of ['203.0.113.77', '203.0.113.78', '2001:db8:abcd:12::99'].entries()) {
      clock = T0 + i * 61_000;
      expect((await post(handler, `seite-${i}-beispiel.de`, ip)).status).toBe(202);
    }
    // The review's JOIN, now on the only table with visitor data: it has no time column at all.
    const columns = (await rows<{ name: string }>("SELECT name FROM pragma_table_info('rate_state')")).map((c) => c.name).sort();
    expect(columns).toEqual(['day', 'state', 'visitor']);
    expect(await rows("SELECT name FROM sqlite_master WHERE name IN ('rate_events', 'rate_daily')")).toEqual([]);
    // No time of any scan appears in any table that holds a visitor hash, in any notation.
    const scans = await rows<{ created_at: number; started_at: number | null; finished_at: number | null }>('SELECT created_at, started_at, finished_at FROM scans');
    const rateDump = JSON.stringify(await rows('SELECT * FROM rate_state')) + JSON.stringify(await rows('SELECT * FROM rate_salts'));
    for (const scan of scans) {
      for (const t of [scan.created_at, scan.started_at, scan.finished_at]) {
        if (t === null) continue;
        for (const form of [String(t), String(Math.floor(t / 1000)), String(Math.floor(t / 60_000)), new Date(t).toISOString().slice(11, 16)]) expect(rateDump).not.toContain(form);
      }
    }
    // The state is padded: a visitor with one start and one with many have rows of the same length.
    for (let i = 0; i < 4; i += 1) await post(handler, 'seite-0-beispiel.de', '203.0.113.77');
    const lengths = new Set((await rows<{ n: number }>('SELECT length(state) AS n FROM rate_state')).map((r) => r.n));
    expect(lengths.size).toBe(1);
  });

  it('the rows of the visitor table are in key order, not in the order of the starts', async () => {
    const handler = api();
    const order: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      clock = T0 + i * 1_000;
      await post(handler, `reihe-${i}-beispiel.de`, `203.0.113.${100 + i}`);
      order.push(...(await rows<{ visitor: string }>('SELECT visitor FROM rate_state')).map((r) => r.visitor).filter((v) => !order.includes(v)));
    }
    const stored = (await rows<{ visitor: string }>('SELECT visitor FROM rate_state')).map((r) => r.visitor);
    expect(stored).toEqual([...order].sort());
  });
});

describe('finding 46: after the day cap a refused start writes nothing, also after an eviction of the object', () => {
  it('six refused starts, each in a fresh object (an empty gate in memory): 0 rows written', async () => {
    const queue = new ScanQueue(new MemoryKv(), { ...QUEUE_LIMITS, maxScansPerDay: 1 });
    const counting = countingD1(d1.db);
    // The one scan of the day.
    const first = await post(localApi({ db: d1.db, check: (u) => guard.check(u), secret: SECRET, now: () => clock, dispatch: (scan) => queue.enqueue(scan, clock), dayCap: (now) => queue.dayCapReached(now) }), 'erste-beispiel.de', '203.0.113.5');
    expect(first.status).toBe(202);
    const before: Record<string, unknown> = {};
    for (const table of TABLES) before[table] = await rows(`SELECT * FROM ${table}`);
    const written: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      clock += 120_000;
      // A fresh handler each time, as after an eviction: the gate in memory starts empty ({ until: 0 }).
      const handler = localApi({ db: counting.db, check: (u) => guard.check(u), secret: SECRET, now: () => clock, dailyGate: { until: 0 }, dispatch: (scan) => queue.enqueue(scan, clock), dayCap: (now) => queue.dayCapReached(now) });
      counting.reset();
      const refused = await post(handler, `beispiel-${i}.de`, `203.0.113.${10 + i}`);
      expect(refused.status).toBe(503);
      expect(refused.body.error).toBe('daily-limit');
      written.push(counting.written());
    }
    expect(written).toEqual([0, 0, 0, 0, 0, 0]);
    for (const table of TABLES) expect(await rows(`SELECT * FROM ${table}`), table).toEqual(before[table]);
  });

  it('after the cap also an address with a cached report gets the refusal, so hit and miss look the same', async () => {
    const queue = new ScanQueue(new MemoryKv(), { ...QUEUE_LIMITS, maxScansPerDay: 1 });
    const handler = () => localApi({ db: d1.db, check: (u) => guard.check(u), secret: SECRET, now: () => clock, dailyGate: { until: 0 }, dispatch: (scan) => queue.enqueue(scan, clock), dayCap: (now) => queue.dayCapReached(now) });
    expect((await post(handler(), 'erste-beispiel.de', '203.0.113.5')).status).toBe(202);
    const hit = await post(handler(), 'erste-beispiel.de', '203.0.113.6');
    const miss = await post(handler(), 'zweite-beispiel.de', '203.0.113.6');
    expect(hit).toEqual(miss);
    expect(hit.status).toBe(503);
  });
});
