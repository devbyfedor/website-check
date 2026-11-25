// The real report page (`/bericht?id=…`, session B3 part 2) in a browser, with the API answered by this script, at
// 1440 and 390 px, from the production build (no example pages).
//
// Every state (the report states of web/components/report/example-report-states.ts, each a report of the scanner's own
// builder, and the states of the page itself: loading, not ready, ended, not found, our error):
// - with reduced motion: axe-core 0 violations (every rule on by default); the text contrast by pixels where axe could
//   not decide; Tab through every control with the focus ring measured as in B1 and whole in the window, in the order
//   of the reference (header, the actions of the head, the Prüfmaße, the BFSG link, "Drei Dinge", the Zeitschnitt,
//   footer; session B4 part 2: then the Stückliste box, the copy button, the system tabs and panels of the finding
//   details, the help button); 0 animations; every value on the page equal to the report (an independent reading of
//   the JSON, not the page's own view functions; since B4 part 2 also the Stückliste, the finding details, the help
//   block and the title block); at 390 px no text outside the window except inside a box that scrolls sideways, and no
//   sideways scrolling of the page; the system tabs by keyboard (WAI-ARIA tabs pattern); the actions (B4 part 2):
//   "Als PDF speichern" calls the print dialog, "Link kopieren" and the copy button of the Stückliste put the right text
//   on the clipboard, change their label and say it in a status region;
// - with the print media emulated (B4 part 2): no visible button but the selected tab, no header, navigation or footer,
//   a white page and no dark background, axe 0 and the contrast by pixels; a screenshot of each state;
// - with motion: every animation ends within 5 s;
// - the page is noindex and sends no Referer (meta elements); 0 requests to other hosts.
//
// With --reports <dir>: the report JSON files of that folder instead (the reports of saved captures, built again
// without a visit, local/ only): values, axe and the text at 390 px for each, at both widths.
//
//   npm run check:report                      builds web/ (production), then checks every state
//   node web/scripts/report-check.ts [--widths 1440,390] [--only <state,…>] [--reports <folder of report files>]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import type { Report } from '../../scanner/src/report/types.ts';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states.ts';
import { FIX_TEXTS, HEADER_STEPS } from '../lib/report-detail-texts.ts';
import { axe, contrastByPixels, keyboard, type AxeSummary } from './a11y.ts';
import { nextFrames, ROOT, VIEWPORT_HEIGHT, routeHosts, settle, startCheckServer } from './browser-setup.ts';

const RESULT_DIR = join(ROOT, 'local', 'report-check');
const AXE_FILE = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
const ID = 'checkreportpageabcdefghijk';
const LIMIT_MS = 5_000;
const DISCLAIMER = 'Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit.';

interface Answer {
  status: number;
  body: string;
}
/** What the mocked API answers: the report and the status; 'hang' never answers (the page stays loading). */
interface Api {
  report: Answer | 'hang';
  status: Answer;
}
const json = (status: number, value: unknown): Answer => ({ status, body: JSON.stringify(value) });
const scanBody = (status: 'queued' | 'running' | 'done' | 'error', errorReason: string | null = null) => ({
  id: ID,
  status,
  state: null,
  cached: false,
  displayHost: 'roesterei-muster.de',
  queuePosition: status === 'queued' ? 1 : null,
  createdAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  country: null,
  errorReason,
});

interface CheckState {
  name: string;
  api: Api;
  /** The report the page must show, or the heading of the page without a report. */
  report: Report | null;
  heading: string;
  timeout?: number;
}

const PAGE_HEADINGS: Record<string, string> = {
  loading: 'Der Bericht wird geladen.',
  'not-ready': 'Der Bericht ist noch nicht fertig.',
  cancelled: 'Zu dieser Prüfung gibt es keinen Bericht.',
  'daily-limit': 'Zu dieser Prüfung gibt es keinen Bericht.',
  other: 'Die Prüfung ist bei uns fehlgeschlagen.',
  'not-found': 'Diesen Bericht finden wir nicht.',
  error: 'Den Bericht können wir gerade nicht anzeigen.',
};

function exampleStates(): CheckState[] {
  const list: CheckState[] = [];
  for (const example of EXAMPLE_REPORT_STATES) {
    const shown = example.show();
    if ('report' in shown) {
      const report = { ...shown.report, id: ID } as Report;
      list.push({ name: example.slug, api: { report: json(200, report), status: json(200, scanBody('done')) }, report, heading: `Prüfbericht für${report.site.displayHost}` });
      continue;
    }
    const state = shown.page;
    switch (state.kind) {
      case 'loading':
        list.push({ name: example.slug, api: { report: 'hang', status: json(200, scanBody('running')) }, report: null, heading: PAGE_HEADINGS.loading! });
        break;
      case 'not-ready':
        list.push({ name: example.slug, api: { report: json(409, { error: 'not-ready', status: 'running' }), status: json(200, scanBody('running')) }, report: null, heading: PAGE_HEADINGS['not-ready']! });
        break;
      case 'ended':
        list.push({ name: example.slug, api: { report: json(409, { error: 'not-ready', status: 'error' }), status: json(200, scanBody('error', state.reason)) }, report: null, heading: PAGE_HEADINGS[state.reason]! });
        break;
      case 'not-found':
        list.push({ name: example.slug, api: { report: json(404, { error: 'not-found' }), status: json(404, { error: 'not-found' }) }, report: null, heading: PAGE_HEADINGS['not-found']! });
        break;
      case 'error':
        list.push({ name: example.slug, api: { report: json(503, { error: 'queue-unavailable' }), status: json(503, { error: 'queue-unavailable' }) }, report: null, heading: PAGE_HEADINGS.error!, timeout: 30_000 });
        break;
    }
  }
  // A report that fails the validator is our error too, never shown.
  list.push({ name: 'bericht-ungueltig', api: { report: { status: 200, body: '{"schemaVersion":1,"kaputt":true}' }, status: json(200, scanBody('done')) }, report: null, heading: PAGE_HEADINGS.error!, timeout: 30_000 });
  return list;
}

