import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Session fix-a6, review finding 99: strategy (b) (Resource Timing in the page) and the A2 lab Worker lived only for
 * each other. They are deleted; the production path never needed them.
 */

const ROOT = resolve(import.meta.dirname, '../..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(?:ts|jsonc?)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('finding 99: strategy (b) and the A2 lab are gone', () => {
  it('the files of strategy (b) and of the A2 lab Worker do not exist', () => {
    for (const file of ['worker/src/capture/resource-timing.ts', 'scanner/src/capture/resource-timing.ts', 'worker/src/lab/index.ts', 'worker/src/lab/handler.ts', 'worker/src/lab/cpu.ts', 'worker/wrangler.lab.jsonc', 'scanner/src/local/cloudflare-lab.ts']) {
      expect(existsSync(resolve(ROOT, file)), file).toBe(false);
    }
  });

  it('no source, test or config names the code of strategy (b) or the A2 lab', () => {
    const names = /captureWithResourceTiming|RESOURCE_TIMING_|createLabGate|LabBrowser|wrangler\.lab\.jsonc|lab:cloudflare/;
    const self = resolve(import.meta.dirname, 'lab-removed.test.ts');
    const hits = [...sources(resolve(ROOT, 'scanner/src')), ...sources(resolve(ROOT, 'worker/src')), ...sources(resolve(ROOT, 'scanner/test')), ...sources(resolve(ROOT, 'worker/test')), resolve(ROOT, 'package.json')]
      .filter((file) => file !== self && names.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });
});
