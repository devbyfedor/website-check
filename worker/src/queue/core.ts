/**
 * The scan queue (session A5 part 3): pure logic over a small key-value store, so it runs in the Durable
 * Object (`ctx.storage`, SQLite-backed on the free plan) and in unit tests (an in-memory map) alike.
 *
 * What it keeps: the jobs that wait or run (id, normalized address, times), and the counters of the UTC
 * day (scans accepted, full and quick checks started, browser time used, whether Browser Run refused more
 * browser time today). No visitor data, no report: the report goes to D1.
 *
 * Limits (docs/decisions.md, A5 part 3):
 * - at most `maxParallel` scans run at the same time, as separate browser contexts (tabs) of one browser;
 * - one new browser at most every `launchSpacingMs` (Browser Run: one new browser every 20 seconds);
 * - at most `maxScansPerDay` scans are accepted per UTC day (afterwards HTTP 503 "daily-limit");
 * - at most `maxFullScansPerDay` full checks with the browser per day, and only while the browser time of the
 *   day plus the worst case of one more scan stays within `browserBudgetMs`; otherwise the quick check.
 */

export interface QueueLimits {
  /** Scans running at the same time (tabs of one browser). */
  maxParallel: number;
  /** Scans accepted per UTC day, full and quick together. */
  maxScansPerDay: number;
  /** Full checks with the browser per UTC day. */
  maxFullScansPerDay: number;
  /** Browser time per UTC day the queue may use (the free plan has 600 s; the rest is a reserve). */
  browserBudgetMs: number;
  /** Browser time kept free for one more full check before it starts (homepage 20 s, Impressum 16 s, trace, closing). */
  reservePerScanMs: number;
  /** One new browser at most this often (Browser Run free plan: one every 20 s). */
  launchSpacingMs: number;
  /** Scans started per run of the queue (one alarm of the Durable Object), so one run stays far from its CPU and subrequest limits. */
  maxJobsPerRun: number;
  /** A job that started this long ago and is not running any more (the object was restarted) is retried once, then given up. */
  staleRunningMs: number;
}

export const QUEUE_LIMITS: QueueLimits = {
  maxParallel: 3,
  maxScansPerDay: 150,
  maxFullScansPerDay: 80,
  browserBudgetMs: 540_000,
  reservePerScanMs: 45_000,
  launchSpacingMs: 20_000,
  maxJobsPerRun: 3,
  staleRunningMs: 3 * 60_000,
};

/** The part of `DurableObjectStorage` the queue uses (key order as in `storage.list`: sorted by key). */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export type ScanMode = 'full' | 'quick';

export interface QueueJob {
  id: string;
  /** Normalized address (`normalizeSiteAddress`). */
  url: string;
  /** When the visitor started the scan (the D1 row's `created_at`). */
  createdAt: number;
  enqueuedAt: number;
  /** Lab only: run the quick check even when browser time is left. */
  force?: 'quick';
  /** Set when a run of the queue took the job. */
  startedAt?: number;
  attempts: number;
}

export interface DayCounters {
  day: string;
  accepted: number;
  full: number;
  quick: number;
  /** Browser time of the day by our own clock: from launch to close of every browser of the queue. */
  browserMs: number;
  /** Browser Run refused more browser time today (HTTP 429 although a new browser was allowed), or its own counter is at the budget. */
  exhausted: boolean;
}

export type EnqueueResult = { accepted: true; position: number } | { accepted: false; reason: 'daily-limit'; retryAfterSeconds: number };

const JOB_PREFIX = 'job:';
const DAY_KEY = 'day';
const LAUNCH_KEY = 'browser:lastLaunchAt';

