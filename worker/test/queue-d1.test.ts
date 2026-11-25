import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shopCapture } from '../../scanner/test/report-helpers.ts';
import { createScan, endStuckScans, getScan, STUCK_MS } from '../src/db/store.ts';
import { runScanJob, WRITE_PAUSES_MS } from '../src/queue/job.ts';
import { D1_TEST_TIMEOUT_MS, localD1, type LocalD1 } from './d1.ts';

// Tests against the local D1 measure no time; the timeout only stops one whose local D1 never answers (test/d1.ts).
vi.setConfig({ testTimeout: D1_TEST_TIMEOUT_MS });

/**
 * Review findings 44 and 42 (session fix-a5), from the review's reproduction of the queue path on D1 (local D1,
 * invented addresses): a failed write of the report threw the report away and left the scan `running` until the
 * hourly cron (31 to 90 minutes); the hourly cleanup read every row of `scans`.
 */

const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);
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

/** A D1 binding whose `prepare` and `batch` throw "Too many subrequests." for the next `failures` calls once `armed`. */
function failingD1(db: D1Database) {
  const control = { armed: false, failures: 0, failed: 0 };
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (control.armed && control.failures > 0 && (prop === 'prepare' || prop === 'batch')) {
        return () => {
          control.failures -= 1;
          control.failed += 1;
          throw new Error('Too many subrequests.');
        };
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db: proxy, control };
}

async function newScan(): Promise<{ id: string; url: string }> {
  const created = await createScan(d1.db, { id: 'abcdefghijklmnopqrstuvwxyz', url: 'https://roesterei-beispiel.de/', host: 'roesterei-beispiel.de', now: T0 });
  return { id: created.scan.id, url: 'https://roesterei-beispiel.de/' };
}

describe('finding 44: a failed write of the report', () => {
  const pauses: number[] = [];
  const sleep = async (ms: number) => {
    pauses.push(ms);
  };
  beforeEach(() => {
    pauses.length = 0;
  });

  async function run(failures: number) {
    const scan = await newScan();
    const failing = failingD1(d1.db);
    const job = { id: scan.id, url: scan.url, createdAt: T0, enqueuedAt: T0, attempts: 1, startedAt: T0 };
    const result = await runScanJob(job, 'full', {
      db: failing.db,
      now: () => T0 + 9_000,
      sleep,
      capture: async () => {
        // D1 fails from here on, as in the review (the run used up its subrequests after the capture).
        failing.control.armed = true;
        failing.control.failures = failures;
        return { capture: shopCapture(), visit: { country: 'AT', colo: 'VIE' } };
      },
    });
    return { result, row: await getScan(d1.db, scan.id) };
  }

  it('one passing failure: the report is written by the second try', async () => {
    const { result, row } = await run(1);
    expect(result.outcome).toBe('saved');
    expect(row).toMatchObject({ status: 'done', state: 'complete' });
    expect(pauses).toEqual([WRITE_PAUSES_MS[0]]);
  });

  it('the report cannot be written but the error can: the scan ends as our error at once, not running until the cron', async () => {
    const { result, row } = await run(3);
    expect(result).toMatchObject({ outcome: 'error', error: expect.stringMatching(/^save-failed: /) });
    expect(result.unrecorded).toBeUndefined();
    expect(row?.status).toBe('error');
  });

  it('D1 takes nothing: the result says so, the queue writes the error later (see queue-object.test.ts)', async () => {
    const { result, row } = await run(100);
    expect(result).toMatchObject({ outcome: 'error', unrecorded: true });
    expect(row?.status).toBe('running');
  });
});

describe('finding 42: the hourly cleanup reads by an index', () => {
  it('3,000 finished scans and one stuck: the plan uses the index of scans in progress and reads only those rows', async () => {
    await d1.db.prepare("INSERT INTO sites (id, url, host, created_at) VALUES (1, 'https://beispiel.de/', 'beispiel.de', 1)").run();
    for (let i = 0; i < 3000; i += 500) {
      const values = Array.from({ length: 500 }, (_, k) => `('s${i + k}', 1, ${T0 - (i + k) * 1000}, 'done', 'complete', '{}')`).join(',');
      await d1.db.prepare(`INSERT INTO scans (id, site_id, created_at, status, state, report) VALUES ${values}`).run();
    }
    await d1.db.prepare("INSERT INTO scans (id, site_id, created_at, status) VALUES ('stuck', 1, ?1, 'running')").bind(T0 - STUCK_MS - 60_000).run();
    const plan = await d1.db.prepare("EXPLAIN QUERY PLAN UPDATE scans SET status = 'error', error = 'stuck', finished_at = ?1 WHERE status IN ('queued', 'running') AND created_at < ?2").bind(T0, T0 - STUCK_MS).all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(' | ')).toMatch(/USING INDEX scans_in_progress/);
    // The same statement as endStuckScans, to read rows_read.
    const result = await d1.db.prepare("UPDATE scans SET status = 'error', error = 'stuck', finished_at = ?1 WHERE status IN ('queued', 'running') AND created_at < ?2").bind(T0, T0 - STUCK_MS).run();
    expect(result.meta.changes).toBe(1);
    expect(result.meta.rows_read).toBeLessThan(10);
    expect(await endStuckScans(d1.db, T0)).toBe(0);
  });
});
