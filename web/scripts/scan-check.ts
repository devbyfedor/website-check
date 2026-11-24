// The real scan screen (`/pruefung?id=…`, session B2 part 2) in a browser, with the API answered by this script, at
// 1440 and 390 px, in the states "in der Warteschlange", "läuft" and "fertig" (Fedor's conditions of B2 part 2):
//
// - with reduced motion, on one page that goes through the three states: in each, axe-core 0 violations (every rule
//   on by default), the text contrast by pixels where axe could not decide (the grid behind the text), Tab through
//   every control with the focus ring measured as in B1 and whole in the window, "Bericht öffnen" not in the Tab
//   order before the report, and 0 animations;
// - with motion, on a page that goes through the states with repeated answers: every animation but the time bar ends
//   within 5 s after it began, the bar is the only one that runs longer; the status region gets a text only when the
//   state changes; the status is asked at most once a second; and once more with the report there from the start;
// - 0 requests to other hosts on every page.
//
// Session B2 part 3, the states without design, at both widths:
// - every other state of the scan screen (each report state of the example pages, a scan that ended without a report,
//   an unknown scan, an unreadable report, no connection): with reduced motion axe 0, contrast by pixels, Tab with the
//   focus ring, 0 animations, the right links ("Bericht öffnen", "Neue Prüfung"); with motion everything but the time
//   bar within 5 s;
// - sequences of states on one page: each change reaches the status region once;
// - every refused start of the form on the real home page: its message in the role="alert" region (there from the
//   first paint), tied to the field, aria-invalid only for the address, the focus back in the field, the time from
//   Retry-After in the visitor's clock, axe 0, contrast, Tab, 0 animations with reduced motion, typing clears it.
//
//   npm run check:scan            builds web/ (production pages are enough), then checks
//   node web/scripts/scan-check.ts [--widths 1440,390]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { buildReport, DEFAULT_RULES, RULES_FILE, SCANNER_VERSION } from '../../scanner/src/index.ts';
import { SHOP_URL, shopCapture } from '../../scanner/test/report-helpers.ts';
import { EXAMPLE_SCAN_STATES } from '../components/scan/example-states.ts';
import { axe, contrastByPixels, keyboard, printContrast, type AxeSummary, type TextContrast } from './a11y.ts';
import { ROOT, VIEWPORT_HEIGHT, routeHosts, settle, startCheckServer } from './browser-setup.ts';

const RESULT_DIR = join(ROOT, 'local', 'scan-check');
const AXE_FILE = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
const ID = 'checkscanscreenabcdefghijk';
const LIMIT_MS = 5_000;

type Phase = 'queued' | 'running' | 'done';
interface Mock {
  phase: Phase;
  position: number;
  /** When the page asked for the status (ms, this process). */
  calls: number[];
}

const REPORT = buildReport({
  id: ID,
  createdAt: new Date().toISOString(),
  siteUrl: SHOP_URL,
  mode: 'full',
  capture: shopCapture(),
  rules: DEFAULT_RULES,
  scannerVersion: SCANNER_VERSION,
  rulesUpdated: RULES_FILE.updated,
  visit: { country: 'IT', colo: 'MXP' },
}).report;

const STATUS: Record<Phase, (position?: number) => string> = {
  queued: (n) => `Ihre Prüfung wartet: Platz ${n ?? 0} in der Warteschlange.`,
  running: () => 'Die Messung läuft.',
  done: () => 'Die Messung ist fertig. Der Bericht ist bereit.',
};

function statusBody(mock: Mock): string {
  const started = mock.phase === 'queued' ? null : new Date(Date.now() - 6_000).toISOString();
  return JSON.stringify({
    id: ID,
    status: mock.phase,
    state: mock.phase === 'done' ? 'complete' : null,
    cached: false,
    displayHost: REPORT.site.displayHost,
    queuePosition: mock.phase === 'queued' ? mock.position : null,
    createdAt: REPORT.createdAt,
    startedAt: started,
    finishedAt: mock.phase === 'done' ? new Date().toISOString() : null,
    country: null,
  });
}

