import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import setup, { removeStaleRunDirs, RUN_PREFIX } from './support/integration-temp.ts';

/** Session C1, step 2: the temp folder of an integration run, and the folders of killed runs. */

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function base(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wc-temp-test-'));
  made.push(dir);
  return dir;
}

describe('the temp folder of an integration run', () => {
  it('deletes the folders of runs whose process is gone, keeps those of a living run and anything else', () => {
    const root = base();
    for (const name of [`${RUN_PREFIX}111-a`, `${RUN_PREFIX}222-b`, 'miniflare-abc', `${RUN_PREFIX}x-c`]) {
      mkdirSync(join(root, name, 'miniflare-1'), { recursive: true });
      writeFileSync(join(root, name, 'miniflare-1', 'f.txt'), 'x');
    }
    const result = removeStaleRunDirs(root, (pid) => pid === 222);
    expect(result.removed).toEqual([join(root, `${RUN_PREFIX}111-a`)]);
    expect(existsSync(join(root, `${RUN_PREFIX}111-a`))).toBe(false);
    expect(existsSync(join(root, `${RUN_PREFIX}222-b`))).toBe(true);
    expect(existsSync(join(root, 'miniflare-abc'))).toBe(true);
    expect(existsSync(join(root, `${RUN_PREFIX}x-c`))).toBe(true);
  });

  it('never deletes a folder that holds a link, and never what the link points at', () => {
    const root = base();
    const target = base();
    writeFileSync(join(target, 'keep.txt'), 'x');
    mkdirSync(join(root, `${RUN_PREFIX}333-d`));
    symlinkSync(target, join(root, `${RUN_PREFIX}333-d`, 'link'), 'junction');
    const result = removeStaleRunDirs(root, () => false);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(target, 'keep.txt'))).toBe(true);
    rmSync(join(root, `${RUN_PREFIX}333-d`, 'link'));
  });

  it('points TEMP, TMP and TMPDIR at a folder of its own while the run lives, then deletes it and restores them', () => {
    const before = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    const teardown = setup();
    const dir = process.env.TEMP as string;
    expect(dir).toContain(`${RUN_PREFIX}${process.pid}-`);
    expect(process.env.TMP).toBe(dir);
    expect(tmpdir()).toBe(dir);
    mkdirSync(join(dir, 'miniflare-x', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'miniflare-x', 'deep', 'f.txt'), 'x');
    teardown();
    expect(existsSync(dir)).toBe(false);
    expect({ TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }).toEqual(before);
  });
});
