import { describe, expect, it } from 'vitest';
import { cpuMs, endsBefore, HANG_GUARD_MS, relativeSpeed } from './speed.ts';

// Session B5 part 1: the helpers of the speed checks themselves (test/speed.ts).

const spin = (n: number): number => {
  let x = 0;
  for (let i = 0; i < n; i += 1) x = (x * 31 + i) % 1_000_003;
  return x;
};

describe('speed checks independent of the machine', () => {
  it('cpuMs counts the work of this thread, not the waiting', async () => {
    const busy = cpuMs(() => spin(15_000_000));
    expect(busy.ms).toBeGreaterThan(0);
    const before = process.threadCpuUsage();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const waited = process.threadCpuUsage(before);
    // 200 ms of waiting cost (almost) no CPU of this thread.
    expect((waited.user + waited.system) / 1000).toBeLessThan(100);
  });

  it('relativeSpeed flags work far above the ordinary input and lets work of the same order pass', () => {
    // About 60 ms each: well above the 15.6 ms steps in which Windows counts the CPU time of a thread.
    const ordinary = () => spin(15_000_000);
    // Six times the ordinary work against a limit of two, and the same work against a limit of four: a margin of three
    // for the steps of 15.6 ms, also on a machine four times faster (review of B5 part 1).
    const flagged = relativeSpeed(() => spin(90_000_000), ordinary, { factor: 2, floorMs: 0 });
    // Over its limit in the best of the three tries, so in every try.
    expect(flagged.ms).toBeGreaterThanOrEqual(flagged.limit);
    expect([1, 2, 3]).toContain(flagged.tries);
    const passed = relativeSpeed(() => spin(15_000_000), ordinary, { factor: 4, floorMs: 0 });
    expect(passed.ms).toBeLessThan(passed.limit);
    expect(passed.value).toBe(spin(15_000_000));
  }, HANG_GUARD_MS);

  it('endsBefore tells a limit that ends the work in time from work that outlasts the timer', async () => {
    const inTime = await endsBefore(500, () => new Promise((resolve) => setTimeout(() => resolve('a'), 20)));
    expect(inTime).toEqual({ value: 'a', first: true });
    const late = await endsBefore(20, () => new Promise((resolve) => setTimeout(() => resolve('b'), 200)));
    expect(late).toEqual({ value: 'b', first: false });
  });
});
