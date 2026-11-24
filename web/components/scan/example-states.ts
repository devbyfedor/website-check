import { buildReport, DEFAULT_RULES, RULES_FILE, SCANNER_VERSION, type Capture, type CapturedRequest, type Report } from '@website-check/scanner';
import type { FormProblem, ShownProblem } from '../../lib/form-view';
import type { LiveScanState } from '../../lib/scan-view';

// The states without design of session B2 part 3, as example pages for looking at them at both widths
// (`npm run preview:examples`): the scan screen at /pruefung/beispiel/<state> and the form at /beispiel/formular/<state>.
// Every report here is built by the scanner's own `buildReport` from a capture of the invented shop of the reference
// (roesterei-muster.de), so the pages show what the real code makes of such a report. Built only with WC_EXAMPLES=1;
// a production build that contains this data fails (web/scripts/next.ts).

const SHOP = 'https://roesterei-muster.de/';
const ID = 'beispielbeispielbeispielaa';
/** The moment of the examples, so the times in their texts do not change between builds (Tuesday, 24.11.2026, 14:03 in Berlin). */
export const EXAMPLE_NOW = Date.UTC(2026, 10, 24, 13, 3, 20);
export const EXAMPLE_TIME_ZONE = 'Europe/Berlin';

type RequestInput = Partial<CapturedRequest> & { url: string };

const IMPRESSUM_TEXT = [
  'Impressum',
  'Rösterei Muster GmbH',
  'Bohnenweg 12',
  '87654 Musterhausen',
  'E-Mail: kontakt@roesterei-muster.de',
  'Handelsregister: HRB 12345, Amtsgericht Musterhausen',
  'USt-IdNr.: DE123456789',
].join('\n');

const page = (links: { href: string; text: string; footer?: boolean }[], text = 'Rösterei Muster\nFrisch geröstet in Musterhausen\nShop Kontakt\nImpressum Datenschutz') => ({
  url: SHOP,
  title: 'Rösterei Muster',
  lang: 'de',
  text,
  textTruncated: false,
  links,
  linksTruncated: false,
  securityMeta: { csp: null, referrer: null },
  platform: { generators: ['WordPress 6.9'], globals: [], selectors: [] },
});

const LEGAL_LINKS = [
  { href: `${SHOP}impressum/`, text: 'Impressum', footer: true },
  { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true },
];

const axe = (violations: { contrast?: number; alt?: number } = {}) => {
  const rule = (n: number, html: string) => ({ violations: n, incomplete: 0, passes: 10, impact: n > 0 ? ('serious' as const) : null, examples: n > 0 ? [{ target: ['main p'], html, contrast: null, field: 'A2' }] : [], incompleteExamples: [] });
  return {
    status: 'ok' as const,
    error: null,
    axeVersion: '4.14.1',
    rules: {
      'color-contrast': rule(violations.contrast ?? 0, '<p class="sub">Frisch geröstet</p>'),
      'image-alt': rule(violations.alt ?? 0, '<img src="/bohnen.jpg">'),
      label: rule(0, ''),
      'link-name': rule(0, ''),
      'button-name': rule(0, ''),
      'html-has-lang': rule(0, ''),
      'html-lang-valid': rule(0, ''),
    },
    ruleErrors: [],
    images: { described: 4, decorative: 0 },
    scope: { frameset: false, frames: 0, largestFrameShare: 0 },
    lowestContrast: { violation: null, pass: null },
    timing: { injectMs: 40, runMs: 180, totalMs: 240 },
  };
};

