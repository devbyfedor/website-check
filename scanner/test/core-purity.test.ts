import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCANNER_ROOT } from './helpers.ts';

/**
 * The scan core runs inside a Cloudflare Worker. Only `src/local/` may use Node built-ins
 * or Playwright; everything else must stay runtime-neutral.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('core purity', () => {
  const src = join(SCANNER_ROOT, 'src');
  const coreFiles = sourceFiles(src).filter((file) => !relative(src, file).startsWith('local'));

  it('finds the core files', () => {
    expect(coreFiles.length).toBeGreaterThan(5);
  });

  it.each(coreFiles.map((file) => [relative(SCANNER_ROOT, file).replaceAll('\\', '/'), file]))('%s uses no Node built-ins or Playwright', (_name, file) => {
    const code = readFileSync(file, 'utf8');
    const imports = [...code.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec, `import of ${spec}`).not.toMatch(/^node:|^(fs|path|os|child_process|http|https|net|url|util|crypto)$|^playwright/);
      if (spec?.startsWith('.')) expect(spec, `relative import ${spec} must not reach into local/`).not.toMatch(/(^|\/)local\//);
    }
    expect(code).not.toMatch(/\bprocess\.|\bBuffer\.|\brequire\(/);
  });
});
