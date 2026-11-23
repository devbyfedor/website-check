import type { AxeCapture, AxeRuleId, AxeRuleResult } from '../src/a11y/types.ts';
import type { Capture } from '../src/capture/types.ts';
import { makeCapture } from './helpers.ts';

/** Synthetic data for the report tests: an invented shop on a `.example` domain, no real site. */

export const SHOP = 'https://www.roesterei-muster.example/';
export const SHOP_URL = 'https://www.roesterei-muster.example/';

function rule(violations: number, passes: number, incomplete = 0, html = '<p class="sub">Frisch geröstet</p>'): AxeRuleResult {
  const example = { target: ['main > p.sub'], html, contrast: null };
  return {
    violations,
    incomplete,
    passes,
    impact: violations > 0 ? 'serious' : null,
    examples: violations > 0 ? [example] : [],
    incompleteExamples: incomplete > 0 ? [example] : [],
  };
}

export function axeResult(overrides: Partial<Record<AxeRuleId, AxeRuleResult>> = {}): AxeCapture {
  const contrastExample = {
    target: ['header > p.claim'],
    html: '<p class="claim">Frisch geröstet in Musterhausen</p>',
    contrast: { ratio: 2.9, expected: '4.5:1', fgColor: '#9aa5b1', bgColor: '#ffffff', fontSize: '12.0pt (16px)', fontWeight: 'normal', messageKey: null },
  };
  return {
    status: 'ok',
    error: null,
    axeVersion: '4.14.1',
    rules: {
      'color-contrast': { violations: 14, incomplete: 0, passes: 120, impact: 'serious', examples: [contrastExample], incompleteExamples: [] },
      'image-alt': rule(5, 12, 0, '<img src="/bohnen.jpg">'),
      label: rule(0, 3),
      'link-name': rule(0, 40),
      'button-name': rule(0, 6),
      'html-has-lang': rule(0, 1),
      'html-lang-valid': rule(0, 1),
      ...overrides,
    },
    ruleErrors: [],
    scope: { frameset: false, frames: 0, largestFrameShare: 0 },
    lowestContrast: { violation: contrastExample.contrast, pass: null },
    timing: { injectMs: 40, runMs: 180, totalMs: 240 },
  };
}

const IMPRESSUM_TEXT = [
  'Impressum',
  'Angaben gemäß § 5 DDG',
  '',
  'Rösterei Muster GmbH',
  'Bohnenweg 12',
  '87654 Musterhausen',
  '',
  'E-Mail: kontakt@roesterei-muster.example',
  '',
  'Handelsregister: HRB 12345, Amtsgericht Beispielburg',
  '',
  'Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:',
  'DE123456789',
].join('\n');

/** A full capture of the invented shop: WordPress with WooCommerce, three findings, a hint, a consent tool. */
export function shopCapture(overrides: Partial<Capture> = {}): Capture {
  return makeCapture({
    requestedUrl: SHOP,
    finalUrl: SHOP,
    requests: [
      { url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0, endMs: 280 },
      { url: `${SHOP}wp-content/themes/kaffee/style.css`, resourceType: 'stylesheet', startMs: 300, endMs: 420 },
      { url: `${SHOP}wp-content/plugins/woocommerce/assets/js/frontend/woocommerce.min.js`, resourceType: 'script', startMs: 310, endMs: 700 },
      { url: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700', resourceType: 'stylesheet', startMs: 310, endMs: 420 },
      { url: 'https://fonts.gstatic.com/s/lato/v24/lato.woff2', resourceType: 'font', startMs: 440, endMs: 710, initiator: { type: 'parser', url: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700' } },
      { url: 'https://www.googletagmanager.com/gtag/js?id=G-TEST123', resourceType: 'script', startMs: 860, endMs: 1120 },
      { url: 'https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST123', resourceType: 'fetch', startMs: 1250, endMs: 1300, initiator: { type: 'script', url: 'https://www.googletagmanager.com/gtag/js?id=G-TEST123' } },
      { url: 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js', resourceType: 'script', startMs: 500, endMs: 640 },
      { url: 'https://app.usercentrics.eu/browser-ui/latest/loader.js', resourceType: 'script', startMs: 1180, endMs: 1390 },
      { url: 'https://widgets.kaffeeklatsch.example/embed.js', resourceType: 'script', startMs: 3400, endMs: 3600 },
      { url: `${SHOP}wp-content/uploads/hero.jpg`, resourceType: 'image', startMs: 3500, endMs: 3900 },
    ],
    consentBanner: { detected: true, toolId: 'usercentrics', method: 'selector', selector: '#usercentrics-root', visibleAtMs: 1400, toolsInDom: ['usercentrics'] },
    mainDocument: {
      status: 200,
      headers: { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'content-type': 'text/html; charset=utf-8' },
      redirectChain: [],
    },
    page: {
      url: SHOP,
      title: 'Rösterei Muster – Kaffee aus Musterhausen',
      lang: 'de',
      text: 'Rösterei Muster\nFrisch geröstet in Musterhausen\nShop Kontakt\nImpressum Datenschutz',
      textTruncated: false,
      links: [
        { href: `${SHOP}shop/`, text: 'Shop' },
        { href: `${SHOP}impressum/`, text: 'Impressum', footer: true },
        { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true },
      ],
      linksTruncated: false,
      securityMeta: { csp: null, referrer: null },
      platform: { generators: ['WordPress 6.9', 'WooCommerce 10.3.0'], globals: ['wc_add_to_cart_params'], selectors: [] },
    },
    axe: axeResult(),
    httpProbe: { url: 'http://www.roesterei-muster.example/', startedAt: '2026-11-20T12:00:00.000Z', outcome: 'redirects-to-https', hops: [], httpsTarget: SHOP, durationMs: 120 },
    impressum: {
      url: `${SHOP}impressum/`,
      ok: true,
      failure: null,
      finalUrl: `${SHOP}impressum/`,
      status: 200,
      page: { url: `${SHOP}impressum/`, title: 'Impressum', lang: 'de', text: IMPRESSUM_TEXT, textTruncated: false, links: [], linksTruncated: false },
      requestCount: 12,
      timings: { openedAtMs: 4300, domContentLoadedMs: 300, snapshotMs: 900, totalMs: 1100, stopReason: 'text-stable' },
    },
    timings: { domContentLoadedMs: 600, loadMs: 1500, networkQuietMs: 3900, endMs: 4200, stopReason: 'network-quiet' },
    ...overrides,
  });
}
