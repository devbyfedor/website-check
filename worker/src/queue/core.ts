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
  /**
   * Session B2 part 2 (Fedor's answer 2): the cancel tokens of the visitors who wait for this scan, the one who
   * started it and everyone who joined it from the cache. "Prüfung abbrechen" removes the token of one visitor;
   * the job leaves the queue only when no token is left and it has not started. Missing on jobs of older code.
   */
  holders?: string[];
  /** More visitors joined than `MAX_HOLDERS`: the job is never cancelled any more. */
  pinned?: boolean;
  /** Its last visitor cancelled it: no run takes it and nobody joins it while D1 is told; then it is deleted. */
  cancelled?: boolean;
}

/** Tokens kept per job; a job joined by more visitors cannot be cancelled any more (`pinned`). */
export const MAX_HOLDERS = 50;

/**
 * What a cancel did (session B2 part 2): `removed` the job left the queue (no browser is spent on it), `kept`
 * other visitors still wait for it, `running` it has started and runs to its end, `unknown` the queue does not
 * know it (finished, or never queued), `not-holder` the token is not one of the job's.
 */
export type CancelOutcome = 'removed' | 'kept' | 'running' | 'unknown' | 'not-holder';

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
const UNRECORDED_PREFIX = 'unrecorded:';
/** An error that could not be written for this long is left to the hourly cleanup of D1. */
const UNRECORDED_KEPT_MS = 60 * 60_000;

