import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { HEAVY_HTML, MB2 } from './support/heavy-html.ts';
import { HANG_GUARD_MS } from './speed.ts';

/**
 * Session C2 (Fedor's answer 2 after C1): the peak memory of the quick check's HTML reader on any page of up to 2 MB is
 * at most 32 MB, so that three checks side by side fit the 128 MB of the queue object. In C1, 2 MiB of empty `<p>` reset
 * the queue object on Cloudflare ("exceeded its memory limit"); on this laptop the reader needed 260 MB for it.
 *
 * Measured with a worker thread whose heap has a hard limit (`resourceLimits`; the young generation fixed at 4 MB): the
 * baseline is the smallest old generation in which the worker loads the reader and reads a small page; every page of
 * `support/heavy-html.ts` must then be read in that baseline plus 32 MB, or the worker ends out of memory. The page
 * string itself counts against the 32 MB (it is built in the worker right before it is read).
 */

const WORKER = new URL('./support/reader-memory-worker.ts', import.meta.url);
const YOUNG_MB = 4;
const READER_MB = 32;

interface Run {
  done: boolean;
  /** The page the worker was reading when it ended. */
  last: string | null;
  read: { read: string; ms: number; elementsTruncated: boolean }[];
  error: string | null;
}

function runWorker(pages: string[], oldMb: number): Promise<Run> {
  return new Promise((resolve) => {
    const run: Run = { done: false, last: null, read: [], error: null };
    const worker = new Worker(WORKER, { workerData: { pages }, resourceLimits: { maxOldGenerationSizeMb: oldMb, maxYoungGenerationSizeMb: YOUNG_MB } });
    worker.on('message', (m: { page?: string; read?: string; ms?: number; elementsTruncated?: boolean; done?: boolean }) => {
      if (m.page !== undefined) run.last = m.page;
      if (m.read !== undefined) run.read.push({ read: m.read, ms: m.ms ?? 0, elementsTruncated: m.elementsTruncated === true });
      if (m.done === true) run.done = true;
    });
    worker.on('error', (error: Error & { code?: string }) => {
      run.error = error.code ?? error.message;
    });
    worker.on('exit', () => resolve(run));
  });
}

/** The smallest old generation (MB) in which the worker loads the reader and reads its small page. */
async function baselineMb(): Promise<number> {
  let lo = 2;
  let hi = 64;
  if (!(await runWorker([], hi)).done) throw new Error('the worker does not start in 64 MB');
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await runWorker([], mid)).done) hi = mid;
    else lo = mid;
  }
  return hi;
}

describe('session C2: the memory of the quick check\'s HTML reader', () => {
  it(`every page of up to 2 MB is read within ${READER_MB} MB more than the reader alone`, async () => {
    const base = await baselineMb();
    const pages = Object.keys(HEAVY_HTML);
    expect(pages.length).toBeGreaterThanOrEqual(35);
    const run = await runWorker(pages, base + READER_MB);
    expect(run.error, `out of memory on "${run.last}" (baseline ${base} MB + ${READER_MB} MB)`).toBeNull();
    expect(run.done).toBe(true);
    expect(run.read.map((r) => r.read)).toEqual(pages);
    // The pages of many elements are the ones the limit cuts; the six of fix-a4 among them.
    for (const name of ['empty-p', 'td-in-one-row', 'hr', 'dd-dt', 'table-foster-text', 'nested-tables', 'br', 'unknown-element']) {
      expect(run.read.find((r) => r.read === name)?.elementsTruncated, name).toBe(true);
    }
  }, HANG_GUARD_MS);

  it('control: the worker ends out of memory when a page needs more than the limit', async () => {
    const base = await baselineMb();
    // 2 MiB of empty <p> in a heap of the baseline plus 2 MB: the reader needs more even with its limit of elements.
    const run = await runWorker(['empty-p'], base + 2);
    expect(run.error).toBe('ERR_WORKER_OUT_OF_MEMORY');
    expect(run.last).toBe('empty-p');
    expect(HEAVY_HTML['empty-p']?.().length).toBe(MB2);
  }, HANG_GUARD_MS);
});