function capture(requests: RequestInput[], over: Partial<Capture> = {}): Capture {
  return {
    schemaVersion: 1,
    adapter: 'playwright-local',
    environment: { browser: 'chromium example', userAgent: 'example', locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } },
    requestedUrl: SHOP,
    startedAt: '2026-11-24T13:02:40.000Z',
    ok: true,
    failure: null,
    finalUrl: SHOP,
    mainDocument: { status: 200, headers: { 'strict-transport-security': 'max-age=31536000', 'content-type': 'text/html; charset=utf-8' }, redirectChain: [] },
    page: page(LEGAL_LINKS),
    consentBanner: { detected: false, toolId: null, method: null, selector: null, visibleAtMs: null, toolsInDom: [] },
    axe: axe(),
    httpProbe: { url: 'http://roesterei-muster.de/', startedAt: '2026-11-24T13:02:40.000Z', outcome: 'redirects-to-https', hops: [], httpsTarget: SHOP, durationMs: 120 },
    impressum: {
      url: `${SHOP}impressum/`,
      ok: true,
      failure: null,
      finalUrl: `${SHOP}impressum/`,
      status: 200,
      page: { url: `${SHOP}impressum/`, title: 'Impressum', lang: 'de', text: IMPRESSUM_TEXT, textTruncated: false, links: [], linksTruncated: false },
      requestCount: 6,
      timings: { openedAtMs: 3300, domContentLoadedMs: 300, snapshotMs: 900, totalMs: 1100, stopReason: 'text-stable' },
    },
    timings: { domContentLoadedMs: 600, loadMs: 1500, networkQuietMs: 2900, endMs: 3200, stopReason: 'network-quiet' },
    ...over,
    requests: requests.map((r, i) => ({
      seq: i,
      method: 'GET',
      resourceType: 'other',
      startMs: i * 40,
      endMs: i * 40 + 30,
      status: 200,
      failure: null,
      isMainFrame: true,
      frameUrls: [],
      isNavigation: false,
      initiator: null,
      redirectedFrom: null,
      ...r,
    })),
  } as Capture;
}

const DOCUMENT: RequestInput = { url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0, endMs: 280 };

/** A failed capture: nothing of the page, only the reason. */
const failed = (reason: NonNullable<Capture['failure']>['reason'], message: string, status?: number): Capture =>
  capture(status === undefined ? [] : [{ ...DOCUMENT, status }], {
    ok: false,
    failure: { reason, message, ...(status !== undefined ? { status } : {}) },
    finalUrl: status === undefined ? null : SHOP,
    page: null,
    axe: null,
    impressum: undefined,
    mainDocument: status === undefined ? null : { status, headers: { 'content-type': 'text/html' }, redirectChain: [] },
    timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs: 20_000, stopReason: 'error' },
  } as Partial<Capture>);

function report(c: Capture, mode: 'full' | 'quick' = 'full'): Report {
  return buildReport({ id: ID, createdAt: '2026-11-24T13:02:38.000Z', siteUrl: SHOP, mode, capture: c, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated, visit: { country: 'DE', colo: 'FRA' } }).report;
}

