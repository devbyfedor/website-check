// The real report page (`/bericht?id=…`, session B3 part 2) in a browser, with the API answered by this script, at
// 1440 and 390 px, from the production build (no example pages).
//
// Every state (the report states of web/components/report/example-report-states.ts, each a report of the scanner's own
// builder, and the states of the page itself: loading, not ready, ended, not found, our error):
// - with reduced motion: axe-core 0 violations (every rule on by default); the text contrast by pixels where axe could
//   not decide; Tab through every control with the focus ring measured as in B1 and whole in the window, in the order
//   of the reference (header, the actions of the head, the Prüfmaße, the BFSG link, "Drei Dinge", the Zeitschnitt,
//   footer); 0 animations; every value on the page equal to the report (an independent reading of the JSON, not the
//   page's own view functions); at 390 px no text outside the window except inside a box that scrolls sideways, and
//   no sideways scrolling of the page;
// - with motion: every animation ends within 5 s;
// - the page is noindex and sends no Referer (meta elements); 0 requests to other hosts.
//
// With --reports <dir>: the report JSON files of that folder instead (the reports of saved captures, built again
// without a visit, local/ only): values, axe and the text at 390 px for each, at both widths.
//
//   npm run check:report                      builds web/ (production), then checks every state
//   node web/scripts/report-check.ts [--widths 1440,390] [--reports <folder of report files>]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import type { Report } from '../../scanner/src/report/types.ts';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states.ts';
import { axe, contrastByPixels, keyboard, type AxeSummary } from './a11y.ts';
import { ROOT, VIEWPORT_HEIGHT, routeHosts, settle, startCheckServer } from './browser-setup.ts';

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
  if (r.visit.country !== null) out.push(`Aufgerufen aus|${new Intl.DisplayNames(['de'], { type: 'region' }).of(r.visit.country)}`);
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

interface Expected {
  h1: string;
  facts: string[];
  measures: string[];
  priorities: { meta: string; field: string | null; count: number | null }[];
  marks: number;
  rows: { label: string; small: string }[];
  cut: string | null;
  note: boolean;
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
  const t = r.timeline;
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
  };
}

/** Runs in the page: what it shows, in the shape of `Expected`. */
function shown() {
  const txt = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const h1 = document.querySelector('h1')?.textContent ?? '';
  const facts = Array.from(document.querySelectorAll('main dl > div')).map((d) => `${txt(d.querySelector('dt'))}|${txt(d.querySelector('dd'))}`);
  const measures = Array.from(document.querySelectorAll('main table tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td'), (td) => txt(td)).join('|'));
  const priorities = Array.from(document.querySelectorAll('main ol > li')).map((li) => {
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
  return { h1, facts, measures, priorities, marks, rows, cut, note, main, robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null, referrer: document.querySelector('meta[name="referrer"]')?.getAttribute('content') ?? null };
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
    if (el.tagName === 'BUTTON') return 'action';
    if (el.getAttribute('role') === 'region') return el.getAttribute('aria-labelledby') === 'pruefmasse' ? 'measures-box' : 'timeline-box';
    const href = el.getAttribute('href') ?? '';
    if (href === '/bfsg') return 'bfsg';
    if (href.startsWith('#fund-')) return 'priority';
    return 'state-action';
  });
}
const ORDER = ['header', 'action', 'state-action', 'measures-box', 'bfsg', 'priority', 'timeline-box', 'footer'];

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
  const ranks = order.map((k) => ORDER.indexOf(k));
  if (ranks.some((x, i) => x < 0 || (i > 0 && x < ranks[i - 1]!))) problems.push(`${label}: Tab order ${order.join(' > ')} is not the order of the reference`);
  if (state.report !== null) {
    const want = expected(state.report);
    const count = (k: string) => order.filter((o) => o === k).length;
    if (count('priority') !== want.priorities.length) problems.push(`${label}: ${count('priority')} priorities reached by Tab, ${want.priorities.length} in the report`);
    if (count('bfsg') !== (state.report.measures.length > 0 ? 1 : 0)) problems.push(`${label}: the BFSG link reached ${count('bfsg')} times`);
    if (count('header') !== 4 || count('action') !== 3) problems.push(`${label}: header ${count('header')}, actions of the head ${count('action')}`);
    problems.push(...(await compareValues(r.page, state.report, label)));
  } else if (state.name !== 'laedt' && !order.includes('state-action')) problems.push(`${label}: the way on of the state is not reached by Tab`);
  const over = await r.page.evaluate(overflow);
  if (width <= 390 && over.outside.length > 0) problems.push(`${label}: text outside the window, not in a scroll box: ${over.outside.slice(0, 5).join(' | ')}`);
  if (over.pageScrolls) problems.push(`${label}: the page scrolls sideways`);
  const meta = await r.page.evaluate(() => [document.querySelector('meta[name="robots"]')?.getAttribute('content'), document.querySelector('meta[name="referrer"]')?.getAttribute('content'), document.title]);
  if (meta[0] !== 'noindex, nofollow' || meta[1] !== 'no-referrer') problems.push(`${label}: robots ${meta[0]}, referrer ${meta[1]}`);
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
      const example = exampleStates().find((s) => s.name === 'ohne-fremde-server')!;
      const probe = await open(browser, server.origin, 1440, true, example.api);
      await reach(probe.page, example.heading);
      const wrong = structuredClone(example.report!) as Report;
      wrong.site.displayHost = 'anders-muster.de';
      wrong.measures[0]!.result = wrong.measures[0]!.result === 'pass' ? 'fail' : 'pass';
      wrong.findings.find((f) => f.id === wrong.priorities[0])!.field = 'D1';
      wrong.timeline!.rows[0]!.label = 'anders-muster.de';
      wrong.timeline!.bannerVisibleAtMs = 1500;
      const seen = await compareValues(probe.page, wrong, 'self-test');
      await probe.close();
      console.log(`self-test of the comparison: ${seen.length} differences seen for 5 changed values`);
      if (seen.length < 5) problems.push(`self-test: the comparison saw only ${seen.length} of 5 changed values: ${seen.join(' | ')}`);
      for (const width of widths) {
        console.log(`report page, every state, ${width} px`);
        const result: Record<string, unknown> = {};
        for (const state of exampleStates()) {
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