async function open(browser: Browser, origin: string, width: number, reduced: boolean, api: Api): Promise<{ page: Page; close: () => Promise<void>; blocked: string[] }> {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const blocked = await routeHosts(context, origin, 'none');
  // Session B4 part 2: the copy buttons are checked by reading the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const waiting: Route[] = [];
  await context.route(/\/api\/scans\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const answer = path === `/api/scans/${ID}/report` ? api.report : path === `/api/scans/${ID}` ? api.status : json(404, { error: 'not-found' });
    if (answer === 'hang') {
      waiting.push(route);
      return;
    }
    return route.fulfill({ status: answer.status, contentType: 'application/json; charset=utf-8', body: answer.body });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/bericht?id=${ID}`);
  return {
    page,
    blocked,
    close: async () => {
      for (const r of waiting) await r.abort().catch(() => undefined);
      await context.close();
    },
  };
}

async function reach(page: Page, heading: string, timeout = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction((h) => (document.querySelector('h1')?.textContent ?? '') === h || document.querySelector('main h2')?.textContent === h, heading, { timeout });
    await settle(page);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The values of the report, read from the JSON independently of the page's view functions (web/lib/report-view.ts).

const NAMES: Record<string, string> = {
  'third-party-before-consent': 'Fremde Dienste vor der Einwilligung',
  'impressum-fields': 'Pflichtangaben im Impressum',
  'lowest-contrast': 'Kleinster Textkontrast',
  'images-described': 'Bilder mit Beschreibung',
  'accessibility-statement': 'Erklärung zur Barrierefreiheit',
  https: 'Verschlüsselung',
  'security-headers': 'Sicherheits-Header',
};
const RESULTS: Record<string, string> = { pass: 'erfüllt', fail: 'nicht erfüllt', partial: 'teilweise', manual: 'bitte manuell prüfen', 'not-checked': 'nicht geprüft' };
const STATES: Record<string, string> = { present: 'vorhanden', found: 'vorhanden', uncertain: 'Link gefunden, bitte prüfen', 'not-found': 'nicht gefunden', https: 'HTTPS', http: 'HTTP', unknown: 'unbekannt' };
const SYSTEMS: Record<string, string> = { wordpress: 'WordPress', shopify: 'Shopify', shopware: 'Shopware', wix: 'Wix', jimdo: 'Jimdo' };
const AREAS: Record<string, string> = { privacy: 'Datenschutz', 'mandatory-information': 'Pflichtangaben', accessibility: 'Barrierefreiheit', security: 'Sicherheit' };
const RISKS: Record<string, string> = { high: 'hohes Risiko', medium: 'mittleres Risiko', low: 'niedriges Risiko' };
/** The accessibility titles with the number of places in them (the language of the page has none). */
const COUNTED = new Set(['a11y-color-contrast', 'a11y-image-alt', 'a11y-label', 'a11y-link-name', 'a11y-button-name']);
const comma = (n: number): string => String(n).replace('.', ',');

type Value = Report['measures'][number]['actual'];
function value(v: Value, m: Report['measures'][number], role: 'target' | 'actual'): string {
  if (v === null) return m.result === 'not-checked' ? 'nicht geprüft' : 'nicht ermittelt';
  if (v.type === 'count') return String(v.count);
  if (v.type === 'of') return role === 'actual' && m.id === 'images-described' && v.total === 0 ? 'keine Bilder' : `${v.count} von ${v.total}`;
  if (v.type === 'all') return 'alle';
  if (v.type === 'ratio') return role === 'target' ? `mind. ${comma(v.ratio)} : 1` : `${comma(Math.floor(Math.round(v.ratio * 1e9) / 1e8) / 10)} : 1`;
  return STATES[v.state] ?? '?';
}

function facts(r: Report): string[] {
  const out: string[] = [];
  if (r.scan.scannedAt !== null) {
    const at = new Date(r.scan.scannedAt);
    const date = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(at);
    const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(at);
    out.push(`Geprüft am|${date}, ${time} Uhr`);
  }
  let system = 'nicht geprüft';
  if (r.sections.platform.status === 'checked') {
    const p = r.platform;
    if (p === null || p.system === 'unknown') system = 'unbekannt';
    else {
      system = p.system === 'shopware' && p.shopwareVersion !== null ? `Shopware ${p.shopwareVersion}` : SYSTEMS[p.system]!;
      if (p.system === 'wordpress' && p.woocommerce) system += ' mit WooCommerce';
    }
  }
  out.push(`System|${system}`);
  out.push(`Geprüfte Seiten|${r.pages.homepage !== 'checked' ? 'keine' : r.pages.impressum === 'checked' ? 'Startseite und Impressum' : 'Startseite'}`);
  out.push('Revision|A, Erstprüfung');
  // A country only when it names one: not XX (Cloudflare's unknown), ZZ or a code without a German name.
  const country = r.visit.country === null || ['XX', 'ZZ'].includes(r.visit.country) ? undefined : new Intl.DisplayNames(['de'], { type: 'region', fallback: 'none' }).of(r.visit.country);
  // Session B4 part 1 (Fedor's answer 3): with a note on where the browser runs and how it is set.
  const eu = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'].includes(r.visit.country ?? '');
  const german = r.visit.locale === 'de-DE' && r.visit.timezone === 'Europe/Berlin';
  const note =
    r.visit.browser === null
      ? `Unsere Abfrage kam aus einem Rechenzentrum${eu ? ' in der EU' : ''}.`
      : `Unser Prüfbrowser läuft in einem Rechenzentrum${eu ? ' in der EU' : ''}${german ? ' und ist eingestellt wie ein Besucher aus Deutschland: deutsche Sprache, Zeitzone Berlin' : ''}.`;
  if (country !== undefined && country !== r.visit.country) out.push(`Aufgerufen aus|${country}|${note}`);
  return out;
}

const docOf = (href: string | null): string | null => {
  try {
    const u = new URL(href ?? '');
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
};

// Session B4 part 2: the lower part, read from the JSON as independently of the page as the upper part.
const CATEGORY: Record<string, string> = {
  fonts: 'Schriften',
  'tag-manager': 'lädt weitere Skripte',
  analytics: 'Statistik',
  'session-recording': 'Aufzeichnung von Besuchen',
  'marketing-automation': 'Marketing',
  advertising: 'Werbung',
  'social-pixel': 'Werbung in sozialen Netzwerken',
  maps: 'Karte',
  video: 'Video',
  'social-embed': 'Beiträge aus sozialen Netzwerken',
  chat: 'Chat',
  reviews: 'Bewertungen',
  booking: 'Terminbuchung',
  'widget-platform': 'Widgets',
  payment: 'Zahlung',
  captcha: 'Schutz vor Bots',
  'accessibility-overlay': 'Werkzeug für Barrierefreiheit',
  translation: 'Übersetzung',
  cdn: 'Skripte',
  platform: 'Dienst Ihres Systems',
  consent: 'Einwilligungstool',
  other: 'Weiteres',
  unknown: 'unbekannter Dienst',
};
const LOCATION: Record<string, string> = { 'us-possible': 'Server in den USA möglich', 'worldwide-cdn': 'weltweites Servernetz', eu: 'Server in der EU', unknown: 'nicht bekannt' };
const TAG: Record<string, string> = { missing: 'fehlt', 'grey-zone': 'Graubereich', 'not-needed': 'nicht nötig', 'not-reached': 'keine Antwort', manual: 'bitte manuell prüfen' };
const FIVE: Record<string, string> = { wordpress: 'WordPress', shopify: 'Shopify', wix: 'Wix', jimdo: 'Jimdo', shopware: 'Shopware' };
const shortDateOf = (iso: string): string => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(iso));
const strip = (v: string): string => v.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '');
/** The provider in the copied list (review of B4 part 2): left out when the name before its brackets is the provider. */
function namedBy(name: string, provider: string | null): string {
  if (provider === null || provider === '') return name;
  const m = /^(.*\S) \(([^()]+)\)$/.exec(name);
  if ((m === null ? name : m[1]!).toLowerCase() === provider.toLowerCase()) return name;
  return m === null ? `${name} (${provider})` : `${m[1]} (${m[2]}, ${provider})`;
}

function countryOf(r: Report): string | null {
  if (r.visit.country === null || ['XX', 'ZZ'].includes(r.visit.country)) return null;
  const name = new Intl.DisplayNames(['de'], { type: 'region', fallback: 'none' }).of(r.visit.country);
  return name === undefined || name === r.visit.country ? null : name;
}

interface ExpectedCard {
  id: string;
  field: string | null;
  country: string | null;
  /** Soll and Ist of a third party before consent: "0 Anfragen an Google", "2 Anfragen…". */
  ta: { target: string; actual: string } | null;
  source: string[];
  /** The system tabs: the name of the selected tab ("WordPress erkannt"), or null without tabs. */
  tab: string | null;
  /** The box says "noch keine Anleitung". */
  noFix: boolean;
  /** Session texts-fix: the number of steps of the card of the security headers (two plus one per header that does not count). */
  steps: number | null;
}
interface ExpectedLower {
  lower: boolean;
  servicesCount: string | null;
  services: string[];
  cards: ExpectedCard[];
  stamp: string[];
  copy: string | null;
}

function expectedLower(r: Report, measuredPage: boolean): ExpectedLower {
  const lower = r.pages.homepage === 'checked';
  const byId = new Map(r.findings.map((f) => [f.id, f]));
  const country = countryOf(r);
  const line = (f: Report['findings'][number] | undefined) => (f !== undefined && f.kind === 'finding' && f.beforeConsent && country !== null ? `Land des Aufrufs: ${country}` : null);
  const services = lower
    ? r.services.map((s) => {
        const c = line(s.findingId === null ? undefined : byId.get(s.findingId));
        return [s.position, s.name, CATEGORY[s.category], s.provider ?? 'unbekannt', LOCATION[s.dataLocation], `vor der Einwilligung${c === null ? '' : ` ${c}`}`, TAG[s.consent]].join('|');
      })
    : [];
  const total = r.truncated.services ? r.counts.services : r.services.length;
  const detected = r.sections.platform.status === 'checked' && r.platform !== null && r.platform.system in FIVE ? r.platform.system : null;
  const cards: ExpectedCard[] = [];
  if (lower && measuredPage) {
    r.priorities.slice(0, 3).forEach((id, i) => {
      const f = byId.get(id);
      if (f === undefined) return;
      const third = f.area === 'privacy' && f.serviceKey !== null && f.textId.startsWith('third-party-');
      const provider = typeof f.params.provider === 'string' ? f.params.provider : null;
      const count = typeof f.params.count === 'number' ? f.params.count : null;
      const ta = third && ['third-party-precedent', 'third-party-consent-required', 'third-party-usually-consent'].includes(f.textId) && f.beforeConsent && provider !== null && count !== null ? { target: `0 Anfragen an ${provider}`, actual: count === 1 ? '1 Anfrage' : `${count} Anfragen` } : null;
      const page = docOf(r.site.finalUrl);
      const source = third && page !== null ? [...new Set(f.evidence.filter((e) => e.type === 'request' && e.initiatorType === 'parser' && docOf(e.via) === page).map((e) => (e as { url: string }).url))] : [];
      // Session texts-fix: tabs where our texts have steps by system; general steps for every finding of our scanner that
      // can be a priority (the third-party classes by their class, the security headers by the headers of the report).
      const tabs = f.fixTextId !== null && Object.hasOwn(FIX_TEXTS, f.fixTextId);
      const general = [
        'third-party-precedent',
        'third-party-consent-required',
        'third-party-usually-consent',
        'a11y-color-contrast',
        'a11y-image-alt',
        'a11y-label',
        'a11y-link-name',
        'a11y-button-name',
        'a11y-html-has-lang',
        'a11y-html-lang-valid',
        'security-https-missing',
        'security-http-no-redirect',
        'security-headers',
        'legal-impressum-no-link',
      ].includes(f.textId);
      const headers = f.textId === 'security-headers' ? 2 + (r.security?.headers ?? []).filter((h) => !h.counts && h.textId !== null && Object.hasOwn(HEADER_STEPS, h.textId)).length : null;
      cards.push({ id: `fund-${i + 1}`, field: f.field === null ? null : `Feld ${f.field}`, country: line(f), ta, source, tab: tabs ? (detected === null ? 'WordPress' : `${FIVE[detected]} erkannt`) : null, noFix: !tabs && !general, steps: headers });
    });
  }
  const stamp = ['Benennung|Prüfbericht', `Objekt|${r.site.displayHost}`, `Datum|${shortDateOf(r.scan.scannedAt ?? r.createdAt)}`, `Revision|${r.revision.letter}`, 'Blatt|1 von 1', 'Geprüft|automatisch'];
  let copy: string | null = null;
  if (lower && r.services.length > 0) {
    const lines = [`Externe Dienste auf ${strip(r.site.displayHost)} (Prüfung vom ${shortDateOf(r.scan.scannedAt ?? r.createdAt)}):`];
    for (const s of r.services) {
      lines.push(`${s.position}. ${namedBy(strip(s.name), s.provider === null ? null : strip(s.provider))}, ${CATEGORY[s.category]}`);
    }
    const rest = r.truncated.services ? r.counts.services - r.services.length : 0;
    if (rest > 0) lines.push(rest === 1 ? '… und 1 weiterer Dienst, den der Bericht nicht einzeln aufführt.' : `… und ${rest} weitere Dienste, die der Bericht nicht einzeln aufführt.`);
    copy = lines.join('\n');
  }
  return { lower, servicesCount: lower && r.services.length > 0 ? (total === 1 ? '1 Dienst gefunden' : `${total} Dienste gefunden`) : null, services, cards, stamp, copy };
}

interface Expected {
  h1: string;
  facts: string[];
  measures: string[];
  priorities: { meta: string; field: string | null; count: number | null }[];
  marks: number;
  rows: { label: string; small: string }[];
  cut: string | null;
  note: boolean;
  lower: ExpectedLower;
}

const FILE_WORDS: [string, string[]][] = [
  ['Design', ['stylesheet', 'font']],
  ['Skripte', ['script']],
  ['Bilder', ['image']],
  ['Medien', ['media']],
  ['Daten', ['data']],
  ['Weiteres', ['other']],
];
const list = (w: string[]): string => (w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} und ${w.at(-1)}`);

function expected(r: Report): Expected {
  const measuredPage = r.pages.homepage === 'checked' && (r.state === 'complete' || r.state === 'quick') && r.notice?.textId !== 'report-page-almost-empty' && r.notice?.params.pageAlmostEmpty !== true;
  const byId = new Map(r.findings.map((f) => [f.id, f]));
  const prios = measuredPage ? r.priorities.slice(0, 3).map((id) => byId.get(id)).filter((f) => f !== undefined) : [];
  const places = new Set<string>();
  for (const f of prios) {
    if (f.id === 'a11y:page-language') places.add('source');
    else if (f.field !== null) {
      const place = ({ B2: 'heading', A2: 'subline', A3: 'source' } as Record<string, string>)[f.field];
      if (place !== undefined) places.add(place);
    } else if (f.area === 'privacy' && f.serviceKey !== null && f.evidence.some((e) => e.type === 'request' && e.initiatorType === 'parser' && docOf(e.via) === docOf(r.site.finalUrl) && docOf(e.via) !== null)) places.add('source');
  }
  // The Zeitschnitt only for a measured homepage (not for an almost empty page).
  const t = measuredPage ? r.timeline : null;
  const rows = (t?.rows ?? []).map((row) => {
    let small: string;
    if (row.party === 'own' && row.kind === 'document') small = 'Ihre Seite';
    else if (row.party === 'own' && row.kind === 'consent-tool') small = 'Ihr Server';
    else if (row.party === 'own') {
      const words = FILE_WORDS.filter(([, types]) => types.some((x) => (row.fileTypes ?? []).includes(x as never))).map(([w]) => w);
      small = words.length === 0 || (words.length === 1 && words[0] === 'Weiteres') ? 'Ihre Dateien' : `Ihre Dateien: ${list(words)}`;
    } else small = row.provider === null ? 'fremder Server' : `${row.provider}, fremder Server`;
    return { label: row.party === 'own' && row.kind === 'consent-tool' ? 'Einwilligungstool' : row.label, small };
  });
  const banner = t?.bannerVisibleAtMs ?? null;
  return {
    h1: `Prüfbericht für${r.site.displayHost}`,
    facts: facts(r),
    measures: r.measures.map((m) => [NAMES[m.id], value(m.target, m, 'target'), value(m.actual, m, 'actual'), RESULTS[m.result]].join('|')),
    priorities: prios.map((f) => ({ meta: f.risk === null ? AREAS[f.area]! : `${AREAS[f.area]}, ${RISKS[f.risk]}`, field: f.field, count: typeof f.params.count === 'number' && COUNTED.has(f.textId) ? f.params.count : null })),
    marks: places.size,
    rows,
    cut: t !== null && banner !== null && banner <= t.windowMs ? `Einwilligungsbanner erscheint nach ${comma(Math.round(banner / 100) / 10)} s` : null,
    note: r.state !== 'complete' || r.notice !== null || r.scan.stopReason === 'max-wait' || r.truncated.findings || r.truncated.services || r.truncated.page.length > 0,
    lower: expectedLower(r, measuredPage),
  };
}

/** Runs in the page: what it shows, in the shape of `Expected`. */
function shown() {
  const txt = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const h1 = document.querySelector('h1')?.textContent ?? '';
  const facts = Array.from(document.querySelectorAll('main dl > div')).map((d) => [txt(d.querySelector('dt')), ...Array.from(d.querySelectorAll('dd'), (dd) => txt(dd))].join('|'));
  // Session B4 part 2: the Prüfmaße and the priorities by their sections (the Stückliste and the steps have rows and items too).
  const measures = Array.from(document.querySelectorAll('main section:has(#pruefmasse) table tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td'), (td) => txt(td)).join('|'));
  const priorities = Array.from(document.querySelectorAll('main ol:has(a[href^="#fund-"]) > li')).map((li) => {
    const meta = li.querySelector('div > span');
    const field = meta?.querySelector('span');
    const metaText = Array.from(meta?.childNodes ?? []).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    return { title: txt(li.querySelector('a')), meta: metaText, field: field === null || field === undefined ? null : txt(field) };
  });
  const marks = document.querySelectorAll('main svg[role="img"] path[pathLength]').length;
  const rows = Array.from(document.querySelectorAll('main [class*="track"]')).map((track) => {
    const lab = track.parentElement?.querySelector('[class*="tlab"]');
    const small = lab?.querySelector('small');
    const all = txt(lab);
    const s = txt(small);
    return { label: all.endsWith(s) ? all.slice(0, all.length - s.length).trim() : all, small: s };
  });
  const main = txt(document.querySelector('main'));
  const cut = /Einwilligungsbanner erscheint nach [\d,]+ s(?!,)/.exec(main)?.[0] ?? null;
  const note = Array.from(document.querySelectorAll('main span')).some((s) => s.textContent === 'Hinweis');
  // The lower part (session B4 part 2).
  const servicesSection = document.querySelector('main section:has(#stueckliste)');
  const services = Array.from(servicesSection?.querySelectorAll('tbody tr') ?? []).map((tr) => {
    const td = tr.querySelectorAll('td');
    // The two lines of "Startet" (the country under it) with a space, as the page shows them.
    const starts = Array.from(td[4]?.childNodes ?? [], (n) => txt(n as Element)).filter((x) => x !== '').join(' ');
    return [txt(td[0]), txt(td[1]?.querySelector('b')), txt(td[1]?.querySelector('span')), txt(td[2]), txt(td[3]), starts, txt(td[5])].join('|');
  });
  const servicesCount = servicesSection === null ? null : txt(servicesSection.querySelector('[class*="sech"] > span'));
  const cards = Array.from(document.querySelectorAll('main section[id^="fund-"]')).map((sec) => {
    const field = Array.from(sec.querySelectorAll('span')).find((x) => /^Feld /.test(x.textContent ?? ''));
    const country = Array.from(sec.querySelectorAll('p')).find((x) => (x.textContent ?? '').startsWith('Land des Aufrufs'));
    const cells = Array.from(sec.querySelectorAll('[class*="taCell"]'));
    const value = (c: Element | undefined) => txt(c?.querySelector('div'));
    const selected = sec.querySelector('[role="tab"][aria-selected="true"]');
    // The left column of the card (what happens, Soll and Ist, why, the source); the box of the Montageanleitung is the
    // right one (review of B4 part 2: the whole card always had the box's text).
    const left = txt(sec.querySelector('[class*="grid"] > div:first-child'));
    // The text of the card without the addresses of "Gefunden im Quelltext" (strings of the page).
    const own = Array.from(sec.querySelectorAll('h2, h3, p, li, [class*="taCell"], [role="tab"]'), (e) => txt(e)).join(' ');
    return {
      id: sec.id,
      field: field === undefined ? null : txt(field),
      country: country === undefined ? null : txt(country),
      ta: cells.length === 2 ? { target: value(cells[0]), actual: value(cells[1]) } : null,
      source: Array.from(sec.querySelectorAll('pre bdi'), (b) => b.textContent ?? ''),
      tab: selected === null ? null : txt(selected),
      noFix: txt(sec).includes('Für diesen Punkt haben wir noch keine Anleitung.'),
      steps: sec.querySelectorAll('ol li').length,
      left,
      own,
    };
  });
  const stamp = Array.from(document.querySelectorAll('article [class*="stb"] > div')).map((d) => `${txt(d.querySelector('span'))}|${txt(d.querySelector('strong'))}`);
  const help = Array.from(document.querySelectorAll('main a[href="/anfrage"]'), (a) => txt(a));
  return { h1, facts, measures, priorities, marks, rows, cut, note, services, servicesCount, cards, stamp, help, main, robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null, referrer: document.querySelector('meta[name="referrer"]')?.getAttribute('content') ?? null };
}