async function open(browser: Browser, origin: string, width: number, reduced: boolean, mock: Mock): Promise<{ context: BrowserContext; page: Page; blocked: string[] }> {
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const blocked = await routeHosts(context, origin, 'none');
  // Registered after routeHosts, so it answers the API first.
  await context.route(/\/api\/scans\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/scans/${ID}`) {
      mock.calls.push(Date.now());
      return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: statusBody(mock) });
    }
    if (path === `/api/scans/${ID}/report`) return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(REPORT) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not-found"}' });
  });
  const page = await context.newPage();
  // Every change of the DOM inside the status region, with the text it left there.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __status: string[] }).__status = seen;
    new MutationObserver((records) => {
      const region = document.querySelector('[role="status"]');
      if (region !== null && records.some((r) => region === r.target || region.contains(r.target))) seen.push(region.textContent ?? '');
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`${origin}/pruefung?id=${ID}`);
  return { context, page, blocked };
}

async function reach(page: Page, text: string): Promise<void> {
  await page.waitForFunction((t) => document.querySelector('[role="status"]')?.textContent === t, text, { timeout: 15_000 });
  await settle(page);
}

interface AnimationInfo {
  name: string;
  /** delay plus duration, ms after the animation began */
  length: number;
}

const animations = (page: Page): Promise<AnimationInfo[]> =>
  page.evaluate(() =>
    document.getAnimations().map((a) => ({
      name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id,
      length: Number(a.effect?.getComputedTiming().endTime ?? 0),
    })),
  );
const isBar = (a: AnimationInfo): boolean => a.name.includes('grow-live');

async function main(): Promise<void> {
  const widthArg = process.argv.indexOf('--widths');
  const widths = widthArg >= 0 ? (process.argv[widthArg + 1] ?? '').split(',').map(Number).filter((n) => n > 0) : [1440, 390];
  await mkdir(RESULT_DIR, { recursive: true });
  const axeSource = await readFile(AXE_FILE, 'utf8');
  const server = await startCheckServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const problems: string[] = [];
  const summary: Record<string, unknown> = {};
  let blocked = 0;
  try {
    for (const width of widths) {
      console.log(`scan screen ${width} px`);
      const result: Record<string, unknown> = {};

      // 1. Reduced motion: the three states on one page.
      const mock: Mock = { phase: 'queued', position: 2, calls: [] };
      const r = await open(browser, server.origin, width, true, mock);
      for (const phase of ['queued', 'running', 'done'] as const) {
        mock.phase = phase;
        await reach(r.page, STATUS[phase](mock.position));
        const label = `${phase} ${width} px`;
        const moving = await animations(r.page);
        if (moving.length > 0) problems.push(`${label}, reduced motion: ${moving.length} animations (${moving.map((a) => a.name).join(', ')})`);
        const run: AxeSummary = await axe(r.page, `reduced motion, ${phase}`, axeSource);
        if (run.violations.length > 0) problems.push(`${label}: axe violations ${run.violations.map((v) => `${v.id} (${v.nodes})`).join(', ')}`);
        const contrast: TextContrast[] = await contrastByPixels(r.page);
        const dim = contrast.filter((t) => t.typical < t.required);
        for (const t of dim) problems.push(`${label}: "${t.text}" ${t.typical}:1 against the usual background, needs ${t.required}`);
        const walk = await keyboard(r.page, label);
        problems.push(...walk.problems);
        const stops = walk.stops as { text: string; ring: { strong: number; required: number } }[];
        const reportLink = stops.some((s) => s.text === 'Bericht öffnen');
        if (phase !== 'done' && (reportLink || (await r.page.locator('a', { hasText: 'Bericht öffnen' }).count()) > 0)) problems.push(`${label}: "Bericht öffnen" exists before the report`);
        if (phase === 'done' && !reportLink) problems.push(`${label}: "Bericht öffnen" not reached by Tab`);
        const v = run.violations.reduce((s, x) => s + x.nodes, 0);
        console.log(
          `  ${phase}, reduced motion: animations ${moving.length}; axe violations ${run.violations.length} (${v} elements), incomplete ` +
            `${run.incomplete.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}, rules passed ${run.passes} of ${run.rules}; ` +
            `Tab stops ${stops.length} (${stops.map((s) => s.text).join(' | ')}), weakest ring ${Math.min(...stops.map((s) => s.ring.strong / s.ring.required)).toFixed(2)} x the required area`,
        );
        printContrast(`  ${phase}, color-contrast incomplete, by pixels`, contrast);
        result[`reduced-${phase}`] = { animations: moving, axe: run, contrast, stops: walk.stops };
      }
      blocked += r.blocked.length;
      await r.context.close();

      // 2. Motion: queued (the same answer three times), place 1, running, done.
      const m: Mock = { phase: 'queued', position: 2, calls: [] };
      const p = await open(browser, server.origin, width, false, m);
      await reach(p.page, STATUS.queued(2));
      const atLoad = await animations(p.page);
      await p.page.waitForTimeout(4_500);
      m.position = 1;
      await reach(p.page, STATUS.queued(1));
      m.phase = 'running';
      await reach(p.page, STATUS.running());
      const whileRunning = await animations(p.page);
      m.phase = 'done';
      await reach(p.page, STATUS.done());
      const afterReport = await animations(p.page);
      const texts = await p.page.evaluate(() => (window as unknown as { __status: string[] }).__status);
      const gaps = m.calls.slice(1).map((t, i) => t - m.calls[i]!);
      blocked += p.blocked.length;
      await p.context.close();

      // 3. Motion: the report is there when the page appears.
      const d: Mock = { phase: 'done', position: 0, calls: [] };
      const q = await open(browser, server.origin, width, false, d);
      await reach(q.page, STATUS.done());
      const doneAtLoad = await animations(q.page);
      // "Bericht öffnen" waits invisible (and out of the Tab order) until its panel rises, then stays.
      const linkVisibility = () =>
        q.page.evaluate(() => {
          const link = Array.from(document.querySelectorAll('a')).find((a) => a.textContent === 'Bericht öffnen');
          return link === undefined ? 'missing' : getComputedStyle(link).visibility;
        });
      const early = await linkVisibility();
      await q.page.keyboard.press('Tab');
      await q.page.keyboard.press('Tab');
      await q.page.keyboard.press('Tab');
      const focusedEarly = await q.page.evaluate(() => document.activeElement?.textContent ?? '');
      await q.page.waitForTimeout(LIMIT_MS);
      const later = await linkVisibility();
      if (early !== 'hidden' || focusedEarly === 'Bericht öffnen') problems.push(`${width} px: "Bericht öffnen" can be reached before its panel is shown (${early}, focus "${focusedEarly}")`);
      if (later !== 'visible') problems.push(`${width} px: "Bericht öffnen" not visible 5 s after the report (${later})`);
      console.log(`  "Bericht öffnen" with the report at load: ${early} at first (third Tab on "${focusedEarly}"), ${later} 5 s later`);
      blocked += q.blocked.length;
      await q.context.close();

      const long = (list: AnimationInfo[]) => list.filter((a) => !isBar(a) && a.length > LIMIT_MS);
      for (const [what, list] of [['page load', atLoad], ['running', whileRunning], ['report arrived', afterReport], ['report at load', doneAtLoad]] as const) {
        for (const a of long(list)) problems.push(`${width} px, ${what}: ${a.name} lasts ${a.length} ms`);
      }
      const bars = whileRunning.filter(isBar);
      if (bars.length !== 1) problems.push(`${width} px: ${bars.length} time bars while running`);
      if ([...atLoad, ...afterReport, ...doneAtLoad].some(isBar)) problems.push(`${width} px: the time bar moves without a running scan`);
      const expected = [STATUS.queued(2), STATUS.queued(1), STATUS.running(), STATUS.done()];
      if (JSON.stringify(texts) !== JSON.stringify(expected)) problems.push(`${width} px: status region changed ${JSON.stringify(texts)}, expected ${JSON.stringify(expected)}`);
      if (gaps.some((g) => g < 1_000)) problems.push(`${width} px: status asked ${Math.min(...gaps)} ms after the last time`);
      const maxOf = (list: AnimationInfo[]) => Math.max(0, ...list.filter((a) => !isBar(a)).map((a) => a.length));
      console.log(
        `  motion: page load ${atLoad.length} animations, longest ${maxOf(atLoad)} ms; running: bar ${bars.map((b) => `${b.length} ms`).join(', ')}; ` +
          `report arrived: ${afterReport.length} animations, longest ${maxOf(afterReport)} ms; report at load: ${doneAtLoad.length}, longest ${maxOf(doneAtLoad)} ms`,
      );
      console.log(`  status region: ${texts.length} changes ${JSON.stringify(texts)}; status requests ${m.calls.length}, shortest gap ${Math.min(...gaps)} ms`);
      result.motion = { atLoad, whileRunning, afterReport, doneAtLoad, statusTexts: texts, statusGaps: gaps };

      // Session B2 part 3.
      console.log(`scan screen, the states without design, ${width} px`);
      const states = await checkScreenStates(browser, server.origin, width, axeSource, problems);
      result.states = states.result;
      blocked += states.blocked;
      console.log(`status region, sequences of states, ${width} px`);
      const sequences = await checkSequences(browser, server.origin, width, problems);
      result.sequences = sequences.result;
      blocked += sequences.blocked;
      console.log(`form of the home page, refused starts, ${width} px`);
      const form = await checkForm(browser, server.origin, width, axeSource, problems);
      result.form = form.result;
      blocked += form.blocked;
      summary[`${width}`] = result;
    }
  } finally {
    await browser.close();
    await server.close();
  }
  summary.problems = problems;
  summary.blocked = blocked;
  await writeFile(join(RESULT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nRequests of the app to other hosts: ${blocked}`);
  console.log(problems.length ? `Problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'Problems: 0');
  if (problems.length || blocked) process.exitCode = 1;
}


// ---------------------------------------------------------------------------------------------------------------------
// Session B2 part 3: every state without design on the real pages, with the API answered by this script.

interface Answer {
  status: number;
  body: string;
  headers?: Record<string, string>;
}
type Answering = (call: number) => Answer | 'abort';

const json = (status: number, value: unknown, headers: Record<string, string> = {}): Answer => ({ status, body: JSON.stringify(value), headers });
const scanBody = (status: 'queued' | 'running' | 'done' | 'error', extra: Record<string, unknown> = {}) => ({
  id: ID,
  status,
  state: null,
  cached: false,
  displayHost: 'roesterei-muster.de',
  queuePosition: status === 'queued' ? 1 : null,
  createdAt: new Date().toISOString(),
  startedAt: status === 'queued' ? null : new Date(Date.now() - 4_000).toISOString(),
  finishedAt: null,
  country: null,
  errorReason: null,
  ...extra,
});

const DONE_TEXT: Record<string, string> = {
  complete: 'Die Messung ist fertig. Der Bericht ist bereit.',
  quick: 'Die Schnellprüfung ist fertig. Der Bericht ist bereit.',
  blocked: 'Die Prüfung ist beendet: Ihre Website hat sie blockiert. Der Bericht ist bereit.',
  failed: 'Die Prüfung ist beendet: Ihre Startseite ließ sich nicht prüfen. Der Bericht ist bereit.',
  'not-allowed': 'Die Prüfung ist beendet: Diese Adresse dürfen wir nicht prüfen. Der Bericht ist bereit.',
};
const OFFLINE = 'Keine Verbindung zu unserem Server. Wir versuchen es weiter.';

interface ScreenState {
  name: string;
  status: Answering;
  report: Answering;
  text: string;
  /** The link of the panel at the end: "Bericht öffnen" (a report), "Neue Prüfung" (ended without one), none. */
  panel: 'Bericht öffnen' | 'Neue Prüfung' | null;
  /** The outlined link of the header. */
  header: 'Prüfung abbrechen' | 'Neue Prüfung';
  /** A state that needs several requests without an answer waits longer. */
  timeout?: number;
}

/** The report states of the example pages, each from the scanner's own builder (web/components/scan/example-states.ts). */
function screenStates(): ScreenState[] {
  const list: ScreenState[] = [];
  for (const example of EXAMPLE_SCAN_STATES) {
    const state = example.state();
    if (state.report === null) continue;
    const report = { ...state.report, id: ID };
    list.push({
      name: example.slug,
      status: () => json(200, scanBody('done', { state: report.state })),
      report: () => json(200, report),
      text: DONE_TEXT[report.state]!,
      panel: 'Bericht öffnen',
      header: 'Prüfung abbrechen',
    });
  }
  const ended = (name: string, reason: string, text: string): ScreenState => ({
    name,
    status: () => json(200, scanBody('error', { errorReason: reason })),
    report: () => json(409, { error: 'not-ready' }),
    text,
    panel: 'Neue Prüfung',
    header: 'Neue Prüfung',
  });
  list.push(ended('abgebrochen', 'cancelled', 'Diese Prüfung wurde abgebrochen.'));
  list.push(ended('ausgelastet', 'daily-limit', 'Heute sind alle Prüfungen vergeben.'));
  list.push(ended('fehler', 'other', 'Die Prüfung ist bei uns fehlgeschlagen.'));
  list.push({ name: 'unbekannt', status: () => json(404, { error: 'not-found' }), report: () => json(404, { error: 'not-found' }), text: 'Diese Prüfung finden wir nicht.', panel: 'Neue Prüfung', header: 'Neue Prüfung' });
  list.push({
    name: 'bericht-unlesbar',
    status: () => json(200, scanBody('done', { state: 'complete' })),
    report: () => ({ status: 200, body: '{"schemaVersion":1,"kaputt":true}' }),
    text: 'Den Bericht können wir gerade nicht anzeigen.',
    panel: 'Neue Prüfung',
    header: 'Neue Prüfung',
    timeout: 30_000,
  });
  list.push({ name: 'keine-verbindung', status: () => json(503, { error: 'queue-unavailable' }), report: () => 'abort', text: OFFLINE, panel: null, header: 'Prüfung abbrechen', timeout: 40_000 });
  return list;
}

async function openState(browser: Browser, origin: string, width: number, reduced: boolean, state: { status: Answering; report: Answering }, path = `/pruefung?id=${ID}`) {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const blocked = await routeHosts(context, origin, 'none');
  const calls = { status: 0, report: 0, start: 0 };
  const answer = async (route: Route, a: Answer | 'abort') => {
    if (a === 'abort') return route.abort();
    return route.fulfill({ status: a.status, contentType: 'application/json; charset=utf-8', body: a.body, headers: a.headers ?? {} });
  };
  await context.route(/\/api\/scans/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/scans/${ID}`) return answer(route, state.status(calls.status++));
    if (path === `/api/scans/${ID}/report`) return answer(route, state.report(calls.report++));
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not-found"}' });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __status: string[] }).__status = seen;
    new MutationObserver((records) => {
      const region = document.querySelector('[role="status"]');
      if (region !== null && records.some((r) => region === r.target || region.contains(r.target))) seen.push(region.textContent ?? '');
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`${origin}${path}`);
  return { context, page, blocked, calls };
}

async function waitStatus(page: Page, text: string, timeout = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction((t) => document.querySelector('[role="status"]')?.textContent === t, text, { timeout });
    await settle(page);
    return true;
  } catch {
    return false;
  }
}

