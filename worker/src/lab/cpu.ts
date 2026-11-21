/**
 * CPU load for the Durable Object experiment of A2 part 2: a fixed number of xorshift steps.
 *
 * The load is given as a number of steps, not as a time: inside a Worker or a Durable Object the
 * clocks stand still while code runs (they only advance on I/O), so a time-based loop would never
 * end. The CPU time comes from Cloudflare's own log (`wrangler tail`). Calibrated on the laptop
 * with Node 24: 1e9 steps took 1.47 s of CPU.
 */

/** Upper bound for one request, so a typo cannot keep the object busy for minutes. */
export const MAX_CPU_STEPS = 4_000_000_000;

export function cpuWork(steps: number): number {
  let x = 0x9e3779b9 | 0;
  let sum = 0;
  for (let i = 0; i < steps; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    sum = (sum + (x & 0xff)) | 0;
  }
  return sum >>> 0;
}

export function isValidSteps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_CPU_STEPS;
}
