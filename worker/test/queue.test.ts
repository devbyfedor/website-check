import { describe, expect, it } from 'vitest';
import { chooseMode, MemoryKv, QUEUE_LIMITS, ScanQueue, secondsToNextUtcDay, type DayCounters, type QueueJob, type QueueLimits, type ScanMode } from '../src/queue/core.ts';
import { BrowserTimeExhausted, drain, type BrowserPort } from '../src/queue/drain.ts';

/**
 * The scan queue of session A5 part 3 without a Durable Object: the queue over an in-memory store with the
 * key order of Durable Object storage, and one run of the queue (`drain`) with a fake browser and fake scans.
 */

const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);

function queueWith(limits: Partial<QueueLimits> = {}): ScanQueue {
  return new ScanQueue(new MemoryKv(), { ...QUEUE_LIMITS, ...limits });
}

function day(overrides: Partial<DayCounters> = {}): DayCounters {
  return { day: '2026-11-23', accepted: 0, full: 0, quick: 0, browserMs: 0, exhausted: false, ...overrides };
}

async function enqueueMany(queue: ScanQueue, n: number, at = T0): Promise<number[]> {
  const positions: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const result = await queue.enqueue({ id: `scan${String(i).padStart(2, '0')}`, url: `https://beispiel-${i}.example/`, createdAt: at + i }, at + i);
    positions.push(result.accepted ? result.position : -1);
  }
  return positions;
}

class FakeBrowser implements BrowserPort {
  open = false;
  launches = 0;
  closes = 0;
  failWith: Error | null = null;
  async ensure(): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    if (!this.open) {
      this.open = true;
      this.launches += 1;
    }
  }
  openMs(): number {
    return this.open ? 1_000 : 0;
  }
  async closeIfOpen(): Promise<void> {
    if (this.open) {
      this.open = false;
      this.closes += 1;
    }
  }
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function runner(queue: ScanQueue, browser: FakeBrowser, scanMs: (job: QueueJob) => number = () => 20) {
  const ran: { id: string; mode: ScanMode; browserOpen: boolean }[] = [];
  const errors: string[] = [];
  let active = 0;
  let peak = 0;
  return {
    ran,
    errors,
    peak: () => peak,
    run: () =>
      drain({
        queue,
        browser,
        now: () => T0 + 60_000,
        sleep: tick,
        pollMs: 5,
        runJob: async (job, mode) => {
          active += 1;
          peak = Math.max(peak, active);
          ran.push({ id: job.id, mode, browserOpen: browser.open });
          await tick(scanMs(job));
          active -= 1;
        },
        onJobError: async (job, error) => {
          errors.push(`${job.id}: ${error instanceof Error ? error.message : String(error)}`);
        },
      }),
  };
}

describe('queue: positions and the day cap', () => {
  it('gives every waiting scan its place, 0 while it runs, and null once it left the queue', async () => {
    const queue = queueWith();
    expect(await enqueueMany(queue, 4)).toEqual([1, 2, 3, 4]);
    const first = await queue.takeNext(T0 + 10);
    expect(first?.id).toBe('scan00');
    expect(await queue.position('scan00')).toBe(0);
    expect(await queue.position('scan01')).toBe(1);
    expect(await queue.position('scan03')).toBe(3);
    await queue.finish(first as QueueJob);
    expect(await queue.position('scan00')).toBeNull();
    expect(await queue.position('unbekannt')).toBeNull();
  });

  it('does not add the same scan twice', async () => {
    const queue = queueWith();
    await enqueueMany(queue, 2);
    const again = await queue.enqueue({ id: 'scan01', url: 'https://beispiel-1.example/', createdAt: T0 }, T0 + 50);
    expect(again).toEqual({ accepted: true, position: 2 });
    expect((await queue.jobs()).length).toBe(2);
    expect((await queue.day(T0)).accepted).toBe(2);
  });

  it('refuses new scans after the day cap until 00:00 UTC, and counts again on the next day', async () => {
    const queue = queueWith({ maxScansPerDay: 3 });
    expect(await enqueueMany(queue, 3)).toEqual([1, 2, 3]);
    const refused = await queue.enqueue({ id: 'scan99', url: 'https://beispiel-99.example/', createdAt: T0 }, T0 + 100);
    expect(refused).toEqual({ accepted: false, reason: 'daily-limit', retryAfterSeconds: 15 * 3600 });
    expect((await queue.jobs()).length).toBe(3);
    const nextDay = Date.UTC(2026, 10, 24, 0, 0, 1);
    expect(await queue.enqueue({ id: 'scan98', url: 'https://beispiel-98.example/', createdAt: nextDay }, nextDay)).toEqual({ accepted: true, position: 4 });
    expect((await queue.day(nextDay)).accepted).toBe(1);
  });

  it('computes the seconds until the next UTC day', () => {
    expect(secondsToNextUtcDay(Date.UTC(2026, 10, 23, 23, 59, 30))).toBe(30);
    expect(secondsToNextUtcDay(Date.UTC(2026, 11, 31, 12, 0, 0))).toBe(12 * 3600);
  });
});

