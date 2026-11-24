import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PageLink } from '../src/capture/types.ts';
import { extractImpressumFields } from '../src/legal/fields.ts';
import { chooseImpressumTarget, findLegalLinks, findLink } from '../src/legal/links.ts';
import { SCANNER_ROOT } from './helpers.ts';

/**
 * Session A4: the synthetic fixture pages (`scanner/fixtures/impressum/pages/`, at least 20 Impressum
 * pages with invented firms, and `scanner/fixtures/legal-links/`, homepages for finding the links),
 * through the analyzers without a browser. Their text and links come from the snapshots that Chromium
 * took (`npm run fixtures:snapshots`); the integration test checks that the snapshots still match the pages.
 * The expected values were written by one helper and confirmed by a second helper who extracted
 * every field from the pages without seeing them.
 */

const FIXTURES = resolve(SCANNER_ROOT, 'fixtures');

interface Snapshot {
  source: string;
  sha256: string;
  url: string;
  text: string;
  links: PageLink[];
}

interface ImpressumExpected {
  description: string;
  address: { street: string; postcode: string; town: string } | null;
  email: { value: string; form: string } | null;
  handelsregister: { register: string; number: string; court: string | null } | null;
  ustId: string | null;
  accessibilityStatement: string | null;
}

interface LinksExpected {
  description: string;
  impressum: string | null;
  datenschutz: string | null;
  accessibilityStatement: string | null;
}

function load<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, path), 'utf8')) as T;
}

const impressum = load<{ cases: Record<string, ImpressumExpected> }>('impressum/expected.json').cases;
const links = load<{ cases: Record<string, LinksExpected> }>('legal-links/expected.json').cases;
const snapshot = (dir: string, name: string): Snapshot => load<Snapshot>(`${dir}/snapshots/${name}.json`);
const absolute = (href: string | null, base: string): string | null => (href === null ? null : new URL(href, base).href);

describe('fixture manifest', () => {
  it.each([
    ['impressum', 'impressum/pages', impressum],
    ['legal-links', 'legal-links', links],
  ] as const)('%s: every page has an expected case and a snapshot of the current file, and nothing else', (dir, pages, cases) => {
    const files = readdirSync(resolve(FIXTURES, pages)).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
    expect(Object.keys(cases).sort()).toEqual(files);
    const snapshots = readdirSync(resolve(FIXTURES, dir, 'snapshots')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(snapshots).toEqual(files);
    for (const name of files) {
      const html = readFileSync(resolve(FIXTURES, pages, `${name}.html`), 'utf8');
      expect(snapshot(dir, name).sha256, `${name}: run npm run fixtures:snapshots`).toBe(createHash('sha256').update(html, 'utf8').digest('hex'));
    }
  });

  it('has at least 20 Impressum pages and invented .example domains only', () => {
    expect(Object.keys(impressum).length).toBeGreaterThanOrEqual(20);
    for (const dir of ['impressum/pages', 'legal-links']) {
      for (const file of readdirSync(resolve(FIXTURES, dir)).filter((f) => f.endsWith('.html'))) {
        const html = readFileSync(resolve(FIXTURES, dir, file), 'utf8');
        const hosts = [...html.matchAll(/(?:https?:\/\/|@)([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => (m[1] ?? '').toLowerCase());
        for (const host of hosts) expect(host, `${file}: ${host}`).toMatch(/(?:^|\.)example$|^www\.w3\.org$/);
      }
    }
  });
});

describe('Impressum fields on the fixture pages', () => {
  it.each(Object.entries(impressum))('%s', (name, expected) => {
    const snap = snapshot('impressum', name);
    // Session fix-a3 (review finding 71): a mailto link whose text is not the address itself counts only on
    // the site's own domain. The fixture pages are served from one host; the firm of this page owns this domain.
    const own = new Set(name === '07-mailto-linktext' ? ['tintenfabel.example'] : []);
    const fields = extractImpressumFields(snap.text, snap.links, own);
    const quoteOk = (field: { status: string; quote?: string; source?: string; value?: unknown }): void => {
      if (field.status !== 'found') return;
      if (field.source === 'text') expect(snap.text.includes(field.quote ?? '\u0000'), `quote ${JSON.stringify(field.quote)}`).toBe(true);
      // Session fix-a6 (review finding 52): the quote of a link is the e-mail address it names, not the link.
      else {
        expect(field.quote).toBe((field.value as { value: string }).value);
        expect(snap.links.some((l) => /^mailto:|\/cdn-cgi\/l\/email-protection#/i.test(l.href))).toBe(true);
      }
    };
    for (const field of Object.values(fields)) quoteOk(field);
    expect(fields.address.status === 'found' ? fields.address.value : null, 'address').toEqual(expected.address);
    expect(fields.email.status === 'found' ? fields.email.value : null, 'email').toEqual(expected.email);
    expect(fields.handelsregister.status === 'found' ? fields.handelsregister.value : null, 'handelsregister').toEqual(expected.handelsregister);
    expect(fields.ustId.status === 'found' ? fields.ustId.value : null, 'ustId').toBe(expected.ustId);
    expect(findLink('accessibilityStatement', snap.links, snap.url)?.href ?? null, 'accessibility statement').toBe(absolute(expected.accessibilityStatement, snap.url));
  });

  it('every field that is not found says why: not on the page', () => {
    const snap = snapshot('impressum', '30-fast-leer');
    const fields = extractImpressumFields(snap.text, snap.links);
    for (const field of Object.values(fields)) expect(field).toEqual({ status: 'not-found', reason: 'not-on-page' });
  });
});

describe('legal links on the fixture homepages', () => {
  it.each(Object.entries(links))('%s', (name, expected) => {
    const snap = snapshot('legal-links', name);
    const found = findLegalLinks(snap.links, snap.url);
    expect(found.impressum?.href ?? null, 'impressum').toBe(absolute(expected.impressum, snap.url));
    expect(found.datenschutz?.href ?? null, 'datenschutz').toBe(absolute(expected.datenschutz, snap.url));
    expect(found.accessibilityStatement?.href ?? null, 'accessibility statement').toBe(absolute(expected.accessibilityStatement, snap.url));
  });

  it('decides what to do with the Impressum link: open, an anchor on the page, a PDF, or nothing', () => {
    const target = (name: string): string => {
      const snap = snapshot('legal-links', name);
      return chooseImpressumTarget(snap.links, snap.url).action;
    };
    expect(target('01-footer-deutsch')).toBe('open');
    expect(target('08-onepager-anker')).toBe('same-page');
    expect(target('11-impressum-als-pdf')).toBe('skip');
    expect(target('05-ohne-impressum-link')).toBe('none');
    expect(target('17-impressum-nur-javascript')).toBe('none');
  });

  it('keeps the footer links of a page with more links than the cap', () => {
    const snap = snapshot('legal-links', '14-viele-links-davor');
    expect(snap.links.length).toBeGreaterThan(1500);
    expect(snap.links.filter((l) => l.footer).length).toBeGreaterThan(0);
  });
});