export function utcDayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Seconds until 00:00 UTC, when Cloudflare's daily limits and our counters start again. */
export function secondsToNextUtcDay(now: number): number {
  const next = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function jobKey(job: Pick<QueueJob, 'enqueuedAt' | 'id'>): string {
  return `${JOB_PREFIX}${String(job.enqueuedAt).padStart(15, '0')}:${job.id}`;
}

/** Which check a job gets when it starts. Never decided from the queue position: only from the day's budget. */
export function chooseMode(job: Pick<QueueJob, 'force'>, day: DayCounters, limits: QueueLimits, openBrowserMs: number): ScanMode {
  if (job.force === 'quick') return 'quick';
  if (day.exhausted) return 'quick';
  if (day.full >= limits.maxFullScansPerDay) return 'quick';
  return day.browserMs + openBrowserMs + limits.reservePerScanMs <= limits.browserBudgetMs ? 'full' : 'quick';
}

export class ScanQueue {
  readonly #store: KvStore;
  readonly limits: QueueLimits;
  /**
   * Every read-modify-write of the day's counters and every new job run one after the other (review of A5
   * part 3: parallel scans of one alarm run read the counters before any of them wrote, and lost updates).
   */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(store: KvStore, limits: QueueLimits = QUEUE_LIMITS) {
    this.#store = store;
    this.limits = limits;
  }

  async day(now: number): Promise<DayCounters> {
    const today = utcDayOf(now);
    const stored = await this.#store.get<DayCounters>(DAY_KEY);
    return stored !== undefined && stored.day === today ? stored : { day: today, accepted: 0, full: 0, quick: 0, browserMs: 0, exhausted: false };
  }

  async #saveDay(day: DayCounters): Promise<void> {
    await this.#store.put(DAY_KEY, day);
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(work);
    this.#chain = run.catch(() => undefined);
    return run;
  }

  #updateDay(now: number, change: (day: DayCounters) => DayCounters): Promise<void> {
    return this.#serial(async () => this.#saveDay(change(await this.day(now))));
  }

  async jobs(): Promise<{ key: string; job: QueueJob }[]> {
    const map = await this.#store.list<QueueJob>({ prefix: JOB_PREFIX });
    return [...map.entries()].map(([key, job]) => ({ key, job }));
  }

  /** Accepts a job unless the day's cap is reached; a job that is already in the queue is not added twice. */
  enqueue(input: { id: string; url: string; createdAt: number; force?: 'quick' }, now: number): Promise<EnqueueResult> {
    return this.#serial(() => this.#enqueue(input, now));
  }

  async #enqueue(input: { id: string; url: string; createdAt: number; force?: 'quick' }, now: number): Promise<EnqueueResult> {
    const all = await this.jobs();
    const existing = all.find((entry) => entry.job.id === input.id);
    if (existing !== undefined) return { accepted: true, position: positionIn(all, input.id) };
    const day = await this.day(now);
    if (day.accepted >= this.limits.maxScansPerDay) return { accepted: false, reason: 'daily-limit', retryAfterSeconds: secondsToNextUtcDay(now) };
    const job: QueueJob = { id: input.id, url: input.url, createdAt: input.createdAt, enqueuedAt: now, attempts: 0, ...(input.force !== undefined ? { force: input.force } : {}) };
    await this.#store.put(jobKey(job), job);
    await this.#saveDay({ ...day, accepted: day.accepted + 1 });
    return { accepted: true, position: positionIn([...all, { key: jobKey(job), job }], job.id) };
  }

  /**
   * Seconds until 00:00 UTC when the day's cap of accepted scans is reached, otherwise null. Read from the stored
   * counters, so it holds after the object was evicted from memory (session fix-a5, review finding 46).
   */
  async dayCapReached(now: number): Promise<number | null> {
    const day = await this.day(now);
    return day.accepted >= this.limits.maxScansPerDay ? secondsToNextUtcDay(now) : null;
  }

  /** 0 while the job runs, 1 for the next job to start, null when the queue does not know it (finished or never queued). */
  async position(id: string): Promise<number | null> {
    const all = await this.jobs();
    return all.some((entry) => entry.job.id === id) ? positionIn(all, id) : null;
  }

  async waitingCount(): Promise<number> {
    return (await this.jobs()).filter((entry) => entry.job.startedAt === undefined).length;
  }

  /** Takes the oldest waiting job and marks it started. */
  async takeNext(now: number): Promise<QueueJob | null> {
    const next = (await this.jobs()).find((entry) => entry.job.startedAt === undefined);
    if (next === undefined) return null;
    const job: QueueJob = { ...next.job, startedAt: now, attempts: next.job.attempts + 1 };
    await this.#store.put(next.key, job);
    return job;
  }

  async finish(job: Pick<QueueJob, 'id' | 'enqueuedAt'>): Promise<void> {
    await this.#store.delete(jobKey(job));
  }

  /**
   * Jobs that started long ago but are not running in this object (it was restarted, for example after an
   * error): retried once, then given up (`abandoned`, for `markError` in D1).
   */
  async recoverStale(now: number, runningIds: ReadonlySet<string>, minAgeMs: number = this.limits.staleRunningMs): Promise<{ retried: number; abandoned: QueueJob[] }> {
    let retried = 0;
    const abandoned: QueueJob[] = [];
    for (const { key, job } of await this.jobs()) {
      if (job.startedAt === undefined || runningIds.has(job.id) || now - job.startedAt < minAgeMs) continue;
      if (job.attempts < 2) {
        const { startedAt: _startedAt, ...rest } = job;
        await this.#store.put(key, rest);
        retried += 1;
      } else {
        await this.#store.delete(key);
        abandoned.push(job);
      }
    }
    return { retried, abandoned };
  }

  /** Counts a started check; full checks also count against `maxFullScansPerDay`. */
  countStart(mode: ScanMode, now: number): Promise<void> {
    return this.#updateDay(now, (day) => (mode === 'full' ? { ...day, full: day.full + 1 } : { ...day, quick: day.quick + 1 }));
  }

  addBrowserTime(ms: number, now: number): Promise<void> {
    return this.#updateDay(now, (day) => ({ ...day, browserMs: day.browserMs + Math.max(0, Math.round(ms)) }));
  }

  markExhausted(now: number): Promise<void> {
    return this.#updateDay(now, (day) => ({ ...day, exhausted: true }));
  }

  async lastLaunchAt(): Promise<number | null> {
    return (await this.#store.get<number>(LAUNCH_KEY)) ?? null;
  }

  async setLastLaunchAt(at: number): Promise<void> {
    await this.#store.put(LAUNCH_KEY, at);
  }
}

function positionIn(all: { job: QueueJob }[], id: string): number {
  const entry = all.find((e) => e.job.id === id);
  if (entry === undefined || entry.job.startedAt !== undefined) return 0;
  return all.filter((e) => e.job.startedAt === undefined && (e.job.enqueuedAt < entry.job.enqueuedAt || (e.job.enqueuedAt === entry.job.enqueuedAt && e.job.id < entry.job.id))).length + 1;
}

/** In-memory `KvStore` with the key order of Durable Object storage (tests, local tools). */
export class MemoryKv implements KvStore {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    const value = this.map.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list<T>(options: { prefix: string }): Promise<Map<string, T>> {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(options.prefix)).sort();
    return new Map(keys.map((k) => [k, structuredClone(this.map.get(k)) as T]));
  }
}
