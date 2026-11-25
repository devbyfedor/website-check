import { buildReport, DEFAULT_RULES, RULES_FILE, SCANNER_VERSION, type Capture, type Report } from '@website-check/scanner';
import type { ReportPageState } from '../../lib/report-page';
import { axe, capture, DOCUMENT, failed, ID, LEGAL_LINKS, page, report, REPORTS, SHOP, type RequestInput } from '../scan/example-states.ts';

// The states of the report that the design does not show (session B3 part 2), as example pages for looking at them at
// both widths (`npm run preview:examples`, /bericht/beispiel/<state>). Every report is built by the scanner's own
// `buildReport` from a capture of the invented shop of the reference (roesterei-muster.de, web/components/scan/
// example-states.ts), so the pages show what the real code makes of such a report. The states of the page itself
// (not ready, not found, our error, …) are the real page's view of a fixed state. Built only with WC_EXAMPLES=1; a
// production build that contains this data fails (web/scripts/next.ts).

const BANNER = (visibleAtMs: number): Capture['consentBanner'] => ({ detected: true, toolId: 'borlabs-cookie', method: 'selector', selector: '#BorlabsCookieBox', visibleAtMs, toolsInDom: ['borlabs-cookie'] });

/** Every security header and the Impressum: a page with nothing to fix first (no third party, every image described). */
const ALL_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** The axe run of the examples, with the place of every example element removed (no "Feld", no mark). */
function axeWithoutFields(violations: { contrast?: number; alt?: number }) {
  const run = axe(violations);
  for (const rule of Object.values(run.rules)) for (const e of rule.examples) (e as { field: string | null }).field = null;
  return run;
}

const own = (path: string, resourceType: string, startMs: number, endMs: number): RequestInput => ({ url: `${SHOP}${path}`, resourceType, startMs, endMs, initiator: { type: 'parser', url: SHOP } });

/** 85 requests to hosts no rule names: more services (80) and findings (60) than a report lists. */
const MANY_HOSTS: RequestInput[] = Array.from({ length: 85 }, (_, i) => ({ url: `https://cdn-${String(i + 1).padStart(2, '0')}.beispiel-anbieter-${i + 1}.example/lib.js`, resourceType: 'script', startMs: 300 + i * 30, endMs: 340 + i * 30 }));

/** Session B3 part 2: a domain with letters of Latin Extended-A (kawa-łódź-muster.de), shown decoded in the latin-ext subset. */
const EXT_SITE = 'https://xn--kawa-d-muster-flb89ixza.de/';
function extReport(): Report {
  const base = capture([{ ...DOCUMENT, url: EXT_SITE }]);
  const c = { ...base, requestedUrl: EXT_SITE, finalUrl: EXT_SITE, page: base.page === null ? null : { ...base.page, url: EXT_SITE } } as Capture;
  return buildReport({ id: ID, createdAt: '2026-11-24T13:02:38.000Z', siteUrl: EXT_SITE, mode: 'full', capture: c, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated, visit: { country: 'DE', colo: 'FRA' } }).report;
}

