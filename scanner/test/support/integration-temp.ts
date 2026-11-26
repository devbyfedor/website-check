import { lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Session C1, step 2: the global setup of both integration configs gives each run a temp folder of its own and deletes
 * it at the end. Every process of the run (the local runtime of wrangler with its `miniflare-*` folders, Chromium with
 * its `playwright_chromiumdev_profile-*` profile and `scoped_dir*` folders, the persist folders of the tests) takes
 * its temp folder from TEMP, TMP or TMPDIR, so they all land in the run's folder. A run that was killed before its end
 * leaves its folder; the next run deletes it (its process no longer lives).
 */

export const RUN_PREFIX = 'wc-integration-';

/** The folders of earlier runs whose process no longer lives. A folder that holds a link (a junction) is never touched. */
export function removeStaleRunDirs(base: string, isAlive: (pid: number) => boolean): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const name of readdirSync(base)) {
    const match = new RegExp(`^${RUN_PREFIX}(\\d+)-`).exec(name);
    if (match === null) continue;
    const path = join(base, name);
    if (isAlive(Number(match[1])) || holdsLink(path)) {
      kept.push(path);
      continue;
    }
    if (removeDir(path)) removed.push(path);
    else kept.push(path);
  }
  return { removed, kept };
}

function holdsLink(path: string): boolean {
  const stack = [path];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = join(dir, entry);
      let stat;
      try {
        stat = lstatSync(child);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) return true;
      if (stat.isDirectory()) stack.push(child);
    }
  }
  return false;
}

/** Recursive delete with retries: a process killed a moment ago (workerd, Chromium) can still hold a file. */
export function removeDir(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    return true;
  } catch {
    return false;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

const NAMES = ['TEMP', 'TMP', 'TMPDIR'] as const;

export default function setup(): () => void {
  const base = tmpdir();
  const stale = removeStaleRunDirs(base, alive);
  if (stale.removed.length > 0) console.log(`temp folders of earlier runs deleted: ${stale.removed.length}`);
  const dir = mkdtempSync(join(base, `${RUN_PREFIX}${process.pid}-`));
  const saved = NAMES.map((name) => [name, process.env[name]] as const);
  // Set before the test workers start, so they and every process they start inherit it.
  for (const name of NAMES) process.env[name] = dir;
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (holdsLink(dir)) console.log(`temp folder of this run kept, it holds a link: ${dir}`);
    else if (!removeDir(dir)) console.log(`temp folder of this run not deleted: ${dir}`);
  };
}
