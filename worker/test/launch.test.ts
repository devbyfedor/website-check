import { describe, expect, it } from 'vitest';
import { QUEUE_LIMITS } from '../src/queue/core.ts';
import { BrowserTimeExhausted } from '../src/queue/drain.ts';
import { BrowserLaunchRefused, cloudflareCountsDayUsed, isDailyLimitAnswer, launchBrowser, type BrowserRunReading, type LaunchDeps } from '../src/queue/launch.ts';

/**
 * Session C2 (Fedor's answer 1 after C1): a refused browser launch is not the end of the day. The day ends only by
 * Browser Run's answer at its daily limit or by its own count; the 20 s between new browsers count from the start of
 * the last session with a margin; after a refusal one more attempt after a wait. One test per case, on a clock
 * that only moves when the code sleeps or Browser Run takes time to answer.
 */

const TOO_MANY = 'Unable to create new browser: code: 429: message: Too many requests';
/** The text of Browser Run's docs at the daily limit of the free plan (developers.cloudflare.com/browser-run/limits/). */
const DAY_USED = 'Unable to create new browser: code: 429: message: Browser time limit exceeded for today';

interface FakeRun {
  deps: LaunchDeps;
  clock: { now: number };
  acquires: number[];
  sleeps: number[];
  marks: number[];
}

/**
 * A fake Browser Run on a fake clock. `answers` decides each acquire in turn (a text throws it as the refusal; `ok`
 * gives a session); `acquireMs` is how long an acquire takes; `readings` are the answers of `limits()` in turn.
 */
function fakeRun(options: { answers?: (string | 'ok')[]; acquireMs?: number; readings?: (BrowserRunReading | null)[]; lastLaunchAt?: number | null; now?: number } = {}): FakeRun {
  const clock = { now: options.now ?? 1_000_000 };
  const answers = [...(options.answers ?? ['ok'])];
  const readings = [...(options.readings ?? [])];
  const acquires: number[] = [];
  const sleeps: number[] = [];
  const marks: number[] = [];
  let last = options.lastLaunchAt ?? null;
  const deps: LaunchDeps = {
    acquire: async () => {
      acquires.push(clock.now);
      clock.now += options.acquireMs ?? 0;
      const answer = answers.shift() ?? 'ok';
      if (answer !== 'ok') throw new Error(answer);
      return `session-${acquires.length}`;
    },
    readLimits: async () => (readings.length > 0 ? readings.shift()! : { usedBrowserTimeSeconds: 0, timeUntilNextAllowedBrowserAcquisition: 0 }),
    lastLaunchAt: async () => last,
    setLastLaunchAt: async (at) => {
      last = at;
      marks.push(at);
    },
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    limits: QUEUE_LIMITS,
  };
  return { deps, clock, acquires, sleeps, marks };
}

const SPACING = QUEUE_LIMITS.launchSpacingMs + QUEUE_LIMITS.launchMarginMs;

describe('session C2: the limits of a launch', () => {
  it('the spacing is Browser Run\'s 20 s plus a margin of 2 s', () => {
    expect(QUEUE_LIMITS.launchSpacingMs).toBe(20_000);
    expect(QUEUE_LIMITS.launchMarginMs).toBe(2_000);
  });

  it('only Browser Run\'s documented answer at the daily limit counts as the day\'s end', () => {
    expect(isDailyLimitAnswer(DAY_USED)).toBe(true);
    expect(isDailyLimitAnswer('429 Browser time limit exceeded for today')).toBe(true);
    for (const text of [TOO_MANY, 'Unable to create new browser: code: 429: message: Rate limit exceeded', 'limit exceeded', 'code: 503', '']) expect(isDailyLimitAnswer(text), text).toBe(false);
  });

  it('Cloudflare\'s own count ends the day only when one more full check does not fit the budget', () => {
    // 540 s budget, 45 s reserve: 495 s still leave room, 495.001 s do not.
    expect(cloudflareCountsDayUsed({ usedBrowserTimeSeconds: 495 }, QUEUE_LIMITS)).toBe(false);
    expect(cloudflareCountsDayUsed({ usedBrowserTimeSeconds: 495.001 }, QUEUE_LIMITS)).toBe(true);
    expect(cloudflareCountsDayUsed({ usedBrowserTimeSeconds: 600 }, QUEUE_LIMITS)).toBe(true);
    // No count, or no reading at all: never the day's end.
    expect(cloudflareCountsDayUsed({}, QUEUE_LIMITS)).toBe(false);
    expect(cloudflareCountsDayUsed(null, QUEUE_LIMITS)).toBe(false);
    expect(cloudflareCountsDayUsed({ usedBrowserTimeSeconds: Number.NaN }, QUEUE_LIMITS)).toBe(false);
  });
});

