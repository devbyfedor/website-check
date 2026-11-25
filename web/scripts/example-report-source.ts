// The example report of design/reference/bericht.html (web/components/report/example-report.json), the data of the report
// page's example (/bericht/beispiel, built only with WC_EXAMPLES=1). web/scripts/make-example-report.ts writes it; a unit
// test (web/test/report-view.test.tsx) checks that the file is what `exampleReportText` gives.
//
// The report is built by the scanner's own buildReport from a capture of the invented shop of the reference
// (roesterei-muster.de) with the numbers of the reference: the banner after 1.4 s, Google Fonts, the Google tag and
// Google Analytics before consent, 14 places of weak contrast down to 2.9 : 1, 12 of 17 images described, 2 of 5
// security headers, WordPress with WooCommerce, every Impressum field. Where the reference shows what schema v1 can
// hold but the builder does not make, the value is set below, each with its reason (docs/report-schema.md, "What is
// missing"). The result is checked with both validators (ours and Ajv) before it is written.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { buildReport, DEFAULT_RULES, REPORT_SCHEMA_V1, RULES_FILE, SCANNER_VERSION, validateReport, type Capture, type CapturedRequest, type Report } from '@website-check/scanner';

export const EXAMPLE_REPORT_FILE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'components', 'report', 'example-report.json');
const SHOP = 'https://roesterei-muster.de/';
const ID = 'beispielbeispielbeispielaa';

type RequestInput = Partial<CapturedRequest> & { url: string; startMs: number; endMs: number };
const own = (path: string, resourceType: string, startMs: number, endMs: number): RequestInput => ({ url: `${SHOP}${path}`, resourceType, startMs, endMs, initiator: { type: 'parser', url: SHOP } });
// `parser`: the tag stands in the source of `via` (the homepage, or the style sheet of Google Fonts); `script`: a script made it.
const third = (url: string, resourceType: string, startMs: number, endMs: number, via = SHOP, type: 'parser' | 'script' = 'script'): RequestInput => ({ url, resourceType, startMs, endMs, initiator: { type, url: via } });

