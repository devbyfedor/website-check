// Visual check (brief, stage B): full-page screenshots of a reference file in design/reference and of
// the matching page of the static export in web/out, at 1440 and 390 px width, with
// reducedMotion 'reduce'. Writes both screenshots and a diff image per page and width to local/visual/
// and prints the share of different pixels.
//
//   npm run visual                      builds web/ first, then compares every built page
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startStaticServer } from './static-server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'web', 'out');
const REFERENCE_DIR = join(ROOT, 'design', 'reference');
const FONT_DIR = join(ROOT, 'web', 'fonts');
const RESULT_DIR = join(ROOT, 'local', 'visual');

// Reference file and app path of each page. `app: null` until a session builds the page.
const PAGES: { name: string; reference: string; app: string | null }[] = [
  { name: 'start', reference: 'start.html', app: '/' },
  { name: 'pruefung', reference: 'pruefung.html', app: null }, // B2
  { name: 'bericht', reference: 'bericht.html', app: null }, // B3, B4
  { name: 'bfsg', reference: 'bfsg.html', app: null }, // B5
];

// Places of the reference that Fedor decides (layout faults of the reference itself). They are painted
// over in both screenshots and do not count. Each entry: page, width, CSS selectors valid in both pages.
const EXCLUDED: { page: string; width: number; selectors: string[]; why: string }[] = [];

const VIEWPORT_HEIGHT: Record<number, number> = { 1440: 900, 390: 844 };

// The latin subset as Google Fonts declares it; the same files as in web/fonts.
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const FONT_FACES: { family: string; weight: number; file: string }[] = [
  { family: 'Barlow', weight: 400, file: 'barlow-latin-400-normal.woff2' },
  { family: 'Barlow', weight: 500, file: 'barlow-latin-500-normal.woff2' },
  { family: 'Barlow', weight: 600, file: 'barlow-latin-600-normal.woff2' },
  { family: 'Barlow Semi Condensed', weight: 500, file: 'barlow-semi-condensed-latin-500-normal.woff2' },
  { family: 'Barlow Semi Condensed', weight: 600, file: 'barlow-semi-condensed-latin-600-normal.woff2' },
];

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

function fontCss(origin: string): string {
  return FONT_FACES.map(
    (f) =>
      `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${f.weight}; font-display: swap; ` +
      `src: url(${origin}/__fonts/${f.file}) format('woff2'); unicode-range: ${LATIN}; }`,
  ).join('\n');
}

interface Shot {
  png: PNG;
  layout: LayoutReport;
  blocked: string[];
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.fonts).filter((f) => f.status === 'loading').map((f) => f.loaded));
  });
  // Two frames, so that layout after the font swap is painted.
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
}

async function shoot(
  browser: Browser,
  url: string,
  width: number,
  origin: string,
  opts: { routeGoogleFonts: boolean; mask: string[]; file: string },
): Promise<Shot> {
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const blocked: string[] = [];
  const css = fontCss(origin);
  await context.route('**/*', async (route) => {
    const reqUrl = new URL(route.request().url());
    if (`${reqUrl.protocol}//${reqUrl.host}` === origin || reqUrl.protocol === 'data:') return route.continue();
    if (opts.routeGoogleFonts && reqUrl.host === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    }
    if (!opts.routeGoogleFonts && (reqUrl.host === 'fonts.googleapis.com' || reqUrl.host === 'fonts.gstatic.com')) {
      return route.continue();
    }
    blocked.push(reqUrl.href);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle(page);
  const layout = await page.evaluate(layoutCheck);
  const buffer = await page.screenshot({
    fullPage: true,
    mask: opts.mask.map((s) => page.locator(s)),
    maskColor: '#FF00FF',
  });
  await writeFile(opts.file, buffer);
  await context.close();
  return { png: PNG.sync.read(buffer), layout, blocked };
}

function pad(img: PNG, width: number, height: number, fill: [number, number, number]): Buffer {
  if (img.width === width && img.height === height) return img.data;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = fill[0];
    out[i * 4 + 1] = fill[1];
    out[i * 4 + 2] = fill[2];
    out[i * 4 + 3] = 255;
  }
  for (let y = 0; y < img.height; y++) {
    img.data.copy(out, y * width * 4, y * img.width * 4, (y + 1) * img.width * 4);
  }
  return out;
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
}

function compare(name: string, width: number, ref: PNG, app: PNG, excluded: string[]): { result: Result; diff: PNG } {
  const w = Math.max(ref.width, app.width);
  const h = Math.max(ref.height, app.height);
  const a = pad(ref, w, h, [255, 0, 255]);
  const b = pad(app, w, h, [0, 255, 0]);
  const diff = new PNG({ width: w, height: h });
  // pixelmatch defaults: threshold 0.1 in YIQ space, anti-aliased pixels detected and not counted.
  const differentPixels = pixelmatch(a, b, diff.data, w, h, { threshold: 0.1 });
  const strictDifferentPixels = pixelmatch(a, b, null, w, h, { threshold: 0, includeAA: true });
  const totalPixels = w * h;
  return {
    diff,
    result: {
      page: name,
      width,
      referenceSize: [ref.width, ref.height],
      appSize: [app.width, app.height],
      differentPixels,
      strictDifferentPixels,
      totalPixels,
      percent: (100 * differentPixels) / totalPixels,
      strictPercent: (100 * strictDifferentPixels) / totalPixels,
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
  const server = await startStaticServer([
    { prefix: '/', dir: OUT_DIR },
    { prefix: '/__reference/', dir: REFERENCE_DIR },
    { prefix: '/__fonts/', dir: FONT_DIR },
  ]);
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
          routeGoogleFonts: !args.googleFonts,
          mask: excluded,
          file: join(RESULT_DIR, `${tag}-reference.png`),
        });
        printLayout('reference', ref.layout);
        if (ref.blocked.length) console.log(`  reference: ${ref.blocked.length} requests to other hosts blocked`);
        layouts[`${tag}-reference`] = ref.layout;
        if (args.referenceOnly || !p.app) {
          if (!args.referenceOnly) console.log('  app: page not built yet');
          continue;
        }
        const app = await shoot(browser, `${server.origin}${p.app}`, width, server.origin, {
          routeGoogleFonts: false,
          mask: excluded,
          file: join(RESULT_DIR, `${tag}-app.png`),
        });
        printLayout('app', app.layout);
        layouts[`${tag}-app`] = app.layout;
        appBlocked += app.blocked.length;
        console.log(`  app: requests to other hosts ${app.blocked.length}${app.blocked.length ? ': ' + app.blocked.join(', ') : ''}`);
        const diffFile = join(RESULT_DIR, `${tag}-diff.png`);
        const { result, diff } = compare(p.name, width, ref.png, app.png, excluded);
        await writeFile(diffFile, PNG.sync.write(diff));
        results.push(result);
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
    for (const r of results) console.log(`  ${r.page} ${r.width} px: ${r.percent.toFixed(3)} %`);
  }
  if (!args.referenceOnly) console.log(`Requests of the app to other hosts: ${appBlocked}`);
  if (appBlocked > 0) process.exitCode = 1;
}

await main();
