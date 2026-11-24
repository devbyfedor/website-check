import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REPORT_LIMITS, REPORT_SCHEMA_VERSION } from '@website-check/scanner';
import { cleanupRateLimit, rateVisitor, recordStart, releaseSlot, saltOfDay, takeSlot, RATE_LIMIT, type RateVisitor } from '../src/api/rate-limit.ts';
import { CACHE_MS, createScan, findCachedScan, markRunning, purgeBefore, saveResult, type FindingRow, type HostRow } from '../src/db/store.ts';
import { countingD1, localD1, type LocalD1 } from './d1.ts';

/**
 * Rows written per scan on the local D1 (the same runtime as `wrangler dev`), for the free plan's
 * 100,000 rows written per day (docs/d1.md). Fedor's rule for A5: at 80 scans per day the writes must
 * stay within a third of the limit, 33,333 rows.
 */

const DAY_LIMIT = 100_000;
const SCANS_PER_DAY = 80;
/** The UTC day of the salt that the slots of `lifecycle` belong to (`now` there is 2026-11-23 12:00 UTC). */
const DAY = '2026-11-23';
const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';
/** Starts answered from the cache per day, assumed as many as new scans (finding 89: each one counts in the visitor's row). */
const CACHED_PER_DAY = SCANS_PER_DAY;

function visitorOf(key: string, day = DAY): Promise<RateVisitor> {
  return rateVisitor(SECRET, { day, salt: 'ab'.repeat(32) }, key);
}
/** Writes part 3 may add per scan (progress of the scan screen, a retry): kept free on purpose. */
const RESERVE_PER_SCAN = 20;

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

function rows(findings: number, hosts: number): { findings: FindingRow[]; hosts: HostRow[] } {
  return {
    findings: Array.from({ length: findings }, (_, i) => ({ findingId: `third-party:unknown:t${i}.example`, area: 'privacy', kind: 'hint', risk: null, textId: 'third-party-unknown', serviceKey: `unknown:t${i}.example` })),
    hosts: Array.from({ length: hosts }, (_, i) => ({ host: `h${i}.t${i}.example`, party: 'third' as const, serviceKey: null, requestCount: 3, firstStartMs: i * 10, lastEndMs: i * 10 + 50, beforeBanner: i % 2 === 0 })),
  };
}

/** One scan from the start to its deletion by the retention rule; returns the rows written by each step. */
async function lifecycle(findings: number, hosts: number, index: number): Promise<Record<string, number>> {
  const counter = countingD1(d1.db);
  const db = counter.db;
  const steps: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    counter.reset();
    await run();
    steps[name] = counter.written();
  };
  const now = Date.UTC(2026, 10, 23, 12, 0, index);
  const id = `scan${String(index).padStart(2, 'a')}`.padEnd(26, 'b').replace(/[^a-z2-7]/g, 'c');
  const url = `https://site${index}.example/`;
  const data = rows(findings, hosts);
  await step('cache lookup (miss)', () => findCachedScan(db, url, now));
  const visitor = await visitorOf(`4:${index}`);
  await step('rate limit slot', () => takeSlot(db, visitor, now, `n${index}`));
  await step('create site and scan', () => createScan(db, { id, url, host: `site${index}.example`, now }));
  await step('mark running', () => markRunning(db, id, now + 1000));
  await step('save report and rows', () =>
    saveResult(db, { id, now: now + 20_000, state: 'complete', mode: 'full', reportVersion: REPORT_SCHEMA_VERSION, reportJson: `{"pad":"${'x'.repeat(REPORT_LIMITS.maxReportChars - 20)}"}`, country: 'IT', colo: 'MXP', ...data }),
  );
  await step('cache lookup (hit)', () => findCachedScan(db, url, now + 60_000));
  // Another visitor's start answered from the cache is counted in that visitor's row (finding 89), not in this scan.
  const other = await visitorOf(`4:${index + 100}`);
  await step('cached answer counted', () => recordStart(db, other, now + 60_000));
  await d1.db.prepare('DELETE FROM rate_state WHERE visitor = ?1').bind(other.hash).run();
  // The visitor's row of the day is deleted after the day (the first start of the next day, or the hourly cleanup).
  await step('rate limit cleanup', () => cleanupRateLimit(db, now + 24 * RATE_LIMIT.windowMs));
  await step('retention delete', () => purgeBefore(db, now + CACHE_MS + 1));
  return steps;
}