describe('queue: full check or quick check', () => {
  const limits = QUEUE_LIMITS;
  it('runs the full check while browser time is left', () => {
    expect(chooseMode({}, day(), limits, 0)).toBe('full');
    expect(chooseMode({}, day({ browserMs: limits.browserBudgetMs - limits.reservePerScanMs }), limits, 0)).toBe('full');
  });
  it('switches to the quick check when one more worst-case scan would pass the budget, counting the open browser', () => {
    expect(chooseMode({}, day({ browserMs: limits.browserBudgetMs - limits.reservePerScanMs + 1 }), limits, 0)).toBe('quick');
    expect(chooseMode({}, day({ browserMs: limits.browserBudgetMs - limits.reservePerScanMs - 1_000 }), limits, 2_000)).toBe('quick');
  });
  it('switches to the quick check after Browser Run refused browser time, and after the day cap of full checks', () => {
    expect(chooseMode({}, day({ exhausted: true }), limits, 0)).toBe('quick');
    expect(chooseMode({}, day({ full: limits.maxFullScansPerDay }), limits, 0)).toBe('quick');
    expect(chooseMode({ force: 'quick' }, day(), limits, 0)).toBe('quick');
  });
  it('keeps the browser budget below the free 10 minutes and the full-check cap within the D1 write budget', () => {
    expect(limits.browserBudgetMs).toBeLessThan(600_000);
    // docs/d1.md: at the caps of the report a scan writes 334 rows plus 20 reserved; a third of 100,000 rows per day.
    expect(limits.maxFullScansPerDay * (334 + 20)).toBeLessThanOrEqual(33_333);
    expect(limits.maxParallel).toBeLessThanOrEqual(3);
  });
});

