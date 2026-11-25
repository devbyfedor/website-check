import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UrlVerdict } from '@website-check/scanner/api';
import type { Answer } from '../src/api/answers.ts';
import { cleanupRateLimit, loadState, RATE_LIMIT, RATE_LIMIT_DAY, rateVisitor, releaseSlot, saltOfDay, takeSlot, type RateVisitor, type VisitorState } from '../src/api/rate-limit.ts';
import { startScan, type StartDeps } from '../src/api/start.ts';
import { D1_TEST_TIMEOUT_MS, localD1, type LocalD1 } from './d1.ts';

// Tests against the local D1 measure no time; the timeout only stops one whose local D1 never answers (test/d1.ts).
vi.setConfig({ testTimeout: D1_TEST_TIMEOUT_MS, hookTimeout: D1_TEST_TIMEOUT_MS });

/**
 * The rate limit of the scan start (session fix-a4): findings 8 and 9 of the review. A start that outlives
 * midnight UTC in the name check keeps the newest salt, and a visitor has at most 15 accepted scans per UTC
 * day besides the 5 per hour. The start runs on the local D1 with a controlled clock; the name check is a
 * promise that a test releases by hand. Invented host names only.
 */

const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';
const HOUR = 3_600_000;
const DAY_1 = '2026-11-23';
const DAY_2 = '2026-11-24';
const MORNING = Date.UTC(2026, 10, 23, 9, 0, 0);
const MIDNIGHT = Date.UTC(2026, 10, 24, 0, 0, 0);

let d1: LocalD1;
let clock = MORNING;
let counter = 0;

type Check = (url: string) => Promise<UrlVerdict>;
const allow: Check = async (url) => ({ allowed: true, url, addresses: ['93.184.215.14'], exempt: false });

function deps(check: Check = allow): StartDeps {
  return { db: d1.db, check, secret: SECRET, now: () => clock, dailyGate: { until: 0 } };
}

/** A start of a new address (every call another one) by the visitor `key`. */
function start(key: string, options: { check?: Check; ratePerHour?: number; url?: string } = {}): Promise<Answer> {
  counter += 1;
  const url = options.url ?? `https://adresse-${String(counter).padStart(3, '0')}-beispiel.de/`;
  return startScan({ url, visitor: key, ...(options.ratePerHour !== undefined ? { ratePerHour: options.ratePerHour } : {}) }, deps(options.check));
}

async function rows<T>(sql: string): Promise<T[]> {
  return (await d1.db.prepare(sql).all<T>()).results;
}

/** The visitor's state under the newest salt (since fix-a5 the counts are encrypted in `rate_state`). */
async function stateOf(key: string): Promise<VisitorState & { day: string }> {
  const [salt] = await rows<{ day: string; salt: string }>('SELECT day, salt FROM rate_salts ORDER BY day DESC LIMIT 1');
  if (salt === undefined) throw new Error('no salt');
  const visitor = await rateVisitor(SECRET, salt, key);
  return { ...(await loadState(d1.db, visitor)).state, day: salt.day };
}

/** Accepted scans of the day of the visitors these tests use. */
async function dailyCount(): Promise<number> {
  let n = 0;
  for (const key of ['4:1', '4:2', '4:3']) n += (await stateOf(key)).dayScans;
  return n;
}

function visitorOf(key: string, day: string): Promise<RateVisitor> {
  return rateVisitor(SECRET, { day, salt: day === DAY_1 ? 'a1'.repeat(32) : 'a2'.repeat(32) }, key);
}

const nonces = (state: VisitorState): string[] => state.scans.map(([, nonce]) => nonce);

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.clear();
  clock = MORNING;
  counter = 0;
});

