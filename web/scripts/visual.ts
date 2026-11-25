// Visual check (brief, stage B): full-page screenshots of a reference file in design/reference and of
// the matching page of the static export in web/out, at 1440 and 390 px width, with
// reducedMotion 'reduce'. Writes both screenshots and a diff image per page and width to local/visual/
// and prints the share of different pixels.
//
//   npm run visual                      builds web/ with the example pages first, then compares every built page
//   node web/scripts/visual.ts [--only start] [--widths 1440,390] [--reference-only] [--google-fonts]
//
// Fonts: the reference files load Barlow from Google Fonts. Unless --google-fonts is given, that
// stylesheet is answered with the same font files the app self-hosts (web/fonts), so the check makes
// no request to Google and both screenshots use identical font files. Every other request to another
// host is blocked and counted. For the app any such request is an error (exit code 1).
//
// Besides the pixels the script records, per screenshot, horizontal scrolling, text outside the
// viewport, text cut off by its box and text boxes that overlap (local/visual/summary.json).
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import { cropTop, decidedWording, diffImages, EXAMPLE_DATA_CHANGES, exampleData, EXTRA_CARDS, hideAll, regionBottom } from './image-diff.ts';
import { OUT_DIR, ROOT, VIEWPORT_HEIGHT, routeHosts, settle, startCheckServer, type FontRouting } from './browser-setup.ts';

const RESULT_DIR = join(ROOT, 'local', 'visual');

// Reference file and app path of each page. `app: null` until a session builds the page. The scan
// screen and the report are compared with the example of the reference, pages of the example build only
// (WC_EXAMPLES=1). `region`: the page is built only in part, and the comparison counts the area from the top of the
// page to the bottom of this block (the same selector in both pages); everything below it is left out. `decided`: the
// reference gets the wording a product rule decides (image-diff.ts, decidedWording) before it is compared; the
// difference against the unchanged reference is printed too. `hideInApp`: elements of
// the app the reference shows only once as a pattern (the finding details after the first, image-diff.ts), hidden in
// the app before its screenshot. `exampleData` (B4 part 1): the page is also compared with the reference that has, besides
// the decided wording, the data of the example where schema v1 cannot hold the reference's data (image-diff.ts,
// exampleData); printed next to the main number, which stays the one with the decided wording only.
// `states` (session B5 part 1): the page is also compared after these clicks (the index of each button among the buttons
// of the page, the same in both pages), one comparison per state.
const PAGES: { name: string; reference: string; app: string | null; region?: string; decided?: boolean; hideInApp?: string; exampleData?: boolean; states?: { name: string; clicks: number[] }[] }[] = [
  { name: 'start', reference: 'start.html', app: '/' },
  { name: 'pruefung', reference: 'pruefung.html', app: '/pruefung/beispiel' }, // B2
  { name: 'bericht', reference: 'bericht.html', app: '/bericht/beispiel', decided: true, hideInApp: EXTRA_CARDS, exampleData: true }, // B3, B4: the whole report
  // B5 part 1: the start state (no answer), then the four paths. The buttons in the order of the page: 0 and 1 "Ja" and
  // "Nein" of question 1, 2 and 3 of question 2, 4 and 5 of question 3, 6 "Neu beginnen".
  {
    name: 'bfsg',
    reference: 'bfsg.html',
    app: '/bfsg',
    states: [
      { name: 'pfad1', clicks: [1] },
      { name: 'pfad2', clicks: [0, 2] },
      { name: 'pfad3', clicks: [0, 3, 4] },
      { name: 'pfad4', clicks: [0, 3, 5] },
    ],
  },
];

// Places of the reference that Fedor decides (layout faults of the reference itself). They are painted
// over in both screenshots and do not count. Each entry: page, width, CSS selectors valid in both pages.
const EXCLUDED: { page: string; width: number; selectors: string[]; why: string }[] = [];