describe('D1 rows written per scan', () => {
  it('a scan with the most rows the report allows fits a third of the daily limit at 80 scans', async () => {
    const worst = await lifecycle(REPORT_LIMITS.findings, REPORT_LIMITS.networkHosts, 1);
    const median = await lifecycle(8, 5, 2);
    const total = (s: Record<string, number>): number => Object.values(s).reduce((a, b) => a + b, 0);

    // Reads write nothing; a slot is one row, the visitor's row of the day (fix-a5), and its deletion after the day.
    expect(worst['cache lookup (miss)']).toBe(0);
    expect(worst['cache lookup (hit)']).toBe(0);
    expect(worst['rate limit slot']).toBe(1);
    expect(worst['cached answer counted']).toBe(1);
    // Site: table and the unique index on url. Scan: table, the primary key index, (site_id, created_at) and, since
    // fix-a5 (finding 42), the partial index of scans in progress, which also changes when the scan starts.
    expect(worst['create site and scan']).toBe(6);
    expect(worst['mark running']).toBe(2);
    expect(worst['save report and rows']).toBe(1 + REPORT_LIMITS.findings + REPORT_LIMITS.networkHosts);
    // The visitor's row deleted after the day.
    expect(worst['rate limit cleanup']).toBe(1);

    // The local runtime counts a deleted row once; D1's pricing page says writes to indexed columns add
    // a row per index. Conservative: count deletions of scans (2 indexes) and sites (1 index) like inserts.
    // The slot and the cleanup hold the visitor's row and its deletion (worst case one scan per visitor per day). A
    // cached answer is counted apart: its row and the row's deletion, 2 at most.
    const conservativeDelete = (s: Record<string, number>): number => (s['retention delete'] ?? 0) + 2 + 1;
    const perScanWorst = total(worst) - (worst['cached answer counted'] ?? 0) - (worst['retention delete'] ?? 0) + conservativeDelete(worst);
    const perScanMedian = total(median) - (median['cached answer counted'] ?? 0) - (median['retention delete'] ?? 0) + conservativeDelete(median);
    const saltsPerDay = 2;
    const cachedPerDay = CACHED_PER_DAY * 2;
    const perDayWorst = SCANS_PER_DAY * (perScanWorst + RESERVE_PER_SCAN) + saltsPerDay + cachedPerDay;
    const perDayMedian = SCANS_PER_DAY * (perScanMedian + RESERVE_PER_SCAN) + saltsPerDay + cachedPerDay;
    console.info(JSON.stringify({ worst, median, perScanWorst, perScanMedian, perDayWorst, perDayMedian, budget: Math.floor(DAY_LIMIT / 3) }));
    expect(perDayWorst).toBeLessThanOrEqual(Math.floor(DAY_LIMIT / 3));
  });

  it('a slot refused by the hour or the day writes the start (finding 89); a start beyond the start budget writes nothing', async () => {
    const counter = countingD1(d1.db);
    const now = Date.UTC(2026, 10, 23, 12);
    const v = await visitorOf('4:1');
    for (let i = 0; i < RATE_LIMIT.scans; i += 1) expect((await takeSlot(counter.db, v, now + i, `n${i}`)).allowed).toBe(true);
    counter.reset();
    expect(await takeSlot(counter.db, v, now + 10, 'refused-hour')).toMatchObject({ allowed: false, limit: 'hour' });
    expect(counter.written()).toBe(1);
    const w = await visitorOf('4:2');
    expect(await takeSlot(counter.db, w, now + 10, 'refused-day-0', 100, 1)).toMatchObject({ allowed: true });
    counter.reset();
    expect(await takeSlot(counter.db, w, now + 11, 'refused-day', 100, 1)).toMatchObject({ allowed: false, limit: 'day' });
    expect(counter.written()).toBe(1);
    const x = await visitorOf('4:3');
    const starts = { perHour: 2, perDay: 60 };
    for (let i = 0; i < 2; i += 1) expect((await takeSlot(counter.db, x, now + i, `s${i}`, 100, 100, starts)).allowed).toBe(true);
    counter.reset();
    expect(await takeSlot(counter.db, x, now + 3, 'refused-starts', 100, 100, starts)).toMatchObject({ allowed: false, limit: 'starts' });
    expect(await recordStart(counter.db, x, now + 3, starts)).toMatchObject({ allowed: false, limit: 'starts' });
    expect(counter.written()).toBe(0);
  });

  it('giving a slot back writes one row, the visitor\'s row; a second time nothing', async () => {
    const counter = countingD1(d1.db);
    const v = await visitorOf('4:1');
    const slot = await takeSlot(counter.db, v, Date.UTC(2026, 10, 23, 12), 'n0');
    if (!slot.allowed) throw new Error('the slot should be taken');
    counter.reset();
    await releaseSlot(counter.db, v, slot);
    expect(counter.written()).toBe(1);
    counter.reset();
    await releaseSlot(counter.db, v, slot);
    expect(counter.written()).toBe(0);
  });

  it('the first scan of a day writes the salt once and deletes the salt of the day before', async () => {
    const counter = countingD1(d1.db);
    const random = (n: number): Uint8Array => new Uint8Array(n).fill(7);
    const day1 = Date.UTC(2026, 10, 23, 8);
    await saltOfDay(counter.db, day1, random);
    expect(counter.written()).toBe(1);
    counter.reset();
    await saltOfDay(counter.db, day1 + 3_600_000, random);
    expect(counter.written()).toBe(0);
    counter.reset();
    await saltOfDay(counter.db, day1 + 24 * 3_600_000, random);
    expect(counter.written()).toBe(2);
    const salts = await d1.db.prepare('SELECT day FROM rate_salts').all<{ day: string }>();
    expect(salts.results.map((r) => r.day)).toEqual(['2026-11-24']);
  });
});
