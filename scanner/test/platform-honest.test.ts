import { describe, expect, it } from 'vitest';
import { analyzePlatform } from '../src/analyzers/platform.ts';
import type { PageSnapshot, PlatformHints } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { buildReport } from '../src/report/build.ts';
import { makeCapture, SITE, type RequestInput } from './helpers.ts';

/**
 * Session fix-a6, review finding 75: one strong signal with a generic name, one leftover file of an old system or a
 * request that failed does not name the system (and does not make the site a shop). Invented hosts only.
 */

function capture(input: { headers?: Record<string, string>; requests?: RequestInput[]; hints?: Partial<PlatformHints> }) {
  const page: PageSnapshot = {
    title: 'Start',
    lang: 'de',
    text: 'Willkommen bei der Beispiel GmbH. '.repeat(60),
    textTruncated: false,
    links: [
      { href: `${SITE}impressum`, text: 'Impressum', footer: true },
      { href: `${SITE}datenschutz`, text: 'Datenschutz', footer: true },
      { href: `${SITE}leistungen`, text: 'Leistungen' },
      { href: `${SITE}kontakt`, text: 'Kontakt' },
    ],
    linksTruncated: false,
    securityMeta: { csp: null, referrer: null },
    platform: { generators: [], globals: [], selectors: [], ...input.hints },
  };
  return makeCapture({
    requests: [{ url: SITE, resourceType: 'document', isNavigation: true }, ...(input.requests ?? [])],
    page,
    mainDocument: { status: 200, headers: { 'content-type': 'text/html', ...input.headers }, redirectChain: [] },
  });
}

const reportOf = (c: ReturnType<typeof capture>) =>
  buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SITE, mode: 'full', capture: c, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated }).report;

describe('finding 75: no system from a generic name, a leftover file or a failed request', () => {
  const cases: [string, Parameters<typeof capture>[0]][] = [
    ['a framework of its own with window.csrfConfig', { hints: { globals: ['csrfConfig'] } }],
    ['a page with window.salesChannelId', { hints: { globals: ['salesChannelId'] } }],
    ['a Symfony site with /bundles/storefront/app.js', { requests: [{ url: `${SITE}bundles/storefront/app.js`, resourceType: 'script' }] }],
    ['a request to its own wp-content that failed (404)', { requests: [{ url: `${SITE}wp-content/themes/alt/style.css`, resourceType: 'stylesheet', status: 404 }] }],
    ['one leftover image of an old WordPress theme', { requests: [{ url: `${SITE}wp-content/themes/old/img/logo.png`, resourceType: 'image' }] }],
    ['one file of a blog under /blog/', { requests: [{ url: `${SITE}blog/wp-includes/js/jquery/jquery.min.js`, resourceType: 'script' }] }],
    ['one Shopware 6 theme file and nothing else', { requests: [{ url: `${SITE}theme/0123456789abcdef0123456789abcdef/css/all.css`, resourceType: 'stylesheet' }] }],
  ];
  for (const [name, input] of cases) {
    it(`${name}: "unbekannt", no shop`, () => {
      expect(analyzePlatform(capture(input)).system).toBe('unknown');
      const report = reportOf(capture(input));
      expect(report.platform?.system).toBe('unknown');
      expect(report.platform?.shop).toBeNull();
      expect(report.findings.some((f) => f.textId === 'legal-accessibility-statement-not-found')).toBe(false);
    });
  }

  it('controls: a decisive signal alone, two strong signals, or two files of the system still name it', () => {
    expect(analyzePlatform(capture({ hints: { generators: ['WordPress 6.9'] } })).system).toBe('wordpress');
    expect(analyzePlatform(capture({ headers: { 'sw-invalidation-states': '' } })).system).toBe('shopware');
    expect(analyzePlatform(capture({ hints: { selectors: ['link#wp-block-library-css, style#wp-block-library-inline-css', 'style#global-styles-inline-css'] } })).system).toBe('wordpress');
    expect(analyzePlatform(capture({ requests: [{ url: `${SITE}wp-content/themes/x/style.css` }, { url: `${SITE}wp-includes/js/jquery/jquery.min.js` }] })).system).toBe('wordpress');
    // The same file twice is one piece of evidence.
    expect(analyzePlatform(capture({ requests: [{ url: `${SITE}wp-content/themes/x/style.css?ver=1` }, { url: `${SITE}wp-content/themes/x/style.css?ver=2` }] })).system).toBe('unknown');
  });
});
