import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/**
 * The pinned axe-core (`axe-core/axe.min.js`) as a string, read once per process. The Worker
 * bundles the same file as text (see `worker/src/capture/axe-source.ts`).
 */
let cached: Promise<string> | null = null;

export function loadAxeSource(): Promise<string> {
  cached ??= readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  return cached;
}
