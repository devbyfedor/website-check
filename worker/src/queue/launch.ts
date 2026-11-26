import type { QueueLimits } from './core.ts';
import { BrowserTimeExhausted } from './drain.ts';

/**
 * Opening a new browser at Browser Run (session C2, Fedor's answer 1 after C1).
 *
 * In C1 a refused second launch marked the whole UTC day as used up after 9.7 s of the 540 s budget: the queue
 * counted the 20 s between new browsers from its own mark before `acquire`, Browser Run's session began 0.95 s
 * later, and a refusal right after was taken for the day's limit (`docs/measurements/c1.md`). The rules now:
 *
 * - A refused launch is not the end of the day. The day ends only when Browser Run says so in its answer (its
 *   documented text at the daily limit of the free plan is "429 Browser time limit exceeded for today") or when
 *   Cloudflare's own count of the day's browser time (`usedBrowserTimeSeconds` of `limits()`) leaves no room for
 *   one more full check, the same rule as before every launch.
 * - The 20 s between new browsers count from the start of the last session: the mark is taken when `acquire`
 *   returned (the session exists by then, so its start lies before the mark), and the queue waits
 *   `launchSpacingMs + launchMarginMs` from it.
 * - After a refusal: one more attempt, after a full spacing and margin (so any session that began before the
 *   refusal is 20 s old by then), or longer if Browser Run's reading asks for it. A second refusal the day's rules
 *   do not confirm ends this launch with `BrowserLaunchRefused`: the scans that waited for it end as our error
 *   (the quick check is not given, because its note promises the full check only for tomorrow), the day stays open.
 */

/** The fields of Browser Run's `limits()` the queue reads (`BrowserRunLimits` of `@cloudflare/workers-types`). */
export interface BrowserRunReading {
  /** Cloudflare's count of the day's browser time, in seconds (in the types, not in the docs; optional). */
  usedBrowserTimeSeconds?: number;
  /** "the waiting period before a new browser can be launched"; the docs name no unit, the queue reads milliseconds. */
  timeUntilNextAllowedBrowserAcquisition?: number;
}

export type LaunchLimits = Pick<QueueLimits, 'launchSpacingMs' | 'launchMarginMs' | 'browserBudgetMs' | 'reservePerScanMs'>;

export interface LaunchDeps {
  /** Browser Run's `acquire`: the new session's id; throws when the launch is refused. */
  acquire(): Promise<string>;
  /** Browser Run's `limits()`, or null when they cannot be read. */
  readLimits(): Promise<BrowserRunReading | null>;
  lastLaunchAt(): Promise<number | null>;
  setLastLaunchAt(at: number): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  limits: LaunchLimits;
}

export interface Launch {
  sessionId: string;
  /** Taken before the `acquire` that gave the session: the browser's time counts from here. */
  startedAt: number;
  /** The texts of refused attempts before the one that worked (at most one). */
  refusals: string[];
  /** Milliseconds waited in all before the attempt that worked. */
  waitedMs: number;
}

/** Browser Run refused the launch twice, and neither its answer nor its count says that the day is used up. */
export class BrowserLaunchRefused extends Error {
  readonly refusals: string[];
  constructor(refusals: string[]) {
    super(`browser launch refused twice: ${refusals.at(-1) ?? ''}`.slice(0, 200));
    this.name = 'BrowserLaunchRefused';
    this.refusals = refusals;
  }
}

/** Longest wait after a refusal that a reading of Browser Run can ask for (its rule is one new browser every 20 s). */
const MAX_REFUSAL_WAIT_MS = 60_000;
/** Characters of a refusal's text that are kept. */
const REFUSAL_TEXT = 200;

/** Browser Run's answer at the daily limit of the free plan ("429 Browser time limit exceeded for today", its docs). */
export function isDailyLimitAnswer(text: string): boolean {
  return /browser time limit exceeded|exceeded for today/i.test(text);
}

/** Cloudflare's own count of the day's browser time leaves no room for one more full check. */
export function cloudflareCountsDayUsed(reading: BrowserRunReading | null, limits: LaunchLimits): boolean {
  const used = reading?.usedBrowserTimeSeconds;
  return typeof used === 'number' && Number.isFinite(used) && used * 1000 + limits.reservePerScanMs > limits.browserBudgetMs;
}

function waitOf(reading: BrowserRunReading | null): number {
  const wait = reading?.timeUntilNextAllowedBrowserAcquisition;
  return typeof wait === 'number' && Number.isFinite(wait) && wait > 0 ? wait : 0;
}

function textOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, REFUSAL_TEXT);
}

export async function launchBrowser(deps: LaunchDeps): Promise<Launch> {
  const { limits } = deps;
  const spacing = limits.launchSpacingMs + limits.launchMarginMs;
  let waitedMs = 0;
  const pause = async (ms: number): Promise<void> => {
    if (ms <= 0) return;
    await deps.sleep(ms);
    waitedMs += ms;
  };
  const last = await deps.lastLaunchAt();
  if (last !== null) await pause(Math.min(last + spacing - deps.now(), spacing));
  const before = await deps.readLimits();
  if (cloudflareCountsDayUsed(before, limits)) throw new BrowserTimeExhausted('Cloudflare counts the browser time of the day at the budget');
  await pause(Math.min(waitOf(before), spacing));
  const refusals: string[] = [];
  for (;;) {
    const startedAt = deps.now();
    // Also kept when the acquire fails: a session Browser Run started although its answer never arrived counts too.
    await deps.setLastLaunchAt(startedAt);
    try {
      const sessionId = await deps.acquire();
      // The session exists now: the next new browser waits its 20 s and the margin from here.
      await deps.setLastLaunchAt(Math.max(startedAt, deps.now()));
      return { sessionId, startedAt, refusals, waitedMs };
    } catch (error) {
      const text = textOf(error);
      refusals.push(text);
      if (isDailyLimitAnswer(text)) throw new BrowserTimeExhausted(text);
      const after = await deps.readLimits();
      if (cloudflareCountsDayUsed(after, limits)) throw new BrowserTimeExhausted(`Cloudflare counts the browser time of the day at the budget (${text})`.slice(0, REFUSAL_TEXT));
      if (refusals.length >= 2) throw new BrowserLaunchRefused(refusals);
      await pause(Math.max(spacing, Math.min(waitOf(after), MAX_REFUSAL_WAIT_MS)));
    }
  }
}