// 17 requests, 9 of them to third parties (the numbers of the scan screen of pruefung.html). The bars of the
// Zeitschnitt: the homepage 0 to 279 ms, its files 300 to 1,050 ms, fonts.googleapis.com 309 to 420 ms,
// fonts.gstatic.com 441 to 711 ms, www.googletagmanager.com 861 to 1,122 ms; Google Analytics and jsDelivr start
// after the three seconds of the window. Session B3 part 2: the images load lazily, after the window, so the files of
// the site in the window are style sheets, a font and scripts: "Ihre Dateien: Design und Skripte", as the reference says
// (Fedor's answer 1: the words only when they are true). The link of Google Fonts and the Google tag stand in the source
// of the homepage ("Gefunden im Quelltext" of the reference), the requests of Google Analytics are made by the tag.
const REQUESTS: RequestInput[] = [
  { url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0, endMs: 279 },
  own('wp-content/themes/roesterei/style.css', 'stylesheet', 300, 520),
  third('https://fonts.googleapis.com/css2?family=Lato:wght@400;700', 'stylesheet', 309, 420, SHOP, 'parser'),
  own('wp-content/themes/roesterei/theme.js', 'script', 330, 640),
  third('https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHjx4wXg.woff2', 'font', 441, 711, 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700', 'parser'),
  own('wp-content/plugins/woocommerce/assets/js/frontend/cart-fragments.min.js', 'script', 360, 700),
  own('wp-content/uploads/2026/10/roestung.jpg', 'image', 3100, 3520),
  own('wp-content/uploads/2026/10/bohnen.jpg', 'image', 3120, 3480),
  third('https://www.googletagmanager.com/gtag/js?id=G-MUSTER123', 'script', 861, 1122, SHOP, 'parser'),
  own('wp-content/uploads/2026/10/kaffee.jpg', 'image', 3140, 3510),
  own('wp-content/themes/roesterei/fonts/icons.woff2', 'font', 600, 1050),
  third('https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css', 'stylesheet', 3050, 3180),
  third('https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js', 'script', 3060, 3260),
  third('https://cdn.jsdelivr.net/npm/glightbox@3/dist/js/glightbox.min.js', 'script', 3070, 3240),
  third('https://region1.google-analytics.com/g/collect?v=2&tid=G-MUSTER123&en=page_view', 'fetch', 3210, 3290, 'https://www.googletagmanager.com/gtag/js?id=G-MUSTER123'),
  third('https://region1.google-analytics.com/g/collect?v=2&tid=G-MUSTER123&en=scroll', 'fetch', 3400, 3460, 'https://www.googletagmanager.com/gtag/js?id=G-MUSTER123'),
  third('https://region1.google-analytics.com/g/collect?v=2&tid=G-MUSTER123&en=user_engagement', 'fetch', 3800, 3870, 'https://www.googletagmanager.com/gtag/js?id=G-MUSTER123'),
];

const IMPRESSUM_TEXT = [
  'Impressum',
  'Rösterei Muster GmbH',
  'Bohnenweg 12',
  '87654 Musterhausen',
  'E-Mail: kontakt@roesterei-muster.de',
  'Handelsregister: HRB 12345, Amtsgericht Musterhausen',
  'USt-IdNr.: DE123456789',
].join('\n');

const rule = (violations: number, examples: { target: string[]; html: string; contrast: unknown; field: string | null }[]) => ({
  violations,
  incomplete: 0,
  passes: 20,
  impact: violations > 0 ? ('serious' as const) : null,
  examples,
  incompleteExamples: [],
});
const contrast = (ratio: number) => ({ ratio, expected: '4.5:1', fgColor: '#9aa4b8', bgColor: '#ffffff', fontSize: '12.0pt (16px)', fontWeight: 'normal', messageKey: null });

const capture = {
  schemaVersion: 1,
  adapter: 'playwright-local',
  environment: { browser: 'chromium example', userAgent: 'example', locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } },
  requestedUrl: SHOP,
  // "Geprüft am 19. November 2026, 18:42 Uhr" in Berlin.
  startedAt: '2026-11-19T17:42:00.000Z',
  ok: true,
  failure: null,
  finalUrl: SHOP,
  mainDocument: {
    status: 200,
    // 2 of the 5 headers.
    headers: { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff' },
    redirectChain: [],
  },
  page: {
    url: SHOP,
    title: 'Rösterei Muster',
    lang: 'de',
    text: 'Rösterei Muster\nFrisch geröstet in Musterhausen\nShop Kaffee Zubehör Kontakt\nImpressum Datenschutz',
    textTruncated: false,
    links: [
      { href: `${SHOP}shop/`, text: 'Shop', footer: false },
      { href: `${SHOP}impressum/`, text: 'Impressum', footer: true },
      { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true },
    ],
    linksTruncated: false,
    securityMeta: { csp: null, referrer: null },
    platform: { generators: ['WordPress 6.9', 'WooCommerce 9.4'], globals: [], selectors: ['body.woocommerce-js'] },
  },
  consentBanner: { detected: true, toolId: 'borlabs-cookie', method: 'selector', selector: '#BorlabsCookieBox', visibleAtMs: 1400, toolsInDom: ['borlabs-cookie'] },
  axe: {
    status: 'ok',
    error: null,
    axeVersion: '4.14.1',
    rules: {
      'color-contrast': rule(14, [{ target: ['.hero .sub'], html: '<p class="sub">Frisch geröstet in Musterhausen</p>', contrast: contrast(2.9), field: 'A2' }]),
      // 12 of 17 images described: 12 pass, 5 without a text alternative.
      'image-alt': { ...rule(5, [{ target: ['.produkte img:nth-child(1)'], html: '<img src="/wp-content/uploads/2026/10/bohnen.jpg">', contrast: null, field: 'B3' }]), passes: 12 },
      label: rule(0, []),
      'link-name': rule(0, []),
      'button-name': rule(0, []),
      'html-has-lang': rule(0, []),
      'html-lang-valid': rule(0, []),
    },
    ruleErrors: [],
    images: { described: 12, decorative: 0 },
    scope: { frameset: false, frames: 0, largestFrameShare: 0 },
    lowestContrast: { violation: contrast(2.9), pass: null },
    timing: { injectMs: 40, runMs: 180, totalMs: 240 },
  },
  httpProbe: { url: 'http://roesterei-muster.de/', startedAt: '2026-11-19T17:42:09.000Z', outcome: 'redirects-to-https', hops: [], httpsTarget: SHOP, durationMs: 120 },
  impressum: {
    url: `${SHOP}impressum/`,
    ok: true,
    failure: null,
    finalUrl: `${SHOP}impressum/`,
    status: 200,
    page: { url: `${SHOP}impressum/`, title: 'Impressum', lang: 'de', text: IMPRESSUM_TEXT, textTruncated: false, links: [], linksTruncated: false },
    requestCount: 6,
    timings: { openedAtMs: 5100, domContentLoadedMs: 300, snapshotMs: 900, totalMs: 1100, stopReason: 'text-stable' },
  },
  timings: { domContentLoadedMs: 600, loadMs: 1500, networkQuietMs: 4400, endMs: 4900, stopReason: 'network-quiet' },
  requests: REQUESTS.map((r, i) => ({ seq: i, method: 'GET', status: 200, failure: null, isMainFrame: true, frameUrls: [], isNavigation: false, initiator: null, redirectedFrom: null, ...r })),
} as unknown as Capture;

/** The example report as the text of example-report.json; throws when either validator refuses it. */
export function exampleReportText(): string {
  const built = buildReport({
    id: ID,
    createdAt: '2026-11-19T17:41:58.000Z',
    siteUrl: SHOP,
    mode: 'full',
    capture,
    rules: DEFAULT_RULES,
    scannerVersion: SCANNER_VERSION,
    rulesUpdated: RULES_FILE.updated,
    // The reference names no country of the visit (its head is B3 part 2).
    visit: { country: null, colo: null },
  }).report;

  const report: Report = structuredClone(built);
  const finding = (id: string) => {
    const f = report.findings.find((x) => x.id === id);
    if (f === undefined) throw new Error(`the builder made no finding ${id}: ${report.findings.map((x) => x.id).join(', ')}`);
    return f;
  };

  // Set by hand, each a value schema v1 holds that the builder does not make (docs/report-schema.md, "What is missing"):
  // 1. "Feld B2" for Google Fonts: a stylesheet of the head has no box, so the builder gives null (gap 1).
  finding('third-party:google-fonts').field = 'B2';
  // 2. "Feld A3" for Google Analytics ("Quelltext am Seitenende"): requests of a script have no box, so null (gap 1).
  finding('third-party:google-analytics').field = 'A3';
  // 3. "Drei Dinge" of the reference: Google Fonts, Google Analytics, contrast. The builder takes the three findings with
  //    the highest risk in the order of the analysis, which would be Google Fonts, the Google tag and Google Analytics.
  report.priorities = ['third-party:google-fonts', 'third-party:google-analytics', 'a11y:color-contrast'];
  // 4. The row "Einwilligungstool, Ihr Server" of the Zeitschnitt (1,179 to 1,401 ms): the builder does not tell a
  //    consent tool on the site's own server from its other files (gap 4).
  if (report.timeline === null) throw new Error('no timeline');
  report.timeline.rows.push({ label: 'roesterei-muster.de', party: 'own', kind: 'consent-tool', serviceKey: null, provider: null, startMs: 1179, endMs: 1401, requestCount: 1, beforeBanner: true, fileTypes: null });

  const ours = validateReport(report);
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(REPORT_SCHEMA_V1 as object);
  if (ours.length > 0 || !ajv(report)) {
    throw new Error(`the example report is not valid: ours ${JSON.stringify(ours.slice(0, 5))}, Ajv ${JSON.stringify(ajv.errors?.slice(0, 5))}`);
  }

  return JSON.stringify(report, null, 2) + '\n';
}