describe('finding 8: a start that outlives midnight keeps the newest salt', () => {
  it('starts of the old day that were waiting in the name check are counted with the new day hash', async () => {
    clock = Date.UTC(2026, 10, 23, 23, 59, 59);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: Check = async (url) => {
      await gate;
      return allow(url);
    };
    // Three starts took the time of the old day and wait in the name check.
    const delayed = [start('4:1', { check: slow }), start('4:1', { check: slow }), start('4:1', { check: slow })];

    // Midnight passes. Five starts of the new day by the same visitor are accepted and create the new salt.
    clock = Date.UTC(2026, 10, 24, 0, 0, 5);
    for (let i = 0; i < 5; i += 1) expect((await start('4:1')).status).toBe(202);

    release();
    const late = await Promise.all(delayed);
    // The visitor already has five scans in this hour: none of the late starts gets a slot.
    expect(late.map((a) => a.status)).toEqual([429, 429, 429]);
    expect(late.map((a) => a.body.limit)).toEqual(['hour', 'hour', 'hour']);
    expect(await rows('SELECT COUNT(*) AS n FROM scans')).toEqual([{ n: 5 }]);
    // Exactly one salt: the late starts did not bring the salt of the old day back.
    expect(await rows('SELECT day FROM rate_salts')).toEqual([{ day: DAY_2 }]);
    expect(await rows('SELECT day FROM rate_state')).toEqual([{ day: DAY_2 }]);
    expect((await stateOf('4:1')).dayScans).toBe(5);
  });

  it('a start stamped before midnight that gets the salt of the new day counts for the new day', async () => {
    clock = Date.UTC(2026, 10, 24, 0, 0, 1);
    expect((await start('4:2')).status).toBe(202);
    const [salt] = await rows<{ day: string; salt: string }>('SELECT day, salt FROM rate_salts');
    clock = Date.UTC(2026, 10, 23, 23, 59, 59);
    expect((await start('4:3')).status).toBe(202);
    expect(await rows('SELECT day FROM rate_salts')).toEqual([{ day: DAY_2 }]);
    expect(await rows<{ day: string; salt: string }>('SELECT day, salt FROM rate_salts')).toEqual([salt]);
    expect(await rows('SELECT day FROM rate_state')).toEqual([{ day: DAY_2 }, { day: DAY_2 }]);
    expect([(await stateOf('4:2')).dayScans, (await stateOf('4:3')).dayScans]).toEqual([1, 1]);
  });

  it('saltOfDay with a time of an earlier day returns the newest salt, inserts nothing and deletes nothing', async () => {
    const random = (fill: number) => (n: number) => new Uint8Array(n).fill(fill);
    const newer = await saltOfDay(d1.db, MIDNIGHT + 60_000, random(2));
    expect(newer).toEqual({ day: DAY_2, salt: '02'.repeat(32) });
    const older = await saltOfDay(d1.db, MIDNIGHT - 60_000, random(1));
    expect(older).toEqual(newer);
    expect(await rows('SELECT day FROM rate_salts')).toEqual([{ day: DAY_2 }]);
    // The same day again, and the day after: the salt of a day never changes, and only older salts are deleted.
    expect(await saltOfDay(d1.db, MIDNIGHT + 2 * HOUR, random(3))).toEqual(newer);
    const next = await saltOfDay(d1.db, MIDNIGHT + 25 * HOUR, random(4));
    expect(next).toEqual({ day: '2026-11-25', salt: '04'.repeat(32) });
    expect(await saltOfDay(d1.db, MIDNIGHT - 60_000, random(5))).toEqual(next);
    expect(await rows('SELECT day FROM rate_salts')).toEqual([{ day: '2026-11-25' }]);
  });

  it('control: without crossing midnight five starts are accepted, then the hourly limit', async () => {
    for (let i = 0; i < 5; i += 1) expect((await start('4:1')).status).toBe(202);
    const sixth = await start('4:1');
    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ error: 'rate-limited', retryAfterSeconds: 3600 });
    expect(await rows('SELECT day FROM rate_salts')).toEqual([{ day: DAY_1 }]);
  });
});

