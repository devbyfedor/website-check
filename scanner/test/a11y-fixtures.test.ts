import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AXE_RULES, AXE_VERSION } from '../src/a11y/types.ts';
import { SCANNER_ROOT } from './helpers.ts';

/**
 * The accessibility fixture pages (session A3) without a browser: the manifest is complete and
 * every page is self-contained. The pages themselves run through the real axe-core in Chromium
 * in `npm run test:integration` (test/integration/a11y-security.test.ts), because the contrast
 * rule needs a real layout.
 */

const DIR = resolve(SCANNER_ROOT, 'fixtures/a11y');
const manifest = JSON.parse(readFileSync(resolve(DIR, 'expected.json'), 'utf8')) as {
  axeVersion: string;
  rules: string[];
  pages: Record<string, { violations: Record<string, number>; incomplete: Record<string, number> }>;
};

describe('accessibility fixture manifest', () => {
  it('is for the pinned axe-core and the seven rules', () => {
    expect(manifest.axeVersion).toBe(AXE_VERSION);
    expect(manifest.rules).toEqual([...AXE_RULES]);
  });

  it('lists every page in the folder, and every page lists every rule', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort();
    expect(Object.keys(manifest.pages).sort()).toEqual(files);
    for (const [name, page] of Object.entries(manifest.pages)) {
      expect(Object.keys(page.violations).sort(), name).toEqual([...AXE_RULES].sort());
      for (const id of AXE_RULES) expect(Number.isInteger(page.violations[id]), `${name} ${id}`).toBe(true);
    }
  });

  it('has a page with errors and a page without errors for every rule', () => {
    for (const id of AXE_RULES) {
      const fail = manifest.pages[`${id}-fail.html`];
      const pass = manifest.pages[`${id}-pass.html`];
      expect(fail?.violations[id] ?? 0, `${id}-fail.html`).toBeGreaterThan(0);
      expect(pass, `${id}-pass.html`).toBeDefined();
      expect(Object.values(pass?.violations ?? {}).every((n) => n === 0), `${id}-pass.html has no violations`).toBe(true);
    }
  });

  it.each(Object.keys(manifest.pages))('%s loads nothing from elsewhere and names no real company', (name) => {
    const html = readFileSync(resolve(DIR, name), 'utf8');
    const urls = [...html.matchAll(/(?:src|href|action|srcset|url\()\s*=?\s*["']?\s*((?:https?:)?\/\/[^"')\s>]+)/gi)].map((m) => m[1]);
    expect(urls).toEqual([]);
    expect(html).not.toMatch(/@import|<link[^>]+rel=["']?stylesheet[^>]+href=["']?https?:/i);
    expect(html).toMatch(/Muster|Beispiel/);
  });
});