const STATE_REPORTS = {
  quick: REPORTS.schnellpruefung,
  blocked: REPORTS.blockiert,
  blockedQuick: () =>
    report(
      capture([{ ...DOCUMENT, status: 429 }], {
        adapter: 'quick-fetch',
        ok: false,
        failure: { reason: 'blocked', message: 'HTTP 429', status: 429 },
        page: page([], 'Too many requests'),
        axe: null,
        impressum: undefined,
        mainDocument: { status: 429, headers: { 'content-type': 'text/html' }, redirectChain: [] },
        timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs: 300, stopReason: 'fetched' },
      } as Partial<Capture>),
      'quick',
    ),
  timeout: REPORTS.zeitlimit,
  unreachable: () => report(failed('unreachable', 'net::ERR_CONNECTION_REFUSED')),
  httpError: REPORTS.serverfehler,
  invalidAddress: () => report(failed('invalid-address', 'net::ERR_NAME_NOT_RESOLVED')),
  pageLimit: REPORTS.seitenlimit,
  notHtml: REPORTS.keineWebseite,
  other: () => report(failed('other', 'Target closed')),
  notAllowed: REPORTS.nichtErlaubt,
  almostEmpty: REPORTS.fastLeer,
  /** The country of the visit: a browser in the Netherlands. */
  country: () => ({ ...REPORTS.ohneFunde(), visit: { ...REPORTS.ohneFunde().visit, country: 'NL', colo: 'AMS' } }) as Report,
  /** A page without images: "keine Bilder". */
  noImages: () => {
    const run = axe();
    run.rules['image-alt'] = { ...run.rules['image-alt'], passes: 0 };
    run.images = { described: 0, decorative: 0 };
    return report(capture([DOCUMENT], { axe: run }));
  },
  /** Rows "bitte manuell prüfen" and "nicht geprüft" (the Impressum a section of the homepage, no contrast measured), one priority. */
  manual: REPORTS.impressumAufStartseite,
  /** Two priorities, no banner, a public CDN (a hint). */
  two: REPORTS.ohneFunde,
  /** No priority at all, system unknown: every header, no third party, every image described, the banner seen at 1.2 s. */
  none: () =>
    report(
      capture([DOCUMENT, own('assets/site.css', 'stylesheet', 300, 420), own('assets/site.js', 'script', 320, 560)], {
        mainDocument: { status: 200, headers: ALL_HEADERS, redirectChain: [] },
        page: { ...page(LEGAL_LINKS), platform: { generators: [], globals: [], selectors: [] } },
        consentBanner: BANNER(1200),
      }),
    ),
  /** Three priorities without a field: no "Feld" caption, no mark on the plan. */
  withoutFields: () =>
    report(
      capture(
        [
          DOCUMENT,
          { url: 'https://www.googletagmanager.com/gtag/js?id=G-MUSTER123', resourceType: 'script', startMs: 400, endMs: 620, initiator: { type: 'script', url: `${SHOP}wp-content/plugins/tag/loader.js` } },
          own('wp-content/plugins/tag/loader.js', 'script', 320, 380),
        ],
        { axe: axeWithoutFields({ alt: 3 }), consentBanner: BANNER(1400) },
      ),
    ),
  /** The banner after the three seconds of the Zeitschnitt. */
  bannerLater: () =>
    report(capture([DOCUMENT, { url: 'https://fonts.googleapis.com/css2?family=Lato', resourceType: 'stylesheet', startMs: 300, endMs: 420, initiator: { type: 'parser', url: SHOP } }], { consentBanner: BANNER(4200) })),
  /** The banner seen, but no request to a third party in the window. */
  noThirdParty: () => report(capture([DOCUMENT, own('wp-content/themes/roesterei/style.css', 'stylesheet', 300, 520), own('wp-content/themes/roesterei/theme.js', 'script', 330, 640)], { consentBanner: BANNER(900) })),
  /**
   * Session B4 part 2: the Stückliste with every tag of "Einwilligung": Google Fonts before consent ("fehlt", with the
   * country), the Meta Pixel in a document the capture does not know ("bitte manuell prüfen"), Hotjar without an answer
   * ("keine Antwort"), jsDelivr and an unknown service with a long name ("Graubereich"), the consent tool ("nicht nötig").
   */
  serviceTags: () =>
    report(
      capture(
        [
          DOCUMENT,
          { url: 'https://consent.cookiebot.com/uc.js', resourceType: 'script', startMs: 120, endMs: 260, initiator: { type: 'parser', url: SHOP } },
          { url: 'https://fonts.googleapis.com/css2?family=Lato', resourceType: 'stylesheet', startMs: 300, endMs: 420, initiator: { type: 'parser', url: SHOP } },
          { url: 'https://fonts.gstatic.com/s/lato/v24/lato.woff2', resourceType: 'font', startMs: 440, endMs: 700, initiator: { type: 'parser', url: 'https://fonts.googleapis.com/css2?family=Lato' } },
          { url: 'https://connect.facebook.net/signals/config/1234567890?v=2.9', resourceType: 'script', startMs: 900, endMs: 1100, frameKnown: false },
          { url: 'https://static.hotjar.com/c/hotjar-1234567.js?sv=6', resourceType: 'script', startMs: 950, endMs: null, status: null, failure: 'net::ERR_CONNECTION_REFUSED' },
          { url: 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js', resourceType: 'script', startMs: 1000, endMs: 1150 },
          { url: 'https://static.ein-sehr-langer-name-eines-unbekannten-anbieters-fuer-widgets.example/widget.js', resourceType: 'script', startMs: 1200, endMs: 1400 },
        ],
        { consentBanner: { ...BANNER(1400), toolId: 'cookiebot', selector: '#CybotCookiebotDialog', toolsInDom: ['cookiebot'] } },
      ),
    ),
  /** Session B4 part 2: finding details with the general steps only, no system tabs (contrast and images). */
  generalSteps: () => report(capture([DOCUMENT], { mainDocument: { status: 200, headers: ALL_HEADERS, redirectChain: [] }, axe: axe({ contrast: 14, alt: 3 }) })),
  /**
   * Session B4 part 2: finding details without a fix text yet. Since session texts-fix every finding of our scanner has
   * a text, so the two third-party findings (Google Analytics, the Meta Pixel) carry text ids the page does not know, as
   * a report of a newer scanner would; the card of the security headers keeps its texts.
   */
  noFixText: () => {
    const r = report(
      capture([
        DOCUMENT,
        { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-MUSTER123', resourceType: 'fetch', startMs: 700, endMs: 760 },
        { url: 'https://connect.facebook.net/signals/config/1234567890?v=2.9', resourceType: 'script', startMs: 800, endMs: 950 },
      ]),
    );
    for (const f of r.findings) {
      if (f.area !== 'privacy' || f.kind !== 'finding') continue;
      f.textId = 'neu-dienst' as unknown as Report['findings'][number]['textId'];
      f.fixTextId = 'neu-anleitung';
    }
    return r;
  },
  /** Lists and texts read only in part: 85 unknown services, the page text and links cut, the page still loading after 15 s. */
  truncated: () =>
    report(
      capture([DOCUMENT, ...MANY_HOSTS], {
        page: { ...page(LEGAL_LINKS), textTruncated: true, linksTruncated: true },
        timings: { domContentLoadedMs: 600, loadMs: null, networkQuietMs: null, endMs: 15_000, stopReason: 'max-wait' },
      }),
    ),
};

export interface ExampleReportState {
  slug: string;
  /** For the list of addresses in the report to Fedor. */
  what: string;
  /** A report (the report page), or a state of the page without a report. */
  show: () => { report: Report } | { page: Exclude<ReportPageState, { kind: 'report' }> };
}

const r = (make: () => Report) => () => ({ report: make() });
const p = (state: Exclude<ReportPageState, { kind: 'report' }>) => () => ({ page: state });

/** The states of the report page, each at /bericht/beispiel/<slug>. */
export const EXAMPLE_REPORT_STATES: readonly ExampleReportState[] = [
  { slug: 'schnellpruefung', what: 'Schnellprüfung ohne Browser', show: r(STATE_REPORTS.quick) },
  { slug: 'blockiert', what: 'Prüfung blockiert (HTTP 403)', show: r(STATE_REPORTS.blocked) },
  { slug: 'blockiert-schnellpruefung', what: 'Schnellprüfung blockiert (HTTP 429)', show: r(STATE_REPORTS.blockedQuick) },
  { slug: 'zeitlimit', what: 'nicht geladen: keine Antwort in der Zeit', show: r(STATE_REPORTS.timeout) },
  { slug: 'nicht-erreichbar', what: 'nicht geladen: Server nicht erreichbar', show: r(STATE_REPORTS.unreachable) },
  { slug: 'serverfehler', what: 'nicht geladen: HTTP 500', show: r(STATE_REPORTS.httpError) },
  { slug: 'keine-website', what: 'nicht geladen: keine Website unter der Adresse', show: r(STATE_REPORTS.invalidAddress) },
  { slug: 'seitenlimit', what: 'nicht geladen: mehr als 2 000 Anfragen', show: r(STATE_REPORTS.pageLimit) },
  { slug: 'keine-webseite', what: 'nicht geladen: eine Datei statt einer Webseite', show: r(STATE_REPORTS.notHtml) },
  { slug: 'pruefungsfehler', what: 'nicht geladen: ein anderer Fehler der Prüfung', show: r(STATE_REPORTS.other) },
  { slug: 'nicht-erlaubt', what: 'Adresse nicht geprüft: mehr als 5 Weiterleitungen', show: r(STATE_REPORTS.notAllowed) },
  { slug: 'fast-leer', what: 'die Seite zeigte fast nichts: nur manuell prüfen', show: r(STATE_REPORTS.almostEmpty) },
  { slug: 'land', what: 'Land des Besuchs in der Kopfzeile: Niederlande', show: r(STATE_REPORTS.country) },
  { slug: 'keine-bilder', what: 'Prüfmaße: keine Bilder auf der Seite', show: r(STATE_REPORTS.noImages) },
  { slug: 'manuell', what: 'Prüfmaße: bitte manuell prüfen, nicht geprüft, nicht ermittelt; ein vorrangiger Punkt', show: r(STATE_REPORTS.manual) },
  { slug: 'zwei-punkte', what: 'zwei vorrangige Punkte, kein Banner, ein öffentliches CDN', show: r(STATE_REPORTS.two) },
  { slug: 'ohne-vorrang', what: 'kein vorrangiger Punkt, System unbekannt', show: r(STATE_REPORTS.none) },
  { slug: 'ohne-felder', what: 'drei vorrangige Punkte ohne Feld: keine Marke auf dem Plan', show: r(STATE_REPORTS.withoutFields) },
  { slug: 'banner-spaeter', what: 'Zeitschnitt: Banner erst nach 4,2 s', show: r(STATE_REPORTS.bannerLater) },
  { slug: 'ohne-fremde-server', what: 'Zeitschnitt: keine Anfrage an fremde Server', show: r(STATE_REPORTS.noThirdParty) },
  { slug: 'buchstaben', what: 'Domain mit polnischen Buchstaben: Barlow latin-ext wird nur hier geladen', show: r(extReport) },
  { slug: 'gekuerzt', what: 'gekürzte Listen und Texte, Seite lud nach 15 s noch; Stückliste mit 80 von 85 Diensten', show: r(STATE_REPORTS.truncated) },
  { slug: 'dienste-markierungen', what: 'Stückliste: fehlt, bitte manuell prüfen, keine Antwort, Graubereich, nicht nötig; ein langer Name', show: r(STATE_REPORTS.serviceTags) },
  { slug: 'fund-ohne-systeme', what: 'Fund-Details nur mit allgemeinen Schritten, ohne Systemreiter', show: r(STATE_REPORTS.generalSteps) },
  { slug: 'fund-ohne-anleitung', what: 'Fund-Details ohne Anleitung: Text-ids, die die Seite noch nicht kennt (wie von einer neueren Prüfung), Land des Aufrufs', show: r(STATE_REPORTS.noFixText) },
  { slug: 'laedt', what: 'Seite: der Bericht wird geladen', show: p({ kind: 'loading' }) },
  { slug: 'nicht-fertig', what: 'Seite: Bericht noch nicht fertig (Prüfung läuft)', show: p({ kind: 'not-ready', id: ID, displayHost: 'roesterei-muster.de' }) },
  { slug: 'abgebrochen', what: 'Seite: Prüfung abgebrochen, kein Bericht', show: p({ kind: 'ended', reason: 'cancelled', displayHost: 'roesterei-muster.de' }) },
  { slug: 'ausgelastet', what: 'Seite: Prüfung konnte am Tageslimit nicht beginnen', show: p({ kind: 'ended', reason: 'daily-limit', displayHost: 'roesterei-muster.de' }) },
  { slug: 'fehlgeschlagen', what: 'Seite: Prüfung bei uns fehlgeschlagen', show: p({ kind: 'ended', reason: 'other', displayHost: 'roesterei-muster.de' }) },
  { slug: 'nicht-gefunden', what: 'Seite: unbekannter Bericht', show: p({ kind: 'not-found' }) },
  { slug: 'fehler', what: 'Seite: unser Fehler (keine Antwort), Neu laden', show: p({ kind: 'error' }) },
];
