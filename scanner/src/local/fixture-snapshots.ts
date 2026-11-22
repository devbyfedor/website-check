import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser } from 'playwright';
import { IMPRESSUM_SNAPSHOT_EXPRESSION, type SnapshotResult } from '../capture/page-scripts.ts';
import type { PageLink } from '../capture/types.ts';

/**
 * Snapshots of the synthetic fixture pages of session A4 (`scanner/fixtures/impressum/pages/` and
 * `scanner/fixtures/legal-links/`): the visible text and the links exactly as Chromium gives them to
 * the analyzers (`innerText`, resolved addresses, footer flags). `npm test` runs the analyzers on the
 * saved snapshots without a browser; the integration test takes them again and checks that they are
 * still the same, so a changed page without new snapshots fails.
 *
 * The pages are served by request interception under a fixed origin, so no request leaves the
 * browser and the addresses in the snapshots do not depend on a port.
 */

export const FIXTURE_ORIGIN = 'https://fixtures.example';
export const FIXTURES_ROOT = resolve(import.meta.dirname, '../../fixtures');

export const FIXTURE_SETS = [
  { name: 'impressum', pages: 'impressum/pages', snapshots: 'impressum/snapshots' },
  { name: 'legal-links', pages: 'legal-links', snapshots: 'legal-links/snapshots' },
] as const;

export interface FixtureSnapshot {
  /** The page file, relative to `scanner/fixtures/`. */
  source: string;
  /** SHA-256 of the page file the snapshot was taken from. */
  sha256: string;
  url: string;
  title: string;
  lang: string | null;
  text: string;
  links: PageLink[];
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function fixturePages(set: (typeof FIXTURE_SETS)[number]): Promise<string[]> {
  return (await readdir(resolve(FIXTURES_ROOT, set.pages))).filter((f) => f.endsWith('.html')).sort();
}

/** Opens every page of a set in one context and returns its snapshot, by file name without `.html`. */
export async function takeFixtureSnapshots(browser: Browser, set: (typeof FIXTURE_SETS)[number]): Promise<Record<string, FixtureSnapshot>> {
  const context = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== FIXTURE_ORIGIN) return route.abort();
    try {
      const body = await readFile(resolve(FIXTURES_ROOT, `.${decodeURIComponent(url.pathname)}`));
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    } catch {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    }
  });
  const result: Record<string, FixtureSnapshot> = {};
  try {
    for (const file of await fixturePages(set)) {
      const source = `${set.pages}/${file}`;
      const html = await readFile(resolve(FIXTURES_ROOT, source), 'utf8');
      const page = await context.newPage();
      const url = `${FIXTURE_ORIGIN}/${source}`;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(150);
      const snapshot = (await page.evaluate(IMPRESSUM_SNAPSHOT_EXPRESSION)) as SnapshotResult;
      await page.close();
      result[file.replace(/\.html$/, '')] = { source, sha256: sha256(html), url, title: snapshot.title, lang: snapshot.lang, text: snapshot.text, links: snapshot.links };
    }
  } finally {
    await context.close();
  }
  return result;
}