async function compareValues(page: Page, report: Report, label: string): Promise<string[]> {
  const want = expected(report);
  const got = await page.evaluate(shown);
  const problems: string[] = [];
  const same = (what: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${label}: ${what} on the page ${JSON.stringify(a)}, in the report ${JSON.stringify(b)}`);
  };
  same('heading', got.h1, want.h1);
  same('facts', got.facts, want.facts);
  same('Prüfmaße', got.measures, want.measures);
  same('number of priorities', got.priorities.length, want.priorities.length);
  want.priorities.forEach((p, i) => {
    const g = got.priorities[i];
    if (g === undefined) return;
    same(`meta of priority ${i + 1}`, g.meta, p.meta);
    same(`field of priority ${i + 1}`, g.field, p.field === null ? null : `Feld ${p.field}`);
    if (p.count !== null && !(g.title.includes(String(p.count)) || (p.count === 1 && /^(Ein|Eine|Zu schwacher Kontrast an einer)/.test(g.title)))) problems.push(`${label}: title of priority ${i + 1} "${g.title}" without the count ${p.count}`);
    if (g.title === '' || /\{|\}|^[a-z0-9-]+$/.test(g.title)) problems.push(`${label}: title of priority ${i + 1} "${g.title}"`);
  });
  same('marks of the plan', got.marks, want.marks);
  same('rows of the Zeitschnitt', got.rows, want.rows);
  same('cut A–A', got.cut, want.cut);
  same('note', got.note, want.note);
  // The lower part (session B4 part 2).
  const low = want.lower;
  same('rows of the Stückliste', got.services, low.services);
  same('count of the Stückliste', got.servicesCount, low.servicesCount);
  same('finding details', got.cards.map((c) => c.id), low.cards.map((c) => c.id));
  low.cards.forEach((c, i) => {
    const g = got.cards[i];
    if (g === undefined) return;
    same(`field of card ${c.id}`, g.field, c.field);
    same(`country of card ${c.id}`, g.country, c.country);
    if (c.ta !== null) {
      if (g.ta === null || g.ta.target !== c.ta.target || !g.ta.actual.startsWith(`${c.ta.actual}, `)) problems.push(`${label}: Soll and Ist of card ${c.id} ${JSON.stringify(g.ta)}, in the report ${JSON.stringify(c.ta)}`);
    }
    same(`Gefunden im Quelltext of card ${c.id}`, g.source, c.source);
    same(`selected system tab of card ${c.id}`, g.tab, c.tab);
    same(`"noch keine Anleitung" of card ${c.id}`, g.noFix, c.noFix);
    if (c.tab === null && !c.noFix && g.steps === 0) problems.push(`${label}: card ${c.id} without steps`);
    if (c.steps !== null) same(`steps of the card of the security headers ${c.id}`, g.steps, c.steps);
    if (g.left.length < 20) problems.push(`${label}: card ${c.id} has nothing in its left column (${JSON.stringify(g.left)})`);
    if (/\{[a-zA-Z]+\}|\b(?:third-party|a11y|security|legal|fix)-[a-z-]+\b/.test(g.own)) problems.push(`${label}: card ${c.id} shows a placeholder or a text id`);
  });
  same('help button', got.help, low.lower ? ['Hilfe bei der Umsetzung anfragen'] : []);
  same('title block', got.stamp, low.stamp);
  if (!got.main.includes(DISCLAIMER)) problems.push(`${label}: without the last line of every report`);
  if (got.robots !== 'noindex, nofollow') problems.push(`${label}: robots ${got.robots}`);
  if (got.referrer !== 'no-referrer') problems.push(`${label}: referrer ${got.referrer}`);
  return problems;
}

/** Runs in the page: text outside the window that is not inside a box that scrolls sideways; sideways scrolling. */
function overflow(): { outside: string[]; pageScrolls: boolean } {
  const outside: string[] = [];
  const inScrollBox = (el: Element | null): boolean => {
    for (let e = el; e !== null; e = e.parentElement) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden') && e !== document.documentElement && e !== document.body) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if ((n.textContent ?? '').trim() === '') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width === 0) continue;
      if ((rect.right > innerWidth + 0.5 || rect.left < -0.5) && !inScrollBox(n.parentElement)) outside.push((n.textContent ?? '').trim().slice(0, 40));
    }
  }
  return { outside, pageScrolls: document.documentElement.scrollWidth > innerWidth };
}

/** Runs in the page: the kind of each Tab stop, for the order of the reference. */
function kinds(ids: string[]): string[] {
  return ids.map((id) => {
    const [tag, index] = id.split('#');
    const el = document.querySelectorAll(tag!)[Number(index)];
    if (el === undefined) return '?';
    if (el.closest('header') !== null) return 'header';
    if (el.closest('footer') !== null) return 'footer';
    // Session B4 part 2: the system tabs and their panels, the copy button, the help button, the box of the Stückliste.
    if (el.getAttribute('role') === 'tab') return 'tab';
    if (el.getAttribute('role') === 'tabpanel') return 'panel';
    if (el.tagName === 'BUTTON') return el.closest('section')?.querySelector('h1') ? 'action' : 'copy';
    if (el.getAttribute('role') === 'region') {
      const by = el.getAttribute('aria-labelledby');
      return by === 'pruefmasse' ? 'measures-box' : by === 'stueckliste' ? 'services-box' : 'timeline-box';
    }
    const href = el.getAttribute('href') ?? '';
    if (href === '/bfsg') return 'bfsg';
    if (href.startsWith('#fund-')) return 'priority';
    if (href === '/anfrage') return 'help';
    return 'state-action';
  });
}
// The tab and the panel of a finding detail are one place of the order (the cards one after the other).
const ORDER = ['header', 'action', 'state-action', 'measures-box', 'bfsg', 'priority', 'timeline-box', 'services-box', 'copy', 'tab', 'help', 'footer'];
const rankOf = (k: string): number => ORDER.indexOf(k === 'panel' ? 'tab' : k);

// Session B4 part 2: the system tabs of every finding detail by keyboard (WAI-ARIA tabs pattern): ArrowRight and
// ArrowLeft move to the next and the previous tab (round), Home and End to the first and the last, and each selects
// it; focus and the panel follow; only the selected tab is a Tab stop; Tab goes on to the panel.
async function tabKeys(page: Page, label: string): Promise<string[]> {
  const problems: string[] = [];
  const lists = await page.locator('[role="tablist"]').count();
  for (let n = 0; n < lists; n++) {
    const state = () =>
      page.evaluate((i) => {
        const list = document.querySelectorAll('[role="tablist"]')[i]!;
        const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
        const panel = document.getElementById(tabs[0]!.getAttribute('aria-controls') ?? '');
        return {
          selected: tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'),
          stops: tabs.map((t, k) => (t.getAttribute('tabindex') === '0' ? k : -1)).filter((k) => k >= 0),
          focus: tabs.findIndex((t) => t === document.activeElement),
          labelledBy: tabs.findIndex((t) => t.id === panel?.getAttribute('aria-labelledby')),
          count: tabs.length,
        };
      }, n);
    const first = await state();
    await page.locator('[role="tablist"]').nth(n).locator('[role="tab"][aria-selected="true"]').focus();
    let at = first.selected;
    for (const key of ['ArrowRight', 'ArrowRight', 'End', 'ArrowRight', 'ArrowLeft', 'Home', 'ArrowLeft']) {
      await page.keyboard.press(key);
      at = key === 'ArrowRight' ? (at + 1) % first.count : key === 'ArrowLeft' ? (at + first.count - 1) % first.count : key === 'Home' ? 0 : first.count - 1;
      const s = await state();
      if (s.selected !== at || s.focus !== at || s.labelledBy !== at || s.stops.join() !== String(at)) problems.push(`${label}: tab list ${n + 1}: ${key} should select and focus tab ${at + 1}: ${JSON.stringify(s)}`);
    }
    await page.keyboard.press('Tab');
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '');
    if (role !== 'tabpanel') problems.push(`${label}: tab list ${n + 1}: Tab from the selected tab went to "${role}", not to the panel`);
    // Back to the tab selected on load, so the rest of the checks see the page as loaded.
    await page.locator('[role="tablist"]').nth(n).locator('[role="tab"]').nth(first.selected).click();
  }
  return problems;
}

// Session B4 part 2: the page with the print media emulated: no visible button but the selected system tab, no header,
// navigation or footer, a white page and no dark background behind text, axe 0 (with the contrast of every text) and
// the contrast by pixels where axe could not decide; a screenshot of each state.
async function printCheck(page: Page, label: string, axeSource: string, name: string, width: number): Promise<{ problems: string[]; result: Record<string, unknown> }> {
  const problems: string[] = [];
  await page.emulateMedia({ media: 'print' });
  await nextFrames(page);
  const seen = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const controls = Array.from(document.querySelectorAll('button, input, select, textarea, a[class*="btns"], a[class*="gl"], a[class*="newb"]'))
      .filter(visible)
      .filter((b) => !(b.getAttribute('role') === 'tab' && b.getAttribute('aria-selected') === 'true'))
      .map((b) => (b.textContent ?? '').trim().slice(0, 40));
    const chrome = Array.from(document.querySelectorAll('header, footer, nav')).filter(visible).map((e) => e.tagName);
    const rgb = (c: string): number[] | null => {
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(c);
      return m === null || (m[4] !== undefined && Number(m[4]) < 0.5) ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const pageBackgrounds = [document.documentElement, document.body, document.querySelector('.paper'), document.querySelector('article')].map((e) => (e === null ? 'none' : getComputedStyle(e).backgroundColor));
    // The blueprint grid is a background image (review of B4 part 2).
    const pageImages = [document.documentElement, document.body, document.querySelector('.paper'), document.querySelector('article')].map((e) => (e === null ? 'none' : getComputedStyle(e).backgroundImage));
    // A dark background: a box with text of its own on a background colour darker than mid grey (the small badge
    // "erkannt" of a tab is one: light text on the line colour, as on the screen).
    const dark = Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .filter((e) => {
        const c = rgb(getComputedStyle(e).backgroundColor);
        return c !== null && lum(c) < 0.18 && Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      })
      .map((e) => (e.textContent ?? '').trim().slice(0, 30));
    return { controls, chrome, pageBackgrounds, pageImages, dark };
  });
  if (seen.controls.length > 0) problems.push(`${label}, print: buttons ${seen.controls.join(' | ')}`);
  if (seen.chrome.length > 0) problems.push(`${label}, print: ${seen.chrome.join(', ')} visible`);
  if (seen.pageBackgrounds.some((b) => b !== 'rgb(255, 255, 255)' && b !== 'rgba(0, 0, 0, 0)')) problems.push(`${label}, print: page backgrounds ${seen.pageBackgrounds.join(', ')}`);
  if (seen.pageImages.some((b) => b !== 'none')) problems.push(`${label}, print: page background images ${seen.pageImages.join(', ')}`);
  const darkOther = seen.dark.filter((t) => t !== 'erkannt');
  if (darkOther.length > 0) problems.push(`${label}, print: dark backgrounds behind ${darkOther.join(' | ')}`);
  const run = await axe(page, `print, ${name}`, axeSource);
  if (run.violations.length > 0) problems.push(`${label}, print: axe violations ${run.violations.map((v) => `${v.id} (${v.nodes})`).join(', ')}`);
  const contrast = await contrastByPixels(page);
  for (const x of contrast.filter((c) => c.typical < c.required)) problems.push(`${label}, print: "${x.text}" ${x.typical}:1, needs ${x.required}`);
  await page.screenshot({ path: join(RESULT_DIR, `print-${name}-${width}.png`), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await nextFrames(page);
  console.log(`    print: buttons ${seen.controls.length}, header/footer ${seen.chrome.length}, dark backgrounds ${darkOther.length} (badges "erkannt" ${seen.dark.length - darkOther.length}), axe ${run.violations.length}, contrast by pixels ${contrast.length} texts, lowest ${contrast.length === 0 ? '-' : Math.min(...contrast.map((c) => c.typical)).toFixed(2)}`);
  return { problems, result: { ...seen, axe: run.violations.length, contrast } };
}

// Session B4 part 2: "Als PDF speichern" calls the print dialog of the browser; "Link kopieren" puts the address of the
// report on the clipboard; the copy button of the Stückliste the list read from the JSON; both then change their label
// and say it in their status region.
async function actions(page: Page, origin: string, label: string, copy: string | null): Promise<string[]> {
  const problems: string[] = [];
  await page.evaluate(() => {
    const w = window as unknown as { __printed: number; print: () => void };
    w.__printed = 0;
    w.print = () => {
      w.__printed += 1;
    };
  });
  // The status regions must be there, empty, before the first click, so a screen reader hears what comes into them
  // (review of B4 part 2): each is marked now and must be the one that says the result.
  const before = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="status"]')).map((s) => {
      (s as HTMLElement).dataset.wcBefore = (s.textContent ?? '') === '' ? 'empty' : 'text';
      return s.textContent ?? '';
    }),
  );
  if (before.filter((t) => t === '').length < (copy === null ? 1 : 2)) problems.push(`${label}: ${before.filter((t) => t === '').length} empty status regions before the first click`);
  await page.getByRole('button', { name: 'Als PDF speichern' }).click();
  if ((await page.evaluate(() => (window as unknown as { __printed: number }).__printed)) !== 1) problems.push(`${label}: "Als PDF speichern" did not open the print dialog`);
  const status = (text: string) => page.evaluate((t) => Array.from(document.querySelectorAll('[role="status"][data-wc-before="empty"]')).some((s) => (s.textContent ?? '').includes(t)), text);
  await page.getByRole('button', { name: 'Link kopieren' }).click();
  await page.getByRole('button', { name: 'Link kopiert' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${label}: "Link kopieren" did not change to "Link kopiert"`));
  const link = await page.evaluate(() => navigator.clipboard.readText());
  if (link !== `${origin}/bericht?id=${ID}`) problems.push(`${label}: "Link kopieren" copied ${JSON.stringify(link)}`);
  if (!(await status('Link kopiert'))) problems.push(`${label}: no status region that was empty before says "Link kopiert"`);
  if (copy !== null) {
    await page.getByRole('button', { name: 'Liste für die Datenschutzerklärung kopieren' }).click();
    await page.getByRole('button', { name: 'Liste kopiert' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${label}: the copy button did not change to "Liste kopiert"`));
    // The clipboard of Windows gives line breaks back as CR LF.
    const list = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    if (list !== copy) problems.push(`${label}: the copied list differs from the report: ${JSON.stringify(list.slice(0, 200))}`);
    if (!(await status('Liste kopiert'))) problems.push(`${label}: no status region that was empty before says "Liste kopiert"`);
  } else if ((await page.getByRole('button', { name: 'Liste für die Datenschutzerklärung kopieren' }).count()) > 0) problems.push(`${label}: a copy button without services`);
  return problems;
}

const animations = (page: Page) => page.evaluate(() => document.getAnimations().map((a) => ({ name: (a as CSSAnimation).animationName ?? a.id, length: Number(a.effect?.getComputedTiming().endTime ?? 0) })));

async function checkState(browser: Browser, origin: string, width: number, state: CheckState, axeSource: string, problems: string[]): Promise<{ result: Record<string, unknown>; blocked: number }> {
  const label = `${state.name} ${width} px`;
  const result: Record<string, unknown> = {};
  let blocked = 0;
  // 1. Reduced motion.
  const r = await open(browser, origin, width, true, state.api);
  if (!(await reach(r.page, state.heading, state.timeout))) {
    problems.push(`${label}: the page never showed "${state.heading}" (h1 "${await r.page.locator('h1').first().textContent().catch(() => '')}")`);
    await r.close();
    return { result, blocked: r.blocked.length };
  }
  const moving = await animations(r.page);
  if (moving.length > 0) problems.push(`${label}, reduced motion: ${moving.length} animations`);
  const run: AxeSummary = await axe(r.page, `reduced motion, ${state.name}`, axeSource);
  if (run.violations.length > 0) problems.push(`${label}: axe violations ${run.violations.map((v) => `${v.id} (${v.nodes})`).join(', ')}`);
  const contrast = await contrastByPixels(r.page);
  for (const t of contrast.filter((x) => x.typical < x.required)) problems.push(`${label}: "${t.text}" ${t.typical}:1 against the usual background, needs ${t.required}`);
  const walk = await keyboard(r.page, label);
  problems.push(...walk.problems);
  const stops = walk.stops as { id: string; text: string; ring: { strong: number; required: number } }[];
  const order = await r.page.evaluate(kinds, stops.map((s) => s.id));
  const ranks = order.map(rankOf);
  // Each tab list: its selected tab, then its panel (WAI-ARIA tabs pattern).
  const pairs = order.filter((k) => k === 'tab' || k === 'panel');
  if (pairs.some((k, i) => k !== (i % 2 === 0 ? 'tab' : 'panel'))) problems.push(`${label}: tabs and panels in the order ${pairs.join(' ')}`);
  if (ranks.some((x, i) => x < 0 || (i > 0 && x < ranks[i - 1]!))) problems.push(`${label}: Tab order ${order.join(' > ')} is not the order of the reference`);
  if (state.report !== null) {
    const want = expected(state.report);
    const count = (k: string) => order.filter((o) => o === k).length;
    if (count('priority') !== want.priorities.length) problems.push(`${label}: ${count('priority')} priorities reached by Tab, ${want.priorities.length} in the report`);
    if (count('bfsg') !== (state.report.measures.length > 0 ? 1 : 0)) problems.push(`${label}: the BFSG link reached ${count('bfsg')} times`);
    // Session B4 part 2: two actions on the real page ("An Entwickler weitergeben" is stage D).
    if (count('header') !== 4 || count('action') !== 2) problems.push(`${label}: header ${count('header')}, actions of the head ${count('action')}`);
    if (count('copy') !== (want.lower.copy === null ? 0 : 1)) problems.push(`${label}: the copy button reached ${count('copy')} times`);
    if (count('help') !== (want.lower.lower ? 1 : 0)) problems.push(`${label}: the help button reached ${count('help')} times`);
    const tabbed = want.lower.cards.filter((c) => c.tab !== null).length;
    if (count('tab') !== tabbed || count('panel') !== tabbed) problems.push(`${label}: ${count('tab')} tabs and ${count('panel')} panels reached by Tab, ${tabbed} finding details with system tabs`);
    problems.push(...(await compareValues(r.page, state.report, label)));
    if (tabbed > 0) problems.push(...(await tabKeys(r.page, label)));
  } else if (state.name !== 'laedt' && !order.includes('state-action')) problems.push(`${label}: the way on of the state is not reached by Tab`);
  const over = await r.page.evaluate(overflow);
  if (width <= 390 && over.outside.length > 0) problems.push(`${label}: text outside the window, not in a scroll box: ${over.outside.slice(0, 5).join(' | ')}`);
  if (over.pageScrolls) problems.push(`${label}: the page scrolls sideways`);
  const meta = await r.page.evaluate(() => [document.querySelector('meta[name="robots"]')?.getAttribute('content'), document.querySelector('meta[name="referrer"]')?.getAttribute('content'), document.title]);
  if (meta[0] !== 'noindex, nofollow' || meta[1] !== 'no-referrer') problems.push(`${label}: robots ${meta[0]}, referrer ${meta[1]}`);
  // Session B4 part 2: print, then the copy buttons (they change their labels, so they come last).
  const printed = await printCheck(r.page, label, axeSource, state.name, width);
  problems.push(...printed.problems);
  result.print = printed.result;
  if (state.report !== null) problems.push(...(await actions(r.page, origin, label, expected(state.report).lower.copy)));
  const weakest = stops.length === 0 ? null : Math.min(...stops.map((s) => s.ring.strong / s.ring.required));
  console.log(
    `  ${state.name}: axe ${run.violations.length} (rules passed ${run.passes} of ${run.rules}, incomplete ${run.incomplete.map((x) => `${x.id} ${x.nodes}`).join(', ') || 0}); ` +
      `Tab ${stops.length} (${order.join(' ')}), weakest ring ${weakest?.toFixed(2) ?? '-'}; contrast by pixels ${contrast.length} texts, lowest ${contrast.length === 0 ? '-' : Math.min(...contrast.map((c) => c.typical)).toFixed(2)}; outside ${over.outside.length}`,
  );
  result.reduced = { axe: run, contrast, stops: walk.stops, order, overflow: over, animations: moving };
  blocked += r.blocked.length;
  await r.close();

  // 2. Motion: every animation within 5 s.
  const m = await open(browser, origin, width, false, state.api);
  if (await reach(m.page, state.heading, state.timeout)) {
    const list = await animations(m.page);
    for (const a of list.filter((x) => x.length > LIMIT_MS)) problems.push(`${label}: ${a.name} lasts ${a.length} ms`);
    result.motion = list;
    if (list.length > 0) console.log(`    motion: ${list.length} animations, longest ${Math.max(...list.map((a) => a.length))} ms`);
  } else problems.push(`${label}, motion: never reached`);
  blocked += m.blocked.length;
  await m.close();
  return { result, blocked };
}

/** --reports: one report JSON after the other: values, axe, and the text at 390 px. */
async function checkReports(browser: Browser, origin: string, widths: number[], dir: string, axeSource: string, problems: string[]): Promise<{ result: Record<string, unknown>; blocked: number }> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const result: Record<string, unknown> = {};
  let blocked = 0;
  for (const file of files) {
    const report = { ...(JSON.parse(await readFile(join(dir, file), 'utf8')) as Report), id: ID };
    const name = file.replace(/\.json$/, '');
    for (const width of widths) {
      const label = `report ${name} ${width} px`;
      const r = await open(browser, origin, width, true, { report: json(200, report), status: json(200, scanBody('done')) });
      if (!(await reach(r.page, `Prüfbericht für${report.site.displayHost}`))) {
        problems.push(`${label}: no report on the page`);
        await r.close();
        continue;
      }
      const before = problems.length;
      problems.push(...(await compareValues(r.page, report, label)));
      const run = await axe(r.page, label, axeSource);
      if (run.violations.length > 0) problems.push(`${label}: axe violations ${run.violations.map((v) => `${v.id} (${v.nodes})`).join(', ')}`);
      const over = await r.page.evaluate(overflow);
      if (width <= 390 && over.outside.length > 0) problems.push(`${label}: text outside the window, not in a scroll box: ${over.outside.slice(0, 5).join(' | ')}`);
      if (over.pageScrolls) problems.push(`${label}: the page scrolls sideways`);
      const want = expected(report);
      console.log(`  ${name} ${width} px: ${report.state}, ${want.measures.length} Prüfmaße, ${want.priorities.length} priorities, ${want.marks} marks, ${want.rows.length} rows, axe ${run.violations.length}, outside ${over.outside.length}, problems ${problems.length - before}`);
      result[`${name}-${width}`] = { state: report.state, axe: run.violations.length, outside: over.outside.length, problems: problems.length - before };
      blocked += r.blocked.length;
      await r.close();
    }
  }
  return { result, blocked };
}

async function main(): Promise<void> {
  const widthArg = process.argv.indexOf('--widths');
  const widths = widthArg >= 0 ? (process.argv[widthArg + 1] ?? '').split(',').map(Number).filter((n) => n > 0) : [1440, 390];
  const reportsArg = process.argv.indexOf('--reports');
  const reportsDir = reportsArg >= 0 ? resolve(process.argv[reportsArg + 1] ?? '') : null;
  // --only a,b: only these states (for a repeat of single states; the self-test runs too).
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg >= 0 ? (process.argv[onlyArg + 1] ?? '').split(',') : null;
  await mkdir(RESULT_DIR, { recursive: true });
  const axeSource = await readFile(AXE_FILE, 'utf8');
  const server = await startCheckServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const problems: string[] = [];
  const summary: Record<string, unknown> = {};
  let blocked = 0;
  try {
    if (reportsDir !== null) {
      console.log(`report page with the reports of ${reportsDir}`);
      const done = await checkReports(browser, server.origin, widths, reportsDir, axeSource, problems);
      summary.reports = done.result;
      blocked += done.blocked;
    } else {
      // The comparison of the values must see a wrong value: the page shows the example, the comparison gets a report
      // with five values changed (the domain, a Prüfmaß, a field, a row of the Zeitschnitt, the banner).
      const example = exampleStates().find((s) => s.name === 'dienste-markierungen')!;
      const probe = await open(browser, server.origin, 1440, true, example.api);
      await reach(probe.page, example.heading);
      const wrong = structuredClone(example.report!) as Report;
      wrong.site.displayHost = 'anders-muster.de';
      wrong.measures[0]!.result = wrong.measures[0]!.result === 'pass' ? 'fail' : 'pass';
      wrong.findings.find((f) => f.id === wrong.priorities[0])!.field = 'D1';
      wrong.timeline!.rows[0]!.label = 'anders-muster.de';
      wrong.timeline!.bannerVisibleAtMs = 1500;
      // Session B4 part 2: four values of the lower part (a name of the Stückliste, a provider, the revision of the
      // title block, the country next to the findings before consent).
      wrong.services[1]!.name = 'Anderer Dienst';
      wrong.services[2]!.provider = 'Anderer Anbieter';
      (wrong.revision as { letter: string }).letter = 'C';
      wrong.visit.country = 'AT';
      const seen = await compareValues(probe.page, wrong, 'self-test');
      await probe.close();
      const kinds = ['heading', 'Prüfmaße', 'field of priority', 'rows of the Zeitschnitt', 'cut A–A', 'rows of the Stückliste', 'title block', 'country of card', 'facts'];
      const missed = kinds.filter((k) => !seen.some((x) => x.includes(`: ${k}`)));
      console.log(`self-test of the comparison: ${seen.length} differences seen for 9 changed values; missed ${missed.length === 0 ? 'none' : missed.join(', ')}`);
      if (missed.length > 0) problems.push(`self-test: the comparison missed ${missed.join(', ')}: ${seen.join(' | ')}`);
      for (const width of widths) {
        console.log(`report page, every state, ${width} px`);
        const result: Record<string, unknown> = {};
        for (const state of exampleStates().filter((s) => only === null || only.includes(s.name))) {
          const done = await checkState(browser, server.origin, width, state, axeSource, problems);
          result[state.name] = done.result;
          blocked += done.blocked;
        }
        summary[`${width}`] = result;
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  summary.problems = problems;
  summary.blocked = blocked;
  await writeFile(join(RESULT_DIR, reportsDir === null ? 'summary.json' : 'summary-reports.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nRequests of the app to other hosts: ${blocked}`);
  console.log(problems.length ? `Problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'Problems: 0');
  if (problems.length || blocked) process.exitCode = 1;
}

await main();