describe('session C2: the 20 s count from the start of the last session, with a margin', () => {
  it('the first launch of a fresh object does not wait', async () => {
    const run = fakeRun();
    const launch = await launchBrowser(run.deps);
    expect(launch).toEqual({ sessionId: 'session-1', startedAt: 1_000_000, refusals: [], waitedMs: 0 });
    expect(run.sleeps).toEqual([]);
  });

  it('the mark is taken when acquire returned, so a slow acquire moves the next launch later', async () => {
    const run = fakeRun({ acquireMs: 3_000 });
    await launchBrowser(run.deps);
    // A mark before the acquire (for a session started without an answer), then the one after it.
    expect(run.marks).toEqual([1_000_000, 1_003_000]);
  });

  it('a launch 5 s after the last mark waits the other 17 s (20 s and the margin)', async () => {
    const run = fakeRun({ lastLaunchAt: 1_000_000, now: 1_005_000 });
    const launch = await launchBrowser(run.deps);
    expect(run.sleeps).toEqual([17_000]);
    expect(run.acquires).toEqual([1_022_000]);
    expect(launch.waitedMs).toBe(17_000);
  });

  it('a launch after the spacing does not wait', async () => {
    const run = fakeRun({ lastLaunchAt: 1_000_000, now: 1_000_000 + SPACING });
    await launchBrowser(run.deps);
    expect(run.sleeps).toEqual([]);
  });

  it('the C1 timeline: Browser Run\'s rule from its own session start is met (the old mark before acquire was not)', async () => {
    // C1, first run one by one (docs/measurements/c1.md), times from the first start: the queue called acquire at 0.65 s,
    // Browser Run's session began at 1.60 s; the second check asked for a browser at 12.51 s, the queue waited for
    // 20 s from 0.65 s, and the launch was refused. A fake Browser Run that checks a request 0.1 s after the call
    // against 20 s from the last session's start, a session starting 0.95 s after the call, its answer 0.2 s later.
    const t0 = 2_000_000;
    let sessionStart: number | null = null;
    const clock = { now: t0 + 650 };
    let last: number | null = null;
    const acquires: number[] = [];
    const deps: LaunchDeps = {
      acquire: async () => {
        acquires.push(clock.now);
        const arrives = clock.now + 100;
        const start = clock.now + 950;
        clock.now += 1_150;
        if (sessionStart !== null && arrives - sessionStart < 20_000) throw new Error(TOO_MANY);
        sessionStart = start;
        return `session-${acquires.length}`;
      },
      readLimits: async () => ({ usedBrowserTimeSeconds: 0, timeUntilNextAllowedBrowserAcquisition: 0 }),
      lastLaunchAt: async () => last,
      setLastLaunchAt: async (at) => {
        last = at;
      },
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      limits: QUEUE_LIMITS,
    };
    await launchBrowser(deps);
    expect(sessionStart).toBe(t0 + 1_600);
    clock.now = t0 + 12_510;
    const second = await launchBrowser(deps);
    expect(second.refusals).toEqual([]);
    // Asked 22 s after the answer of the first acquire (1.80 s), at 23.80 s: 22.3 s after the first session's start.
    expect(acquires[1]).toBe(t0 + 1_800 + SPACING);
    expect(acquires[1]! + 100 - (t0 + 1_600)).toBe(22_300);
  });

  it('control: the same fake Browser Run refuses the old rule\'s launch (20 s from the mark before the acquire)', async () => {
    // 0.65 s + 20 s = 20.65 s, checked at 20.75 s: 19.15 s after the session's start at 1.60 s.
    const sessionStart = 1_600;
    const oldCall = 650 + QUEUE_LIMITS.launchSpacingMs;
    expect(oldCall + 100 - sessionStart).toBeLessThan(20_000);
  });
});

