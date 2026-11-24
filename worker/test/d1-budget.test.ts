import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REPORT_LIMITS, REPORT_SCHEMA_VERSION } from '@website-check/scanner';
import { releaseSlot, saltOfDay, takeSlot, RATE_LIMIT } from '../src/api/rate-limit.ts';
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
  await step('rate limit slot', () => takeSlot(db, `visitor${index}`, now, `n${index}`, DAY));
  await step('create site and scan', () => createScan(db, { id, url, host: `site${index}.example`, now }));
  await step('mark running', () => markRunning(db, id, now + 1000));
  await step('save report and rows', () =>
    saveResult(db, { id, now: now + 20_000, state: 'complete', mode: 'full', reportVersion: REPORT_SCHEMA_VERSION, reportJson: `{"pad":"${'x'.repeat(REPORT_LIMITS.maxReportChars - 20)}"}`, country: 'IT', colo: 'MXP', ...data }),
  );
  await step('cache lookup (hit)', () => findCachedScan(db, url, now + 60_000));
  await step('rate limit cleanup', () => takeSlot(db, `other${index}`, now + RATE_LIMIT.windowMs + 1, `m${index}`, DAY));
  // The other visitor's event and day count belong to that scan's count.
  await d1.db.prepare('DELETE FROM rate_events WHERE visitor = ?1').bind(`other${index}`).run();
  await d1.db.prepare('DELETE FROM rate_daily WHERE visitor = ?1').bind(`other${index}`).run();
  await step('retention delete', () => purgeBefore(db, now + CACHE_MS + 1));
  return steps;
}

describe('D1 rows written per scan', () => {
  it('a scan with the most rows the report allows fits a third of the daily limit at 80 scans', async () => {
    const worst = await lifecycle(REPORT_LIMITS.findings, REPORT_LIMITS.networkHosts, 1);
    const median = await lifecycle(8, 5, 2);
    const total = (s: Record<string, number>): number => Object.values(s).reduce((a, b) => a + b, 0);

    // Reads write nothing; a slot is two rows, the event and the visitor's count of the day (fix-a4), and their later deletion
    // (the event in "rate limit cleanup" of the next scan, the count with the salt of the next day).
    expect(worst['cache lookup (miss)']).toBe(0);
    expect(worst['cache lookup (hit)']).toBe(0);
    expect(worst['rate limit slot']).toBe(2);
    // Site: table and the unique index on url. Scan: table, the primary key index and (site_id, created_at).
    expect(worst['create site and scan']).toBe(5);
    expect(worst['mark running']).toBe(1);
    expect(worst['save report and rows']).toBe(1 + REPORT_LIMITS.findings + REPORT_LIMITS.networkHosts);
    // The other visitor's slot after an hour: the old event deleted (1), the new event (1), the day count (1).
    expect(worst['rate limit cleanup']).toBe(3);

    // The local runtime counts a deleted row once; D1's pricing page says writes to indexed columns add
    // a row per index. Conservative: count deletions of scans (2 indexes) and sites (1 index) like inserts.
    // The slot step already holds the event and the day count; the later deletions add 1 (event) and 1 (day count,
    // worst case one scan per visitor per day).
    const conservativeDelete = (s: Record<string, number>): number => (s['retention delete'] ?? 0) + 2 + 1;
    const perScanWorst = total(worst) - (worst['rate limit cleanup'] ?? 0) + 1 + 1 - (worst['retention delete'] ?? 0) + conservativeDelete(worst);
    const perScanMedian = total(median) - (median['rate limit cleanup'] ?? 0) + 1 + 1 - (median['retention delete'] ?? 0) + conservativeDelete(median);
    const saltsPerDay = 2;
    const perDayWorst = SCANS_PER_DAY * (perScanWorst + RESERVE_PER_SCAN) + saltsPerDay;
    const perDayMedian = SCANS_PER_DAY * (perScanMedian + RESERVE_PER_SCAN) + saltsPerDay;
    console.info(JSON.stringify({ worst, median, perScanWorst, perScanMedian, perDayWorst, perDayMedian, budget: Math.floor(DAY_LIMIT / 3) }));
    expect(perDayWorst).toBeLessThanOrEqual(Math.floor(DAY_LIMIT / 3));
  });

  it('a refused slot, by the hour or by the day, writes nothing', async () => {
    const counter = countingD1(d1.db);
    const now = Date.UTC(2026, 10, 23, 12);
    for (let i = 0; i < RATE_LIMIT.scans; i += 1) expect((await takeSlot(counter.db, 'v', now + i, `n${i}`, DAY)).allowed).toBe(true);
    counter.reset();
    expect(await takeSlot(counter.db, 'v', now + 10, 'refused-hour', DAY)).toMatchObject({ allowed: false, limit: 'hour' });
    expect(counter.written()).toBe(0);
    expect(await takeSlot(counter.db, 'w', now + 10, 'refused-day-0', DAY, 100, 1)).toMatchObject({ allowed: true });
    counter.reset();
    expect(await takeSlot(counter.db, 'w', now + 11, 'refused-day', DAY, 100, 1)).toMatchObject({ allowed: false, limit: 'day' });
    expect(counter.written()).toBe(0);
  });

  it('giving a slot back writes two rows: the day count and the event', async () => {
    const counter = countingD1(d1.db);
    const slot = await takeSlot(counter.db, 'v', Date.UTC(2026, 10, 23, 12), 'n0', DAY);
    if (!slot.allowed) throw new Error('the slot should be taken');
    counter.reset();
    await releaseSlot(counter.db, 'v', slot);
    expect(counter.written()).toBe(2);
    counter.reset();
    await releaseSlot(counter.db, 'v', slot);
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
