/**
 * Speed checks that do not depend on how fast or how busy the machine is (session B5 part 1).
 *
 * `npm test` runs every test file in parallel, and this laptop has fast and slow cores: a parse of 2 MB took 0.5 s alone
 * and 5.8 s inside the full suite. Two things made such tests fail on a busy machine although nothing was slow: the
 * wall time they measured (it counts the time the thread waits for a core), and the default timeout of Vitest (5 s of
 * wall time), which stopped a test that was merely waiting.
 *
 * So a speed check here measures the CPU time of its own thread (`process.threadCpuUsage`: no waiting, and not the
 * helper threads of the garbage collector, whose time the CPU time of the whole process adds up in parallel), compares
 * it with the CPU time of an ordinary input of the same size measured right before on the same thread (a slow or shared
 * core makes both slower), and takes the best of up to three tries (a try can still be disturbed, for example when the
 * system moves the thread to another kind of core in between). The wall-clock timeout of such a test is only a guard
 * against a test that never ends: `HANG_GUARD_MS`.
 */

/**
 * The wall-clock timeout of a test whose speed is checked by CPU time; it only stops a test that never ends. Far above
 * any time a passing test needs (the slowest, a parse of 2 MB, took 2.4 s with every core of the laptop busy), and
 * below the slowest super-linear fault of the review (183 s for one page of 2 MB before fix-a6).
 */
export const HANG_GUARD_MS = 60_000;

/** The CPU time of `work` on this thread, in milliseconds (user and system time). */
export function cpuMs<T>(work: () => T): { value: T; ms: number } {
  const before = process.threadCpuUsage();
  const value = work();
  const used = process.threadCpuUsage(before);
  return { value, ms: (used.user + used.system) / 1000 };
}

/**
 * Whether `work` ends before a timer of `ms` started right before it: a time limit of the code under test, shorter
 * than `ms`, must end it first. This replaces "it took less than `ms` by the clock on the wall", which failed when the
 * machine was busy: a busy machine delays both timers, and Node runs expired timers in the order of their time.
 */
export async function endsBefore<T>(ms: number, work: () => Promise<T>): Promise<{ value: T; first: boolean }> {
  let late = false;
  const timer = setTimeout(() => {
    late = true;
  }, ms);
  try {
    const value = await work();
    return { value, first: !late };
  } finally {
    clearTimeout(timer);
  }
}

export interface RelativeSpeed<T> {
  value: T;
  /** CPU time of `work` in the best try. */
  ms: number;
  /** Its limit: `factor` times the CPU time of the ordinary input right before, at least `floorMs`. */
  limit: number;
  /** CPU time of the ordinary input in that try. */
  baselineMs: number;
  /** The try that counts (1 to `tries`). */
  tries: number;
}

/**
 * Runs `baseline` (an ordinary input of the same size) and then `work`, both by CPU time of this thread, up to `tries`
 * times while `work` stays over its limit; returns the try with the most room under its limit. A super-linear `work` is
 * over its limit in every try.
 *
 * The factor 8 (session B5 part 1, measured on the hostile pages of 2 MB of the HTML reader): the slowest linear case
 * ("a long table row") takes 3.8 times the ordinary page on a quiet machine and 4.2 times with every core busy; the
 * faults the review found took 1.7 s to 183 s, 20 to 2,000 times the ordinary page (about 90 ms). The floor of 1 s is
 * the limit of fix-a6; on a quiet machine it is still the limit that counts (8 times 90 ms is less), on a slow or busy
 * one the limit grows with the ordinary page.
 */
export function relativeSpeed<T>(work: () => T, baseline: () => unknown, opts: { factor?: number; floorMs?: number; tries?: number } = {}): RelativeSpeed<T> {
  const factor = opts.factor ?? 8;
  const floorMs = opts.floorMs ?? 1000;
  const tries = opts.tries ?? 3;
  let best: RelativeSpeed<T> | null = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const base = cpuMs(baseline).ms;
    const run = cpuMs(work);
    const limit = Math.max(floorMs, factor * base);
    if (best === null || run.ms - limit < best.ms - best.limit) best = { value: run.value, ms: run.ms, limit, baselineMs: base, tries: attempt };
    if (best.ms < best.limit) break;
  }
  return best!;
}