describe('session C2: a refused launch', () => {
  it('a refusal of the 20 s rule: one more attempt after 22 s, the browser opens, the day is not used up', async () => {
    const run = fakeRun({ answers: [TOO_MANY, 'ok'] });
    const launch = await launchBrowser(run.deps);
    expect(launch.sessionId).toBe('session-2');
    expect(launch.refusals).toEqual([TOO_MANY]);
    expect(run.sleeps).toEqual([SPACING]);
    expect(run.acquires).toEqual([1_000_000, 1_000_000 + SPACING]);
    expect(launch.startedAt).toBe(1_000_000 + SPACING);
  });

  it('a refusal while Browser Run asks to wait longer than 22 s: the attempt waits for it (at most 60 s)', async () => {
    const longer = fakeRun({ answers: [TOO_MANY, 'ok'], readings: [{ usedBrowserTimeSeconds: 10 }, { usedBrowserTimeSeconds: 10, timeUntilNextAllowedBrowserAcquisition: 30_000 }] });
    await launchBrowser(longer.deps);
    expect(longer.sleeps).toEqual([30_000]);
    const capped = fakeRun({ answers: [TOO_MANY, 'ok'], readings: [{}, { timeUntilNextAllowedBrowserAcquisition: 3_600_000 }] });
    await launchBrowser(capped.deps);
    expect(capped.sleeps).toEqual([60_000]);
    // A reading that may be seconds (18) never shortens the 22 s.
    const short = fakeRun({ answers: [TOO_MANY, 'ok'], readings: [{}, { timeUntilNextAllowedBrowserAcquisition: 18 }] });
    await launchBrowser(short.deps);
    expect(short.sleeps).toEqual([SPACING]);
  });

  it('any other error of the acquire is a refusal too: one more attempt, not the day\'s end', async () => {
    const run = fakeRun({ answers: ['Unable to create new browser: code: 500: message: internal error', 'ok'] });
    const launch = await launchBrowser(run.deps);
    expect(launch.sessionId).toBe('session-2');
    expect(run.acquires).toHaveLength(2);
  });

  it('two refusals without the day\'s end: BrowserLaunchRefused after exactly two attempts, never BrowserTimeExhausted', async () => {
    const run = fakeRun({ answers: [TOO_MANY, TOO_MANY], readings: [{ usedBrowserTimeSeconds: 30 }, { usedBrowserTimeSeconds: 30 }, { usedBrowserTimeSeconds: 31 }] });
    const error = await launchBrowser(run.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserLaunchRefused);
    expect(error).not.toBeInstanceOf(BrowserTimeExhausted);
    expect((error as BrowserLaunchRefused).refusals).toEqual([TOO_MANY, TOO_MANY]);
    expect(run.acquires).toHaveLength(2);
    expect(run.sleeps).toEqual([SPACING]);
  });

  it('Browser Run\'s answer at the daily limit: the day is used up at once, no second attempt, no wait', async () => {
    const run = fakeRun({ answers: [DAY_USED, 'ok'] });
    const error = await launchBrowser(run.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserTimeExhausted);
    expect((error as Error).message).toBe(DAY_USED);
    expect(run.acquires).toHaveLength(1);
    expect(run.sleeps).toEqual([]);
  });

  it('a refusal while Cloudflare\'s own count is at the budget: the day is used up, no second attempt', async () => {
    const run = fakeRun({ answers: [TOO_MANY, 'ok'], readings: [{ usedBrowserTimeSeconds: 480 }, { usedBrowserTimeSeconds: 500 }] });
    const error = await launchBrowser(run.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserTimeExhausted);
    expect((error as Error).message).toContain('Too many requests');
    expect(run.acquires).toHaveLength(1);
  });

  it('the second attempt answered with the daily limit: the day is used up', async () => {
    const run = fakeRun({ answers: [TOO_MANY, DAY_USED] });
    const error = await launchBrowser(run.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserTimeExhausted);
    expect(run.acquires).toHaveLength(2);
  });

  it('Cloudflare\'s count at the budget before any attempt: the day is used up and no browser is asked for', async () => {
    const run = fakeRun({ readings: [{ usedBrowserTimeSeconds: 500 }] });
    const error = await launchBrowser(run.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserTimeExhausted);
    expect(run.acquires).toEqual([]);
  });

  it('a refusal while limits() cannot be read: one more attempt, not the day\'s end', async () => {
    const run = fakeRun({ answers: [TOO_MANY, 'ok'], readings: [null, null] });
    const launch = await launchBrowser(run.deps);
    expect(launch.refusals).toEqual([TOO_MANY]);
  });

  it('a long refusal text is kept to 200 characters', async () => {
    const run = fakeRun({ answers: [`${TOO_MANY} ${'x'.repeat(500)}`, 'ok'] });
    const launch = await launchBrowser(run.deps);
    expect(launch.refusals[0]).toHaveLength(200);
  });
});