describe('finding 9: at most 15 scans per visitor per UTC day', () => {
  /** 15 accepted scans in three groups of five, each group more than an hour after the one before; the clock ends at 11:02. */
  async function useUpTheDay(key: string): Promise<void> {
    for (let group = 0; group < 3; group += 1) {
      if (group > 0) clock += HOUR + 60_000;
      for (let i = 0; i < RATE_LIMIT.scans; i += 1) expect((await start(key)).status, `group ${group}, start ${i}`).toBe(202);
    }
    expect(new Date(clock).toISOString()).toBe('2026-11-23T11:02:00.000Z');
  }

  it('refuses the sixteenth with limit day and the time to 00:00 UTC; another visitor and the next day are fine', async () => {
    expect(RATE_LIMIT_DAY.scans).toBe(15);
    await useUpTheDay('4:1');

    // 11:02: the hourly limit (five in the last hour) and the daily limit are both reached: the answer says day.
    const both = await start('4:1');
    expect(both.status).toBe(429);
    expect(both.body).toEqual({ error: 'rate-limited', retryAfterSeconds: (MIDNIGHT - clock) / 1000, limit: 'day' });

    // 12:03: the hourly window is empty, only the daily limit is left.
    clock += HOUR + 60_000;
    expect(new Date(clock).toISOString()).toBe('2026-11-23T12:03:00.000Z');
    const sixteenth = await start('4:1');
    const toMidnight = (MIDNIGHT - clock) / 1000;
    expect(toMidnight).toBe(11 * 3600 + 57 * 60);
    expect(sixteenth.status).toBe(429);
    expect(sixteenth.body).toEqual({ error: 'rate-limited', retryAfterSeconds: toMidnight, limit: 'day' });
    expect(sixteenth.retryAfter).toBe(toMidnight);
    expect(await rows('SELECT COUNT(*) AS n FROM scans')).toEqual([{ n: 15 }]);
    expect((await stateOf('4:1')).dayScans).toBe(15);

    // Another visitor is not affected.
    expect((await start('4:2')).status).toBe(202);

    // 00:00 UTC of the next day: a new salt, a new count.
    clock = MIDNIGHT;
    expect((await start('4:1')).status).toBe(202);
    expect(await rows('SELECT day FROM rate_salts')).toEqual([{ day: DAY_2 }]);
    // The rows of the day before went with its salt.
    expect(await rows('SELECT day FROM rate_state')).toEqual([{ day: DAY_2 }]);
  });

  it('the answer is exact: the visitor is accepted again after retryAfterSeconds', async () => {
    await useUpTheDay('4:1');
    clock += HOUR + 60_000;
    const refused = await start('4:1');
    expect(refused.body.limit).toBe('day');
    clock += Number(refused.body.retryAfterSeconds) * 1000 - 1000;
    expect((await start('4:1')).status).toBe(429);
    clock += 1000;
    expect(new Date(clock).toISOString()).toBe('2026-11-24T00:00:00.000Z');
    expect((await start('4:1')).status).toBe(202);
  });

  it('the lab rate lifts the daily limit to 24 times the hourly rate', async () => {
    for (let group = 0; group < 3; group += 1) {
      for (let i = 0; i < 7; i += 1) expect((await start('4:1', { ratePerHour: 7 })).status, `group ${group}, start ${i}`).toBe(202);
      expect((await start('4:1', { ratePerHour: 7 })).status).toBe(429);
      clock += HOUR + 60_000;
    }
    // 21 scans of the day, more than the default of 15.
    expect((await stateOf('4:1')).dayScans).toBe(21);
  });

  it('takeSlot counts per day and per salt day: another day starts from zero', async () => {
    const day1 = await visitorOf('4:1', DAY_1);
    const day2 = await visitorOf('4:1', DAY_2);
    for (let i = 0; i < 3; i += 1) expect((await takeSlot(d1.db, day1, MORNING + i * 2 * HOUR, `n${i}`, 100, 3)).allowed).toBe(true);
    const refused = await takeSlot(d1.db, day1, MORNING + 7 * HOUR, 'n3', 100, 3);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 8 * 3600, limit: 'day' });
    expect((await takeSlot(d1.db, day2, MORNING + 7 * HOUR, 'n4', 100, 3)).allowed).toBe(true);
    expect(await rows('SELECT day FROM rate_state ORDER BY day')).toEqual([{ day: DAY_1 }, { day: DAY_2 }]);
    expect([(await loadState(d1.db, day1)).state.dayScans, (await loadState(d1.db, day2)).state.dayScans]).toEqual([3, 1]);
  });
});

describe('the hourly limit', () => {
  it('still answers limit hour and the time until the oldest scan leaves the window', async () => {
    for (let i = 0; i < RATE_LIMIT.scans; i += 1) {
      expect((await start('4:1')).status).toBe(202);
      clock += 60_000;
    }
    const refused = await start('4:1');
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: 'rate-limited', retryAfterSeconds: 3600 - 300, limit: 'hour' });
    expect(refused.retryAfter).toBe(3600 - 300);
    clock += 3300 * 1000;
    expect((await start('4:1')).status).toBe(202);
  });
});

