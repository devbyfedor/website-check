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
//   npm run check:scan            builds web/ (production pages are enough), then checks
//   node web/scripts/scan-check.ts [--widths 1440,390]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { buildReport, DEFAULT_RULES, RULES_FILE, SCANNER_VERSION } from '../../scanner/src/index.ts';
import { SHOP_URL, shopCapture } from '../../scanner/test/report-helpers.ts';
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

const STATUS: Record<Phase, (position: number) => string> = {
  queued: (n) => `Ihre Prüfung wartet: Platz ${n} in der Warteschlange.`,
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

await main();