const linkTexts = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('a'), (a) => (a.textContent ?? '').trim()));

/** Every screen state at one width: reduced motion (axe, contrast, Tab, 0 animations) and motion (within 5 s). */
async function checkScreenStates(browser: Browser, origin: string, width: number, axeSource: string, problems: string[]): Promise<{ result: Record<string, unknown>; blocked: number }> {
  const result: Record<string, unknown> = {};
  let blocked = 0;
  for (const state of screenStates()) {
    const label = `${state.name} ${width} px`;
    const r = await openState(browser, origin, width, true, state);
    if (!(await waitStatus(r.page, state.text, state.timeout))) {
      problems.push(`${label}: the status line never said "${state.text}" (it says "${await r.page.locator('[role="status"]').textContent()}")`);
      await r.context.close();
      continue;
    }
    const moving = await animations(r.page);
    if (moving.length > 0) problems.push(`${label}, reduced motion: ${moving.length} animations`);
    const run = await axe(r.page, `reduced motion, ${state.name}`, axeSource);
    if (run.violations.length > 0) problems.push(`${label}: axe violations ${run.violations.map((v) => `${v.id} (${v.nodes})`).join(', ')}`);
    const contrast = await contrastByPixels(r.page);
    for (const t of contrast.filter((x) => x.typical < x.required)) problems.push(`${label}: "${t.text}" ${t.typical}:1 against the usual background, needs ${t.required}`);
    const walk = await keyboard(r.page, label);
    problems.push(...walk.problems);
    const links = await linkTexts(r.page);
    const panelOk = state.panel === null ? !links.includes('Bericht öffnen') && links.filter((l) => l === 'Neue Prüfung').length === (state.header === 'Neue Prüfung' ? 1 : 0) : links.includes(state.panel);
    if (!panelOk) problems.push(`${label}: links ${JSON.stringify(links)}, expected the panel link ${state.panel}`);
    if (!links.includes(state.header)) problems.push(`${label}: no "${state.header}" in the header`);
    if (state.header === 'Neue Prüfung' && links.includes('Prüfung abbrechen')) problems.push(`${label}: "Prüfung abbrechen" after the scan ended`);
    if (state.panel !== 'Bericht öffnen' && links.includes('Bericht öffnen')) problems.push(`${label}: "Bericht öffnen" without a report`);
    const texts = await r.page.evaluate(() => (window as unknown as { __status: string[] }).__status);
    blocked += r.blocked.length;
    await r.context.close();

    // With motion: everything but the time bar ends within 5 s.
    const m = await openState(browser, origin, width, false, state);
    await waitStatus(m.page, state.text, state.timeout);
    const withMotion = await animations(m.page);
    const long = withMotion.filter((a) => !isBar(a) && a.length > LIMIT_MS);
    for (const a of long) problems.push(`${label}, motion: ${a.name} lasts ${a.length} ms`);
    if (withMotion.some(isBar) && state.panel !== null) problems.push(`${label}: the time bar moves after the scan ended`);
    blocked += m.blocked.length;
    await m.context.close();

    const stops = walk.stops as { text: string; ring: { strong: number; required: number } }[];
    console.log(
      `  ${state.name}: status "${state.text.slice(0, 48)}…"; reduced motion ${moving.length} animations; axe ${run.violations.length} violations, rules passed ${run.passes} of ${run.rules}; ` +
        `contrast by pixels ${contrast.length} texts, lowest ${contrast.length ? Math.min(...contrast.map((c) => c.typical)).toFixed(2) : '-'}:1; Tab ${stops.length} stops (${stops.map((s) => s.text).join(' | ')}), weakest ring ${stops.length ? Math.min(...stops.map((s) => s.ring.strong / s.ring.required)).toFixed(2) : '-'}; ` +
        `motion: ${withMotion.length} animations, longest ${Math.max(0, ...withMotion.filter((a) => !isBar(a)).map((a) => a.length))} ms; status changes ${texts.length}`,
    );
    result[state.name] = { status: state.text, animationsReduced: moving.length, axe: run, contrast, stops: walk.stops, motion: withMotion, statusTexts: texts };
  }
  return { result, blocked };
}