interface Args {
  only: string[] | null;
  widths: number[];
  referenceOnly: boolean;
  googleFonts: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { only: null, widths: [1440, 390], referenceOnly: false, googleFonts: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--widths') args.widths = (argv[++i] ?? '').split(',').map(Number).filter((n) => n > 0);
    else if (a === '--reference-only') args.referenceOnly = true;
    else if (a === '--google-fonts') args.googleFonts = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface LayoutReport {
  scrollWidth: number;
  clientWidth: number;
  outsideViewport: { text: string; element: string; left: number; right: number }[];
  cutOff: { element: string; text: string; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }[];
  overflowingBox: { element: string; text: string; scrollWidth: number; clientWidth: number }[];
  overlaps: { a: string; b: string; textA: string; textB: string; area: number }[];
}

// Runs in the page. Plain JavaScript after type stripping.
function layoutCheck(): LayoutReport {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const describe = (el: Element): string => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '';
      parts.unshift(e.tagName.toLowerCase() + cls);
    }
    return parts.join(' > ');
  };
  const visible = (el: Element): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const report: LayoutReport = {
    scrollWidth: doc.scrollWidth,
    clientWidth: vw,
    outsideViewport: [],
    cutOff: [],
    overflowingBox: [],
    overlaps: [],
  };
  const boxes: { el: Element; text: string; x: number; y: number; w: number; h: number }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.textContent ?? '').trim();
    const el = node.parentElement;
    if (!text || !el || el.closest('script, style') || !visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      boxes.push({ el, text: text.slice(0, 50), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
      if (r.right > vw + 0.5 || r.left < -0.5) {
        report.outsideViewport.push({ text: text.slice(0, 50), element: describe(el), left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
  }
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (!(el instanceof HTMLElement) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const text = (el.textContent ?? '').trim().slice(0, 50);
    const wider = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
    const taller = el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0;
    if ((wider && cs.overflowX !== 'visible') || (taller && cs.overflowY !== 'visible')) {
      report.cutOff.push({ element: describe(el), text, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    } else if (wider && text) {
      report.overflowingBox.push({ element: describe(el), text, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 1 && h > 1) report.overlaps.push({ a: describe(a.el), b: describe(b.el), textA: a.text, textB: b.text, area: Math.round(w * h) });
    }
  }
  return report;
}

interface Shot {
  png: PNG;
  layout: LayoutReport;
  blocked: string[];
  /** The height of the compared area, when the page has a region; the full page otherwise. */
  regionHeight: number | null;
  /** How many elements of `hide` were hidden; null without `hide`. */
  hidden: number | null;
}

async function shoot(
  browser: Browser,
  url: string,
  width: number,
  origin: string,
  opts: { fonts: FontRouting; mask: string[]; file: string; region?: string | undefined; decided?: boolean | undefined; hide?: string | undefined; data?: boolean | undefined; clicks?: number[] | undefined },
): Promise<Shot> {
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const blocked = await routeHosts(context, origin, opts.fonts);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle(page);
  // One click per round trip, so that the app has drawn the answer (and enabled the next question) before the next click.
  for (const index of opts.clicks ?? []) {
    const ok = await page.evaluate((i) => {
      const button = document.querySelectorAll('button')[i];
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    }, index);
    if (!ok) throw new Error(`${url}: button ${index} not there or disabled`);
    await settle(page);
  }
  if (opts.decided && (await page.evaluate(decidedWording)) !== 1) throw new Error(`${url}: the row of the decided wording was not found`);
  if (opts.decided) await settle(page);
  if (opts.data) {
    const n = await page.evaluate(exampleData);
    if (n !== EXAMPLE_DATA_CHANGES) throw new Error(`${url}: ${n} changes for the data of the example, expected ${EXAMPLE_DATA_CHANGES}`);
    await settle(page);
  }
  // The layout of the whole page, the hidden cards too (review of B4 part 1), before they are hidden for the pixels.
  const layout = await page.evaluate(layoutCheck);
  const hidden = opts.hide === undefined ? null : await page.evaluate(hideAll, opts.hide);
  if (hidden !== null) await settle(page);
  const bottom = opts.region === undefined ? null : await page.evaluate(regionBottom, opts.region);
  if (opts.region !== undefined && bottom === null) throw new Error(`${url}: no element ${opts.region}`);
  const buffer = await page.screenshot({
    fullPage: true,
    mask: opts.mask.map((s) => page.locator(s)),
    maskColor: '#FF00FF',
  });
  await context.close();
  const png = bottom === null ? PNG.sync.read(buffer) : cropTop(PNG.sync.read(buffer), bottom);
  await writeFile(opts.file, PNG.sync.write(png));
  return { png, layout, blocked, regionHeight: bottom === null ? null : png.height, hidden };
}

interface Result {
  page: string;
  width: number;
  referenceSize: [number, number];
  appSize: [number, number];
  differentPixels: number;
  strictDifferentPixels: number;
  totalPixels: number;
  percent: number;
  strictPercent: number;
  excluded: string[];
  /** Pages with `decided`: the share of different pixels against the reference as it is, without the decided wording. */
  asIsPercent?: number;
  /** Pages with `exampleData`: the share against the reference with the decided wording and the data of schema v1. */
  dataPercent?: number;
  /** Session B4 part 2: the strict pixels of that comparison (threshold 0). */
  dataStrictPercent?: number;
}

function compare(name: string, width: number, ref: PNG, app: PNG, excluded: string[]): { result: Result; diff: PNG } {
  const d = diffImages(ref, app);
  return {
    diff: d.diff,
    result: {
      page: name,
      width,
      referenceSize: [ref.width, ref.height],
      appSize: [app.width, app.height],
      differentPixels: d.differentPixels,
      strictDifferentPixels: d.strictDifferentPixels,
      totalPixels: d.totalPixels,
      percent: (100 * d.differentPixels) / d.totalPixels,
      strictPercent: (100 * d.strictDifferentPixels) / d.totalPixels,
      excluded,
    },
  };
}

function printLayout(label: string, l: LayoutReport): void {
  const scroll = l.scrollWidth > l.clientWidth ? `horizontal scrolling ${l.scrollWidth} > ${l.clientWidth} px` : 'no horizontal scrolling';
  console.log(
    `  ${label}: ${scroll}; text outside the viewport ${l.outsideViewport.length}, cut off ${l.cutOff.length}, ` +
      `wider than its box ${l.overflowingBox.length}, overlapping text boxes ${l.overlaps.length}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(RESULT_DIR, { recursive: true });
  const pages = PAGES.filter((p) => !args.only || args.only.includes(p.name));
  if (!args.referenceOnly && !(await exists(join(OUT_DIR, 'index.html')))) {
    throw new Error('web/out is missing: run `npm run build -w web` first (or `npm run visual`, which builds)');
  }
  const server = await startCheckServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const results: Result[] = [];
  const layouts: Record<string, unknown> = {};
  let appBlocked = 0;
  try {
    for (const p of pages) {
      for (const width of args.widths) {
        const tag = `${p.name}-${width}`;
        const excluded = EXCLUDED.filter((e) => e.page === p.name && e.width === width).flatMap((e) => e.selectors);
        console.log(`${tag}`);
        const ref = await shoot(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, {
          fonts: args.googleFonts ? 'google' : 'local',
          mask: excluded,
          file: join(RESULT_DIR, `${tag}-reference.png`),
          region: args.referenceOnly ? undefined : p.region,
          decided: !args.referenceOnly && p.decided === true,
        });
        printLayout('reference', ref.layout);
        // The unchanged reference as well, for the number against the file as it is.
        const asIs = p.decided && !args.referenceOnly && p.app
          ? await shoot(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, {
              fonts: args.googleFonts ? 'google' : 'local',
              mask: excluded,
              file: join(RESULT_DIR, `${tag}-reference-as-is.png`),
              region: p.region,
            })
          : null;
        // With the decided wording and the data of the example where schema v1 cannot hold the reference's (B4 part 1).
        const withData = p.exampleData && !args.referenceOnly && p.app
          ? await shoot(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, {
              fonts: args.googleFonts ? 'google' : 'local',
              mask: excluded,
              file: join(RESULT_DIR, `${tag}-reference-data.png`),
              region: p.region,
              decided: true,
              data: true,
            })
          : null;
        if (ref.blocked.length) console.log(`  reference: ${ref.blocked.length} requests to other hosts blocked`);
        layouts[`${tag}-reference`] = ref.layout;
        if (args.referenceOnly || !p.app) {
          if (!args.referenceOnly) console.log('  app: page not built yet');
          continue;
        }
        const app = await shoot(browser, `${server.origin}${p.app}`, width, server.origin, {
          fonts: 'none',
          mask: excluded,
          file: join(RESULT_DIR, `${tag}-app.png`),
          region: p.region,
          hide: p.hideInApp,
        });
        if (app.hidden !== null) console.log(`  app: ${app.hidden} finding details after the first hidden before the screenshot (the reference shows one card as the pattern)`);
        printLayout('app', app.layout);
        layouts[`${tag}-app`] = app.layout;
        appBlocked += app.blocked.length;
        console.log(`  app: requests to other hosts ${app.blocked.length}${app.blocked.length ? ': ' + app.blocked.join(', ') : ''}`);
        const diffFile = join(RESULT_DIR, `${tag}-diff.png`);
        const { result, diff } = compare(p.name, width, ref.png, app.png, excluded);
        await writeFile(diffFile, PNG.sync.write(diff));
        if (asIs !== null) {
          const plain = compare(p.name, width, asIs.png, app.png, excluded);
          await writeFile(join(RESULT_DIR, `${tag}-diff-as-is.png`), PNG.sync.write(plain.diff));
          result.asIsPercent = plain.result.percent;
          console.log(
            `  against the reference as it is (without the decided wording): reference ${plain.result.referenceSize.join(' x ')}, ` +
              `different pixels ${plain.result.percent.toFixed(3)} % (${plain.result.differentPixels} of ${plain.result.totalPixels})`,
          );
        }
        if (withData !== null) {
          const data = compare(p.name, width, withData.png, app.png, excluded);
          await writeFile(join(RESULT_DIR, `${tag}-diff-data.png`), PNG.sync.write(data.diff));
          result.dataPercent = data.result.percent;
          result.dataStrictPercent = data.result.strictPercent;
          console.log(
            `  against the reference with the decided wording and the data schema v1 holds (Stückliste without the YouTube row, "Google Analytics" for "Google Analytics 4", the address in "Gefunden im Quelltext"): ` +
              `reference ${data.result.referenceSize.join(' x ')}, different pixels ${data.result.percent.toFixed(3)} % (${data.result.differentPixels} of ${data.result.totalPixels}), strict ${data.result.strictPercent.toFixed(3)} %`,
          );
        }
        if (asIs !== null) console.log('  against the reference with the decided wording of the row "Erklärung zur Barrierefreiheit" (product rule 3):');
        results.push(result);
        for (const st of p.states ?? []) {
          const stTag = `${p.name}-${st.name}-${width}`;
          const r = await shoot(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, {
            fonts: args.googleFonts ? 'google' : 'local',
            mask: excluded,
            file: join(RESULT_DIR, `${stTag}-reference.png`),
            clicks: st.clicks,
          });
          const a = await shoot(browser, `${server.origin}${p.app}`, width, server.origin, {
            fonts: 'none',
            mask: excluded,
            file: join(RESULT_DIR, `${stTag}-app.png`),
            clicks: st.clicks,
          });
          appBlocked += a.blocked.length;
          layouts[`${stTag}-reference`] = r.layout;
          layouts[`${stTag}-app`] = a.layout;
          const c = compare(`${p.name} ${st.name}`, width, r.png, a.png, excluded);
          await writeFile(join(RESULT_DIR, `${stTag}-diff.png`), PNG.sync.write(c.diff));
          results.push(c.result);
          printLayout(`${st.name}, reference`, r.layout);
          printLayout(`${st.name}, app`, a.layout);
          console.log(
            `  ${st.name} (buttons ${st.clicks.join(', ')} clicked): size reference ${c.result.referenceSize.join(' x ')}, app ${c.result.appSize.join(' x ')}; ` +
              `different pixels ${c.result.percent.toFixed(3)} % (${c.result.differentPixels} of ${c.result.totalPixels}), strict ${c.result.strictPercent.toFixed(3)} %; requests to other hosts ${a.blocked.length}`,
          );
        }
        if (p.region !== undefined) console.log(`  compared area: from the top of the page to the bottom of ${p.region} (reference ${ref.regionHeight} px, app ${app.regionHeight} px high)`);
        console.log(
          `  size reference ${result.referenceSize.join(' x ')}, app ${result.appSize.join(' x ')}; ` +
            `different pixels ${result.percent.toFixed(3)} % (${result.differentPixels} of ${result.totalPixels}), ` +
            `strict ${result.strictPercent.toFixed(3)} %${excluded.length ? `; excluded: ${excluded.join(', ')}` : ''}`,
        );
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  await writeFile(join(RESULT_DIR, 'summary.json'), JSON.stringify({ results, layouts, appBlocked }, null, 2) + '\n');
  console.log(`\nScreenshots and diff images: ${RESULT_DIR}`);
  if (results.length) {
    console.log('Different pixels (threshold 0.1, anti-aliasing not counted):');
    for (const r of results) {
      // Session B4 part 2 (Fedor's answer 1): the measure of the report is the comparison with the reference into which
      // the data schema v1 holds is put (docs/decisions.md lists the places); the strict number, against the reference
      // with the decided wording only, stands next to it.
      if (r.dataPercent !== undefined) {
        console.log(
          `  ${r.page} ${r.width} px: ${r.dataPercent.toFixed(3)} % against the reference with the data of schema v1 (the measure, at most 1 %: ${r.dataPercent <= 1 ? 'yes' : 'NO'}; strict pixels ${(r.dataStrictPercent ?? 0).toFixed(3)} %); ` +
            `strict number ${r.percent.toFixed(3)} % against the reference with the decided wording only${r.asIsPercent === undefined ? '' : `, ${r.asIsPercent.toFixed(3)} % against the reference as it is`}`,
        );
        continue;
      }
      console.log(`  ${r.page} ${r.width} px: ${r.percent.toFixed(3)} %${r.asIsPercent === undefined ? '' : ` (against the reference as it is ${r.asIsPercent.toFixed(3)} %)`}`);
    }
  }
  if (!args.referenceOnly) console.log(`Requests of the app to other hosts: ${appBlocked}`);
  // The 1 % of the session messages (review of B4 part 2): for the report the measure with the data of schema v1.
  const over = results.filter((r) => (r.dataPercent ?? r.percent) > 1);
  if (over.length > 0) console.log(`Above 1 %: ${over.map((r) => `${r.page} ${r.width} px`).join(', ')}`);
  if (appBlocked > 0 || over.length > 0) process.exitCode = 1;
}

await main();