/** A scan that ended with our error that D1 did not take (session fix-a5, review finding 44). */
export interface UnrecordedError {
  id: string;
  reason: string;
  since: number;
}

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

  /** Jobs that wait or run; a job being cancelled is left out. */
  async #liveJobs(): Promise<{ key: string; job: QueueJob }[]> {
    return (await this.jobs()).filter((entry) => entry.job.cancelled !== true);
  }

  /**
   * Accepts a job unless the day's cap is reached; a job that is already in the queue is not added twice.
   * `holder` is the cancel token of the visitor who started it (session B2 part 2).
   */
  enqueue(input: { id: string; url: string; createdAt: number; force?: 'quick'; holder?: string }, now: number): Promise<EnqueueResult> {
    return this.#serial(() => this.#enqueue(input, now));
  }

  async #enqueue(input: { id: string; url: string; createdAt: number; force?: 'quick'; holder?: string }, now: number): Promise<EnqueueResult> {
    const all = await this.#liveJobs();
    const existing = all.find((entry) => entry.job.id === input.id);
    if (existing !== undefined) return { accepted: true, position: positionIn(all, input.id) };
    const day = await this.day(now);
    if (day.accepted >= this.limits.maxScansPerDay) return { accepted: false, reason: 'daily-limit', retryAfterSeconds: secondsToNextUtcDay(now) };
    const job: QueueJob = {
      id: input.id,
      url: input.url,
      createdAt: input.createdAt,
      enqueuedAt: now,
      attempts: 0,
      ...(input.force !== undefined ? { force: input.force } : {}),
      ...(input.holder !== undefined ? { holders: [input.holder] } : {}),
    };
    await this.#store.put(jobKey(job), job);
    await this.#saveDay({ ...day, accepted: day.accepted + 1 });
    return { accepted: true, position: positionIn([...all, { key: jobKey(job), job }], job.id) };
  }

  /**
   * Session B2 part 2: a visitor joins a scan that waits or runs (the start was answered from the cache) with a
   * cancel token of their own. False when the queue does not know the job any more (it finished, or its last
   * visitor cancelled it a moment ago): the caller reads D1 again instead of handing out a scan that will not run.
   */
  join(id: string, token: string): Promise<boolean> {
    return this.#serial(async () => {
      const entry = (await this.#liveJobs()).find((e) => e.job.id === id);
      if (entry === undefined) return false;
      const holders = entry.job.holders ?? [];
      if (holders.includes(token) || entry.job.pinned === true) return true;
      const job: QueueJob = holders.length >= MAX_HOLDERS ? { ...entry.job, pinned: true } : { ...entry.job, holders: [...holders, token] };
      await this.#store.put(entry.key, job);
      return true;
    });
  }

  /**
   * Session B2 part 2 (Fedor's answer 2): "Prüfung abbrechen" of one visitor. A job that has started runs to its
   * end; a waiting job loses this visitor's token and leaves the queue when no token is left. Before it is deleted,
   * `finalize` records the end in D1 while the job is marked `cancelled`, inside the queue's order of changes: a
   * start that joins at that moment waits and then finds the job gone and D1 already changed, and no run takes it.
   */
  cancel(id: string, token: string, finalize: (job: QueueJob) => Promise<void>): Promise<CancelOutcome> {
    return this.#serial(async () => {
      const entry = (await this.#liveJobs()).find((e) => e.job.id === id);
      if (entry === undefined) return 'unknown';
      if (entry.job.startedAt !== undefined) return 'running';
      const holders = entry.job.holders ?? [];
      if (!holders.includes(token)) return 'not-holder';
      const left = holders.filter((h) => h !== token);
      if (left.length > 0 || entry.job.pinned === true) {
        await this.#store.put(entry.key, { ...entry.job, holders: left });
        return 'kept';
      }
      await this.#store.put(entry.key, { ...entry.job, holders: [], cancelled: true });
      try {
        await finalize(entry.job);
      } finally {
        await this.#store.delete(entry.key);
      }
      return 'removed';
    });
  }

  /** Jobs left marked `cancelled` by a run that was lost during a cancel: deleted, returned so D1 can be told again. */
  dropCancelled(): Promise<QueueJob[]> {
    return this.#serial(async () => {
      const dropped: QueueJob[] = [];
      for (const { key, job } of await this.jobs()) {
        if (job.cancelled !== true) continue;
        await this.#store.delete(key);
        dropped.push(job);
      }
      return dropped;
    });
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
    const all = await this.#liveJobs();
    return all.some((entry) => entry.job.id === id) ? positionIn(all, id) : null;
  }

  async waitingCount(): Promise<number> {
    return (await this.#liveJobs()).filter((entry) => entry.job.startedAt === undefined).length;
  }

  /** The oldest waiting job, not taken (session fix-a5: whether the browser is still needed). */
  async peekNext(): Promise<QueueJob | null> {
    return (await this.#liveJobs()).find((entry) => entry.job.startedAt === undefined)?.job ?? null;
  }

  /**
   * Takes the oldest waiting job and marks it started. In the queue's order of changes (session B2 part 2), so a
   * cancel and the start of the same job never interleave: the job is either cancelled before or running after.
   */
  takeNext(now: number): Promise<QueueJob | null> {
    return this.#serial(async () => {
      const next = (await this.#liveJobs()).find((entry) => entry.job.startedAt === undefined);
      if (next === undefined) return null;
      const job: QueueJob = { ...next.job, startedAt: now, attempts: next.job.attempts + 1 };
      await this.#store.put(next.key, job);
      return job;
    });
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
    for (const { key, job } of await this.#liveJobs()) {
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

  /** Keeps the error of a scan that D1 did not take, to be written by the next runs. */
  async addUnrecorded(id: string, reason: string, now: number): Promise<void> {
    await this.#store.put(`${UNRECORDED_PREFIX}${id}`, { id, reason, since: now } satisfies UnrecordedError);
  }

  /** The errors still to write; those older than an hour are dropped (the hourly cleanup of D1 ends the scan). */
  async unrecorded(now: number): Promise<UnrecordedError[]> {
    const out: UnrecordedError[] = [];
    for (const [key, entry] of await this.#store.list<UnrecordedError>({ prefix: UNRECORDED_PREFIX })) {
      if (now - entry.since > UNRECORDED_KEPT_MS) await this.#store.delete(key);
      else out.push(entry);
    }
    return out;
  }

  async clearUnrecorded(id: string): Promise<void> {
    await this.#store.delete(`${UNRECORDED_PREFIX}${id}`);
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