/** Sequences of states on one page: each change reaches the status region once, and only a change does. */
async function checkSequences(browser: Browser, origin: string, width: number, problems: string[]): Promise<{ result: Record<string, unknown>; blocked: number }> {
  const quick = EXAMPLE_SCAN_STATES.find((s) => s.slug === 'schnellpruefung')!.state().report!;
  const blockedReport = EXAMPLE_SCAN_STATES.find((s) => s.slug === 'blockiert')!.state().report!;
  const sequences: { name: string; status: Answering; report: Answering; expected: string[] }[] = [
    {
      // queued, three requests without an answer, the answer again (running), the quick report.
      name: 'queue, no connection, back, quick check',
      status: (n) => (n < 2 ? json(200, scanBody('queued')) : n < 5 ? json(503, { error: 'queue-unavailable' }) : n < 7 ? json(200, scanBody('running')) : json(200, scanBody('done', { state: 'quick' }))),
      report: () => json(200, { ...quick, id: ID }),
      expected: ['Ihre Prüfung wartet: Platz 1 in der Warteschlange.', OFFLINE, 'Die Messung läuft.', DONE_TEXT.quick!],
    },
    {
      name: 'running, blocked',
      status: (n) => (n < 2 ? json(200, scanBody('running')) : json(200, scanBody('done', { state: 'blocked' }))),
      report: () => json(200, { ...blockedReport, id: ID }),
      expected: ['Die Messung läuft.', DONE_TEXT.blocked!],
    },
    {
      name: 'queue, cancelled by its last visitor',
      status: (n) => (n < 2 ? json(200, scanBody('queued')) : json(200, scanBody('error', { errorReason: 'cancelled' }))),
      report: () => json(409, { error: 'not-ready' }),
      expected: ['Ihre Prüfung wartet: Platz 1 in der Warteschlange.', 'Diese Prüfung wurde abgebrochen.'],
    },
  ];
  const result: Record<string, unknown> = {};
  let blocked = 0;
  for (const seq of sequences) {
    const s = await openState(browser, origin, width, false, seq);
    await waitStatus(s.page, seq.expected[seq.expected.length - 1]!, 60_000);
    await s.page.waitForTimeout(2_500);
    const texts = await s.page.evaluate(() => (window as unknown as { __status: string[] }).__status);
    if (JSON.stringify(texts) !== JSON.stringify(seq.expected)) problems.push(`${width} px, ${seq.name}: status region ${JSON.stringify(texts)}, expected ${JSON.stringify(seq.expected)}`);
    console.log(`  sequence "${seq.name}": ${texts.length} changes for ${s.calls.status} status answers ${JSON.stringify(texts)}`);
    result[seq.name] = { texts, statusAnswers: s.calls.status };
    blocked += s.blocked.length;
    await s.context.close();
  }
  return { result, blocked };
}