describe('queue: a run (drain)', () => {
  it('runs at most maxParallel scans at the same time and at most maxJobsPerRun per run, then asks for the next run', async () => {
    const queue = queueWith({ maxParallel: 2, maxJobsPerRun: 3 });
    await enqueueMany(queue, 5);
    const browser = new FakeBrowser();
    const r = runner(queue, browser);
    const result = await r.run();
    expect(result).toMatchObject({ started: 3, full: 3, quick: 0, failed: 0, more: true });
    expect(r.peak()).toBe(2);
    expect(r.ran.map((x) => x.id)).toEqual(['scan00', 'scan01', 'scan02']);
    // Jobs wait: the browser stays open for the next run.
    expect(browser.open).toBe(true);
    const second = await r.run();
    expect(second).toMatchObject({ started: 2, more: false });
    expect(browser.closes).toBe(1);
    expect(browser.launches).toBe(1);
    expect((await queue.jobs()).length).toBe(0);
    expect((await queue.day(T0 + 60_000)).full).toBe(5);
  });

  it('closes the browser as soon as no scan needs it, but never while another scan still uses it', async () => {
    const queue = queueWith({ maxParallel: 3 });
    await enqueueMany(queue, 2);
    const browser = new FakeBrowser();
    const r = runner(queue, browser, (job) => (job.id === 'scan00' ? 5 : 60));
    await r.run();
    expect(r.ran.every((x) => x.browserOpen)).toBe(true);
    expect(browser.closes).toBe(1);
    expect(browser.open).toBe(false);
  });

  it('takes scans that arrive while it runs', async () => {
    const queue = queueWith({ maxParallel: 1, maxJobsPerRun: 3 });
    await enqueueMany(queue, 1);
    const browser = new FakeBrowser();
    const r = runner(queue, browser, () => 30);
    const running = r.run();
    await tick(5);
    await queue.enqueue({ id: 'spaet', url: 'https://spaet.example/', createdAt: T0 }, T0 + 20);
    expect(await queue.position('spaet')).toBe(1);
    const result = await running;
    expect(result.started).toBe(2);
    expect(r.ran.map((x) => x.id)).toEqual(['scan00', 'spaet']);
  });

  it('runs the quick check when Browser Run refuses browser time, and remembers it for the day', async () => {
    const queue = queueWith({ maxParallel: 1 });
    await enqueueMany(queue, 2);
    const browser = new FakeBrowser();
    browser.failWith = new BrowserTimeExhausted();
    const r = runner(queue, browser);
    const result = await r.run();
    expect(result).toMatchObject({ started: 2, full: 0, quick: 2, failed: 0 });
    expect(r.ran.map((x) => x.mode)).toEqual(['quick', 'quick']);
    expect((await queue.day(T0 + 60_000)).exhausted).toBe(true);
    expect(browser.launches).toBe(0);
  });

  it('never opens the browser for a quick check', async () => {
    const queue = queueWith();
    await queue.enqueue({ id: 'schnell', url: 'https://schnell.example/', createdAt: T0, force: 'quick' }, T0);
    const browser = new FakeBrowser();
    const r = runner(queue, browser);
    await r.run();
    expect(r.ran).toEqual([{ id: 'schnell', mode: 'quick', browserOpen: false }]);
    expect(browser.launches).toBe(0);
  });

  it('records a scan whose browser could not be opened as an error and goes on with the next', async () => {
    const queue = queueWith({ maxParallel: 1 });
    await enqueueMany(queue, 2);
    const browser = new FakeBrowser();
    browser.failWith = new Error('websocket closed');
    const r = runner(queue, browser);
    const result = await r.run();
    expect(result).toMatchObject({ started: 2, failed: 2, more: false });
    expect(r.errors).toEqual(['scan00: websocket closed', 'scan01: websocket closed']);
    expect((await queue.jobs()).length).toBe(0);
  });

  it('retries a scan once that a lost run left started, then gives it up as an error', async () => {
    const queue = queueWith();
    await enqueueMany(queue, 1);
    await queue.takeNext(T0);
    const later = T0 + QUEUE_LIMITS.staleRunningMs + 1;
    expect(await queue.recoverStale(later, new Set())).toEqual({ retried: 1, abandoned: [] });
    expect(await queue.position('scan00')).toBe(1);
    await queue.takeNext(later);
    const gaveUp = await queue.recoverStale(later + QUEUE_LIMITS.staleRunningMs + 1, new Set());
    expect(gaveUp.retried).toBe(0);
    expect(gaveUp.abandoned.map((j) => j.id)).toEqual(['scan00']);
    expect(await queue.position('scan00')).toBeNull();
    // A job that runs in this object is never touched.
    await enqueueMany(queue, 1, later);
    await queue.takeNext(later);
    expect(await queue.recoverStale(later + 10 * QUEUE_LIMITS.staleRunningMs, new Set(['scan00']))).toEqual({ retried: 0, abandoned: [] });
  });
});