const REPORTS = {
  /** Two requests, one to a public CDN (a hint), no banner, no finding among the services; an image without text. */
  ohneFunde: () => report(capture([DOCUMENT, { url: 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js', resourceType: 'script', startMs: 300, endMs: 420 }], { axe: axe({ alt: 2 }) })),
  /** One request (the homepage), the Impressum is a section of the homepage (an anchor): one page asked for. */
  impressumAufStartseite: () =>
    report(
      capture([DOCUMENT], {
        page: page([{ href: `${SHOP}#impressum`, text: 'Impressum', footer: true }, { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }]),
        impressum: undefined,
      }),
    ),
  /** No link to an Impressum on the page; Google Fonts from the page's code. */
  ohneImpressum: () =>
    report(
      capture(
        [DOCUMENT, { url: 'https://fonts.googleapis.com/css2?family=Lato', resourceType: 'stylesheet', startMs: 300, endMs: 420, initiator: { type: 'parser', url: SHOP } }, { url: 'https://fonts.gstatic.com/s/lato/v24/lato.woff2', resourceType: 'font', startMs: 440, endMs: 700, initiator: { type: 'parser', url: 'https://fonts.googleapis.com/css2?family=Lato' } }],
        { page: page([{ href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }], 'Rösterei Muster\nFrisch geröstet\nDatenschutz'), impressum: undefined },
      ),
    ),
  schnellpruefung: () =>
    report(
      capture([{ ...DOCUMENT, resourceType: 'document' }], {
        adapter: 'quick-fetch',
        axe: null,
        consentBanner: { detected: false, toolId: null, method: null, selector: null, visibleAtMs: null, toolsInDom: [] },
        timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs: 400, stopReason: 'fetched' },
      } as Partial<Capture>),
      'quick',
    ),
  blockiert: () =>
    report(
      capture([{ ...DOCUMENT, status: 403 }], {
        ok: false,
        failure: { reason: 'blocked', message: 'HTTP 403', status: 403 },
        page: page([], 'Your request was blocked.'),
        axe: null,
        impressum: undefined,
        mainDocument: { status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare' }, redirectChain: [] },
      } as Partial<Capture>),
    ),
  zeitlimit: () => report(failed('timeout', 'page did not answer within 20 s')),
  serverfehler: () => report(failed('http-error', 'HTTP 500', 500)),
  seitenlimit: () => report(failed('page-limit', 'more than 2000 requests')),
  keineWebseite: () => report(failed('not-html', 'application/pdf', 200)),
  nichtErlaubt: () => report(failed('not-allowed', 'not allowed: too-many-redirects (more than 5 redirects)')),
  fastLeer: () =>
    report(
      capture([DOCUMENT, { url: 'https://www.googletagmanager.com/gtag/js?id=G-TEST123', resourceType: 'script', startMs: 300, endMs: 500 }], {
        page: page([], 'Einen Moment'),
        impressum: undefined,
      }),
    ),
};

export interface ExampleScanState {
  slug: string;
  /** For the list of addresses in the report to Fedor. */
  what: string;
  state: () => LiveScanState;
}

const base: LiveScanState = { id: ID, phase: 'loading', displayHost: 'roesterei-muster.de', queuePosition: null, runningSince: 0, report: null, reportShownAt: 0, timeZone: EXAMPLE_TIME_ZONE };
const done = (r: () => Report) => (): LiveScanState => ({ ...base, phase: 'done', report: r(), reportShownAt: 0 });
const ended = (reason: NonNullable<LiveScanState['ended']>, host: string | null = base.displayHost) => (): LiveScanState => ({ ...base, phase: 'error', ended: reason, endedAt: EXAMPLE_NOW, displayHost: host });

/** The states of the scan screen, each at /pruefung/beispiel/<slug>. */
export const EXAMPLE_SCAN_STATES: readonly ExampleScanState[] = [
  { slug: 'warteschlange', what: 'in der Warteschlange, Platz 2', state: () => ({ ...base, phase: 'queued', queuePosition: 2 }) },
  { slug: 'laeuft', what: 'die Messung läuft (Zeitleiste in echter Zeit)', state: () => ({ ...base, phase: 'running', runningSince: 6 }) },
  { slug: 'keine-verbindung', what: 'drei Statusabfragen ohne Antwort, die Seite fragt weiter', state: () => ({ ...base, phase: 'running', runningSince: 6, offline: true }) },
  { slug: 'ohne-funde', what: 'vollständig: 2 Anfragen, 1 an einen fremden Server (CDN, Hinweis), kein Banner, keine Funde bei fremden Diensten', state: done(REPORTS.ohneFunde) },
  { slug: 'impressum-auf-startseite', what: 'vollständig: 1 Anfrage, nur die Startseite, Impressum als Abschnitt der Startseite', state: done(REPORTS.impressumAufStartseite) },
  { slug: 'ohne-impressum', what: 'vollständig: kein Impressum-Link, Google Fonts aus dem Quelltext (Marke im Quelltext)', state: done(REPORTS.ohneImpressum) },
  { slug: 'schnellpruefung', what: 'Schnellprüfung ohne Browser (Tageslimit des Browsers erreicht)', state: done(REPORTS.schnellpruefung) },
  { slug: 'blockiert', what: 'Prüfung blockiert (HTTP 403)', state: done(REPORTS.blockiert) },
  { slug: 'zeitlimit', what: 'Prüfung abgebrochen: keine Antwort in der Zeit', state: done(REPORTS.zeitlimit) },
  { slug: 'serverfehler', what: 'Prüfung abgebrochen: HTTP 500', state: done(REPORTS.serverfehler) },
  { slug: 'seitenlimit', what: 'Prüfung abgebrochen: mehr als 2 000 Anfragen', state: done(REPORTS.seitenlimit) },
  { slug: 'keine-webseite', what: 'Prüfung abgebrochen: eine Datei statt einer Webseite', state: done(REPORTS.keineWebseite) },
  { slug: 'nicht-erlaubt', what: 'Adresse nicht geprüft: mehr als 5 Weiterleitungen', state: done(REPORTS.nichtErlaubt) },
  { slug: 'fast-leer', what: 'die Seite zeigte fast nichts: keine Funde, nur manuell prüfen', state: done(REPORTS.fastLeer) },
  { slug: 'abgebrochen', what: 'vom letzten Besucher aus der Warteschlange genommen, später per Link geöffnet', state: ended('cancelled') },
  { slug: 'ausgelastet', what: 'Tageslimit des Dienstes beim Start der Prüfung erreicht', state: ended('daily-limit') },
  { slug: 'fehler', what: 'unser Fehler', state: ended('other') },
  { slug: 'unbekannt', what: 'Link mit unbekannter Prüfung', state: ended('unknown', null) },
  { slug: 'bericht-unlesbar', what: 'der Bericht ließ sich dreimal nicht lesen', state: ended('unreadable') },
];

export interface ExampleFormState {
  slug: string;
  what: string;
  value: string;
  problem: ShownProblem;
}

const shown = (problem: FormProblem): ShownProblem => ({ problem, at: EXAMPLE_NOW });

/** The states of the form, each at /beispiel/formular/<slug>. */
export const EXAMPLE_FORM_STATES: readonly ExampleFormState[] = [
  { slug: 'leer', what: 'leeres Feld', value: '', problem: shown({ kind: 'empty' }) },
  { slug: 'ungueltig', what: '400 invalid-address', value: 'roesterei muster', problem: shown({ kind: 'invalid' }) },
  { slug: 'nicht-gefunden', what: '400 address-not-found', value: 'roesterei-muster.dee', problem: shown({ kind: 'not-found' }) },
  { slug: 'port', what: '400 address-not-allowed, Port', value: 'roesterei-muster.de:8080', problem: shown({ kind: 'not-allowed', reason: 'port' }) },
  { slug: 'nicht-oeffentlich', what: '400 address-not-allowed, keine öffentliche Adresse', value: 'roesterei-muster.local', problem: shown({ kind: 'not-allowed', reason: 'host-name' }) },
  { slug: 'stunde', what: '429 rate-limited, Stunde, Retry-After 1 260 s', value: 'roesterei-muster.de', problem: shown({ kind: 'rate', limit: 'hour', retryAfter: 1260 }) },
  { slug: 'tag', what: '429 rate-limited, Tag, Retry-After bis 00:00 UTC', value: 'roesterei-muster.de', problem: shown({ kind: 'rate', limit: 'day', retryAfter: 39_400 }) },
  { slug: 'starts', what: '429 rate-limited, Starts, Retry-After 600 s', value: 'roesterei-muster.de', problem: shown({ kind: 'rate', limit: 'starts', retryAfter: 600 }) },
  { slug: 'ausgelastet', what: '503 daily-limit, heute ausgelastet', value: 'roesterei-muster.de', problem: shown({ kind: 'busy', retryAfter: 39_400 }) },
  { slug: 'fehler', what: '503 queue-unavailable, Retry-After 60 s', value: 'roesterei-muster.de', problem: shown({ kind: 'ours', retryAfter: 60 }) },
  { slug: 'keine-antwort', what: 'keine Antwort des Servers', value: 'roesterei-muster.de', problem: shown({ kind: 'ours', retryAfter: null }) },
];