interface FormState {
  name: string;
  value: string;
  answer: Answer | 'abort' | null;
  /** The message, with {wann} for the time computed from Retry-After. */
  message: string;
  retryAfter?: number;
  invalid: boolean;
}

const FORM_STATES: FormState[] = [
  { name: 'empty', value: '', answer: null, message: 'Bitte geben Sie die Adresse Ihrer Website ein, zum Beispiel ihre-website.de.', invalid: true },
  { name: 'invalid-address', value: 'roesterei muster', answer: json(400, { error: 'invalid-address' }), message: 'Das ist keine Web-Adresse, die wir prüfen können. Bitte geben Sie sie so ein: ihre-website.de.', invalid: true },
  { name: 'address-not-found', value: 'roesterei-muster.dee', answer: json(400, { error: 'address-not-found' }), message: 'Zu dieser Adresse finden wir keinen Server. Bitte prüfen Sie die Schreibweise.', invalid: true },
  { name: 'address-not-allowed port', value: 'roesterei-muster.de:8080', answer: json(400, { error: 'address-not-allowed', reason: 'port' }), message: 'Wir prüfen nur Websites auf den üblichen Ports. Bitte geben Sie die Adresse ohne Portnummer ein.', invalid: true },
  { name: 'rate-limited hour', value: 'roesterei-muster.de', answer: json(429, { error: 'rate-limited', limit: 'hour', retryAfterSeconds: 1260 }, { 'retry-after': '1260' }), retryAfter: 1260, message: 'Sie haben in dieser Stunde so viele Prüfungen gestartet, wie wir einem Besucher erlauben. Die nächste ist {wann} möglich.', invalid: false },
  { name: 'rate-limited day', value: 'roesterei-muster.de', answer: json(429, { error: 'rate-limited', limit: 'day', retryAfterSeconds: 39400 }, { 'retry-after': '39400' }), retryAfter: 39400, message: 'Sie haben heute so viele Prüfungen gestartet, wie wir einem Besucher an einem Tag erlauben. Die nächste ist {wann} möglich.', invalid: false },
  { name: 'rate-limited starts', value: 'roesterei-muster.de', answer: json(429, { error: 'rate-limited', limit: 'starts', retryAfterSeconds: 600 }, { 'retry-after': '600' }), retryAfter: 600, message: 'Sie haben in kurzer Zeit sehr viele Prüfungen gestartet. Die nächste ist {wann} möglich.', invalid: false },
  { name: 'daily-limit', value: 'roesterei-muster.de', answer: json(503, { error: 'daily-limit', retryAfterSeconds: 39400 }, { 'retry-after': '39400' }), retryAfter: 39400, message: 'Heute sind alle Prüfungen vergeben. Die nächste ist {wann} möglich.', invalid: false },
  { name: 'queue-unavailable', value: 'roesterei-muster.de', answer: json(503, { error: 'queue-unavailable' }, { 'retry-after': '60' }), retryAfter: 60, message: 'Bei uns ist gerade ein Fehler aufgetreten. Bitte versuchen Sie es {wann} noch einmal.', invalid: false },
  { name: 'no answer', value: 'roesterei-muster.de', answer: 'abort', message: 'Bei uns ist gerade ein Fehler aufgetreten. Bitte versuchen Sie es in einigen Minuten noch einmal.', invalid: false },
];