describe('a released slot does not count for the day', () => {
  it('releaseSlot gives the slot and the day count back, once', async () => {
    const v = await visitorOf('4:1', DAY_1);
    const other = await visitorOf('4:2', DAY_1);
    const a = await takeSlot(d1.db, v, MORNING, 'na');
    const b = await takeSlot(d1.db, v, MORNING, 'nb');
    if (!a.allowed || !b.allowed) throw new Error('both slots should be taken');
    const state = async () => (await loadState(d1.db, v)).state;
    expect((await state()).dayScans).toBe(2);
    await releaseSlot(d1.db, v, a);
    expect((await state()).dayScans).toBe(1);
    expect(nonces(await state())).toEqual(['nb']);
    // A second release, and a release of a slot that does not exist, give nothing back.
    await releaseSlot(d1.db, v, a);
    await releaseSlot(d1.db, v, { at: MORNING, nonce: 'unbekannt' });
    await releaseSlot(d1.db, other, b);
    expect((await state()).dayScans).toBe(1);
    expect(nonces(await state())).toEqual(['nb']);
    // The starts stay counted (finding 89).
    expect((await state()).dayStarts).toBe(2);
  });

  it('a visitor at the daily limit is accepted again after a release', async () => {
    const v = await visitorOf('4:1', DAY_1);
    const taken = [];
    for (let i = 0; i < 15; i += 1) taken.push(await takeSlot(d1.db, v, MORNING + i, `n${i}`, 100, 15));
    expect(taken.every((t) => t.allowed)).toBe(true);
    expect((await takeSlot(d1.db, v, MORNING + 20, 'n15', 100, 15)).allowed).toBe(false);
    const last = taken[14];
    if (last === undefined || !last.allowed) throw new Error('slot 15 should be taken');
    await releaseSlot(d1.db, v, last);
    expect((await takeSlot(d1.db, v, MORNING + 30, 'n16', 100, 15)).allowed).toBe(true);
    expect((await loadState(d1.db, v)).state.dayScans).toBe(15);
  });

  it('two starts of the same address at the same moment take one slot of the day', async () => {
    const url = 'https://gleiche-adresse-beispiel.de/';
    const [a, b] = await Promise.all([start('4:1', { url }), start('4:1', { url })]);
    expect([a?.status, b?.status].sort()).toEqual([200, 202]);
    expect(await dailyCount()).toBe(1);
    expect((await stateOf('4:1')).scans).toHaveLength(1);
  });

  it('two visitors starting the same address at the same moment: only the visitor who got the new scan counts', async () => {
    const url = 'https://gleiche-adresse-beispiel.de/';
    const [a, b] = await Promise.all([start('4:1', { url }), start('4:2', { url })]);
    expect([a?.status, b?.status].sort()).toEqual([200, 202]);
    expect(await dailyCount()).toBe(1);
    expect((await stateOf('4:1')).scans.length + (await stateOf('4:2')).scans.length).toBe(1);
  });

  it('a scan that cannot be created gives its slot back', async () => {
    await d1.db.prepare("CREATE TRIGGER test_no_sites BEFORE INSERT ON sites BEGIN SELECT RAISE(ABORT, 'test'); END").run();
    try {
      const failed = await start('4:1');
      expect(failed.status).toBe(503);
      expect(failed.body).toEqual({ error: 'unavailable' });
    } finally {
      await d1.db.prepare('DROP TRIGGER test_no_sites').run();
    }
    expect(await dailyCount()).toBe(0);
    expect((await stateOf('4:1')).scans).toHaveLength(0);
    expect((await start('4:1')).status).toBe(202);
    expect(await dailyCount()).toBe(1);
  });
});

describe('cleanup of the visitor rows', () => {
  async function seed(): Promise<void> {
    await d1.db.batch([
      d1.db.prepare('INSERT INTO rate_state (visitor, day, state) VALUES (?1, ?2, ?3)').bind('hash-a', '2026-11-22', 'x'),
      d1.db.prepare('INSERT INTO rate_state (visitor, day, state) VALUES (?1, ?2, ?3)').bind('hash-b', '2026-11-22', 'x'),
      d1.db.prepare('INSERT INTO rate_state (visitor, day, state) VALUES (?1, ?2, ?3)').bind('hash-a', DAY_1, 'x'),
    ]);
  }

  it('the hourly cleanup deletes the rows of earlier days and keeps today', async () => {
    await seed();
    const result = await cleanupRateLimit(d1.db, MORNING);
    expect(result.states).toBe(2);
    expect(await rows('SELECT visitor, day, state FROM rate_state')).toEqual([{ visitor: 'hash-a', day: DAY_1, state: 'x' }]);
    // At 00:00 UTC the rows of the day before go.
    await cleanupRateLimit(d1.db, MIDNIGHT);
    expect(await rows('SELECT day FROM rate_state')).toEqual([]);
  });

  it('the first start of a new day deletes the rows of earlier days with the salt', async () => {
    await seed();
    clock = MIDNIGHT + 60_000;
    expect((await start('4:1')).status).toBe(202);
    expect(await rows('SELECT day FROM rate_state')).toEqual([{ day: DAY_2 }]);
  });

  it('stores only the hash, the day and the encrypted state', async () => {
    expect((await start('4:1')).status).toBe(202);
    const [row] = await rows<Record<string, unknown>>('SELECT * FROM rate_state');
    expect(Object.keys(row ?? {}).sort()).toEqual(['day', 'state', 'visitor']);
    expect(String(row?.visitor)).toMatch(/^[0-9a-f]{32}$/);
    expect(String(row?.state)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
