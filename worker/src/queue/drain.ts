import { chooseMode, type QueueJob, type ScanMode, type ScanQueue } from './core.ts';

/**
 * One run of the queue (session A5 part 3): the Durable Object calls it from its alarm. It starts waiting
 * jobs while fewer than `maxParallel` run and fewer than `maxJobsPerRun` were started in this run, decides
 * for each job at its start whether it gets the full check or the quick check, and closes the browser as
 * soon as no full check runs and no job waits. Returns whether jobs still wait (the caller sets the next
 * alarm at once). Never throws for one job: a failed job is reported to `onJobError`.
 */

/** Browser Run refused a browser because the day's browser time is used up (HTTP 429 although a new browser was allowed). */
export class BrowserTimeExhausted extends Error {
  constructor(message = 'browser time of the day used up') {
    super(message);
    this.name = 'BrowserTimeExhausted';
  }
}

export interface BrowserPort {
  /** Opens the browser unless one is open and connected; waits for the launch spacing. Throws `BrowserTimeExhausted` at the daily limit. */
  ensure(): Promise<void>;
  /** Milliseconds the open browser has been open, 0 without one. */
  openMs(): number;
  /** Closes the browser if one is open; adds its time to the day. */
  closeIfOpen(): Promise<void>;
}

export interface DrainDeps {
  queue: ScanQueue;
  browser: BrowserPort;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Runs one scan to its end (report saved or the error recorded in D1). */
  runJob(job: QueueJob, mode: ScanMode): Promise<void>;
  /** A job that could not run (for example the browser could not be opened): record it in D1. */
  onJobError(job: QueueJob, error: unknown): Promise<void>;
  /** How often the loop looks for new jobs while scans run. */
  pollMs?: number;
}

export interface DrainResult {
  started: number;
  full: number;
  quick: number;
  failed: number;
  /** Jobs still wait: the caller sets the next alarm. */
  more: boolean;
}

export async function drain(deps: DrainDeps): Promise<DrainResult> {
  const { queue } = deps;
  const limits = queue.limits;
  const pollMs = deps.pollMs ?? 500;
  const running = new Map<string, Promise<void>>();
  const result: DrainResult = { started: 0, full: 0, quick: 0, failed: 0, more: false };
  let runningFull = 0;

  // A run starts only when no other run is active in the object (and a Durable Object has one instance), so a
  // job that counts as started is not running any more: retried at once, or given up after its second start.
  const stale = await queue.recoverStale(deps.now(), new Set(), 0);
  for (const job of stale.abandoned) await deps.onJobError(job, new Error('job did not finish after a retry')).catch(() => undefined);

  const runOne = async (job: QueueJob): Promise<void> => {
    let mode: ScanMode = chooseMode(job, await queue.day(deps.now()), limits, deps.browser.openMs());
    // Counted before the browser opens, so a scan that ends meanwhile does not close the browser this one needs.
    let holdsBrowser = mode === 'full';
    if (holdsBrowser) runningFull += 1;
    try {
      if (mode === 'full') {
        try {
          await deps.browser.ensure();
        } catch (error) {
          if (!(error instanceof BrowserTimeExhausted)) throw error;
          await queue.markExhausted(deps.now());
          mode = 'quick';
          holdsBrowser = false;
          runningFull -= 1;
        }
      }
      await queue.countStart(mode, deps.now());
      result[mode] += 1;
      await deps.runJob(job, mode);
    } catch (error) {
      result.failed += 1;
      await deps.onJobError(job, error).catch(() => undefined);
    } finally {
      if (holdsBrowser) runningFull -= 1;
      await queue.finish(job);
      // Browser time counts while the browser is open, also between scans: close it as soon as nothing needs it,
      // also when jobs wait but the next one would get the quick check (session fix-a5, review finding 47).
      if (runningFull === 0 && !(await nextNeedsBrowser())) await deps.browser.closeIfOpen().catch(() => undefined);
    }
  };

  /** Whether the oldest waiting job would start as a full check now (with the open browser's time counted). */
  const nextNeedsBrowser = async (): Promise<boolean> => {
    const next = await queue.peekNext();
    return next !== null && chooseMode(next, await queue.day(deps.now()), limits, deps.browser.openMs()) === 'full';
  };

  for (;;) {
    while (running.size < limits.maxParallel && result.started < limits.maxJobsPerRun) {
      const job = await queue.takeNext(deps.now());
      if (job === null) break;
      result.started += 1;
      running.set(
        job.id,
        runOne(job).finally(() => running.delete(job.id)),
      );
    }
    if (running.size === 0) break;
    await Promise.race([...running.values(), deps.sleep(pollMs)]);
  }
  result.more = (await queue.waitingCount()) > 0;
  if (!(await nextNeedsBrowser())) await deps.browser.closeIfOpen().catch(() => undefined);
  return result;
}