/** "ab 14:25 Uhr", "morgen ab 01:00 Uhr" or "am 27.11. ab 14:04 Uhr" in Berlin (the context's zone), as the page writes it. */
function berlinWhen(at: number, now: number): string {
  const zone = { timeZone: 'Europe/Berlin' };
  const moment = Math.ceil(at / 60_000) * 60_000;
  const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zone }).format(moment);
  const day = (ms: number) => new Intl.DateTimeFormat('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit', ...zone }).format(ms);
  if (day(moment) === day(now)) return `ab ${time} Uhr`;
  if (day(moment) === day(now + 86_400_000)) return `morgen ab ${time} Uhr`;
  return `am ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', ...zone }).format(moment)} ab ${time} Uhr`;
}

/** Every refused start on the real home page: message, field, screen reader, focus, axe, contrast, Tab, motion. */
async function checkForm(browser: Browser, origin: string, width: number, axeSource: string, problems: string[]): Promise<{ result: Record<string, unknown>; blocked: number }> {
  const result: Record<string, unknown> = {};
  let blocked = 0;
  for (const [i, state] of FORM_STATES.entries()) {
    const label = `form ${state.name} ${width} px`;
    // Reduced motion for the measurements; the first state also with motion (the home page's own animations).
    for (const reduced of i === 0 ? [true, false] : [true]) {
      const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'de-DE', timezoneId: 'Europe/Berlin' });
      blocked += (await routeHosts(context, origin, 'none')).length;
      let answeredAt = 0;
      let starts = 0;
      await context.route(/\/api\/scans$/, async (route) => {
        starts += 1;
        answeredAt = Date.now();
        if (state.answer === null) return route.fulfill({ status: 500, body: '' });
        if (state.answer === 'abort') return route.abort();
        return route.fulfill({ status: state.answer.status, contentType: 'application/json; charset=utf-8', body: state.answer.body, headers: state.answer.headers ?? {} });
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const seen: string[] = [];
        (window as unknown as { __alert: string[] }).__alert = seen;
        new MutationObserver((records) => {
          const region = document.querySelector('[role="alert"]');
          if (region !== null && records.some((r) => region === r.target || region.contains(r.target))) seen.push(region.textContent ?? '');
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
      await page.goto(`${origin}/`);
      await settle(page);
      const regionAtLoad = await page.evaluate(() => document.querySelectorAll('[role="alert"]').length);
      // Submit with the button (the focus is then on the button): the message must bring it back to the field.
      if (state.value !== '') await page.fill('#objekt', state.value);
      await page.locator('button[type="submit"]').focus();
      await page.keyboard.press('Enter');
      const wanted = state.message;
      try {
        await page.waitForFunction(() => (document.querySelector('[role="alert"]')?.textContent ?? '') !== '', null, { timeout: 15_000 });
      } catch {
        problems.push(`${label}: no message`);
      }
      await settle(page);
      const seen = await page.evaluate(() => ({
        text: document.querySelector('[role="alert"]')?.textContent ?? '',
        describedBy: document.getElementById('objekt')?.getAttribute('aria-describedby') ?? null,
        invalid: document.getElementById('objekt')?.getAttribute('aria-invalid') ?? null,
        focus: document.activeElement?.id ?? document.activeElement?.tagName ?? '',
        alerts: (window as unknown as { __alert: string[] }).__alert,
      }));
      const expectedText = state.retryAfter === undefined ? wanted : wanted.replace('{wann}', berlinWhen(answeredAt + state.retryAfter * 1000, answeredAt));
      // The page took its clock a moment after this script: one minute of rounding either way is the same answer.
      const alt = state.retryAfter === undefined ? wanted : wanted.replace('{wann}', berlinWhen(answeredAt + state.retryAfter * 1000 + 60_000, answeredAt));
      if (seen.text !== expectedText && seen.text !== alt) problems.push(`${label}: message "${seen.text}", expected "${expectedText}"`);
      if (regionAtLoad !== 1) problems.push(`${label}: ${regionAtLoad} alert regions at load (expected 1, there from the first paint)`);
      if (seen.describedBy !== 'objekt-fehler') problems.push(`${label}: the field is not tied to the message (aria-describedby ${seen.describedBy})`);
      if ((seen.invalid === 'true') !== state.invalid) problems.push(`${label}: aria-invalid ${seen.invalid}, expected ${state.invalid}`);
      if (seen.focus !== 'objekt') problems.push(`${label}: focus on ${seen.focus}, not in the field`);
      if (!seen.alerts.includes(seen.text)) problems.push(`${label}: the alert region never got the message`);
      if (state.answer === null && starts !== 0) problems.push(`${label}: an empty field sent a request`);
      if (page.url() !== `${origin}/`) problems.push(`${label}: the page left the home page (${page.url()})`);
      let extra = '';
      if (reduced) {
        const moving = await animations(page);
        if (moving.length > 0) problems.push(`${label}, reduced motion: ${moving.length} animations`);
        const run = await axe(page, `form ${state.name}`, axeSource);
        if (run.violations.length > 0) problems.push(`${label}: axe violations ${run.violations.map((v) => `${v.id} (${v.nodes})`).join(', ')}`);
        const contrast = await contrastByPixels(page);
        const message = contrast.filter((c) => c.text.startsWith(seen.text.slice(0, 20)));
        for (const t of contrast.filter((x) => x.typical < x.required)) problems.push(`${label}: "${t.text}" ${t.typical}:1 against the usual background, needs ${t.required}`);
        // The walk starts at the top of the page: the focus is in the field now, and a blur keeps Chrome's starting
        // point there, so an element before everything (not a control) takes the focus first.
        if (i === 0) {
          await page.evaluate(() => {
            const start = document.createElement('span');
            start.tabIndex = -1;
            document.body.prepend(start);
            window.scrollTo(0, 0);
            start.focus();
          });
        }
        const walk = i === 0 ? await keyboard(page, label) : { problems: [], stops: [] };
        problems.push(...walk.problems);
        extra =
          `axe ${run.violations.length} violations; message by pixels ${message.map((c) => `${c.typical}:1 (needs ${c.required})`).join(', ') || (await page.evaluate(() => getComputedStyle(document.querySelector('[role="alert"]')!).color))}` +
          (i === 0 ? `; Tab ${walk.stops.length} stops` : '');
        result[state.name] = { message: seen.text, describedBy: seen.describedBy, invalid: seen.invalid, focus: seen.focus, alerts: seen.alerts, axe: run.violations.length, contrast: message };
        await page.locator('#objekt').pressSequentially('x');
        const cleared = await page.evaluate(() => ({ text: document.querySelector('[role="alert"]')?.textContent ?? '', describedBy: document.getElementById('objekt')?.getAttribute('aria-describedby') }));
        if (cleared.text !== '' || cleared.describedBy !== null) problems.push(`${label}: typing does not clear the message`);
      } else {
        const withMotion = await animations(page);
        for (const a of withMotion.filter((x) => x.length > LIMIT_MS)) problems.push(`${label}, motion: ${a.name} lasts ${a.length} ms`);
        extra = `motion: ${withMotion.length} animations, longest ${Math.max(0, ...withMotion.map((a) => a.length))} ms`;
      }
      console.log(`  ${state.name}${reduced ? '' : ' (motion)'}: "${seen.text.slice(0, 60)}…"; aria-describedby ${seen.describedBy}, aria-invalid ${seen.invalid}, focus ${seen.focus}, alert changes ${seen.alerts.length}; ${extra}`);
      await context.close();
    }
  }
  return { result, blocked };
}

await main();
