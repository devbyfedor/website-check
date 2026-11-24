// Motion check of the home page against design/reference/start.html (B1), without reduced motion:
//
// 1. The list of animations in document order: target element, keyframes, duration, delay, easing,
//    fill mode, and the spread of their start times (all must start together, as in the reference).
// 2. Frames of the drawing at fixed moments: every animation is paused and set to the same time in
//    both pages, then the drawing is photographed and compared pixel by pixel.
// 3. The layer switch: a click on layer 2 in both pages, the transitions paused at fixed moments.
// 4. With reduced motion: no animation and no transition runs, on load and on a layer switch.
//
//   npm run motion                  builds web/ first
//   node web/scripts/motion.ts [--widths 1440,390] [--times 0.6,1.4,2.5,3.45] [--switch-times 0.08,0.16]
//
// Frames and diff images go to local/motion/.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { ROOT, VIEWPORT_HEIGHT, nextFrames, routeHosts, settle, startCheckServer } from './browser-setup.ts';
import { diffImages, percent } from './image-diff.ts';

const RESULT_DIR = join(ROOT, 'local', 'motion');
const DRAWING = 'svg[viewBox="0 0 600 450"]';

interface Args {
  widths: number[];
  times: number[];
  switchTimes: number[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { widths: [1440, 390], times: [0.6, 1.4, 2.5, 3.45], switchTimes: [0.08, 0.16] };
  const list = (v: string | undefined) => (v ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--widths') args.widths = list(argv[++i]);
    else if (a === '--times') args.times = list(argv[++i]);
    else if (a === '--switch-times') args.switchTimes = list(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

interface AnimationInfo {
  kind: string; // CSSAnimation or CSSTransition
  target: string; // tag and the attributes that place the element in the drawing
  property: string; // transitions: the property
  keyframes: string;
  duration: number;
  delay: number;
  easing: string;
  fill: string;
  startTime: number | null;
}

// Runs in the page. Plain JavaScript after type stripping.
function describeAnimations(kind: 'CSSAnimation' | 'CSSTransition'): AnimationInfo[] {
  const attrs = ['d', 'cx', 'cy', 'x', 'y', 'width'];
  const describe = (el: Element | null): string => {
    if (!el) return '?';
    const own = attrs.filter((a) => el.hasAttribute(a)).map((a) => `${a}=${el.getAttribute(a)}`);
    // A group is placed by its first child with a position.
    if (!own.length && el.firstElementChild) return `${el.tagName.toLowerCase()} > ${describe(el.firstElementChild)}`;
    return `${el.tagName.toLowerCase()}[${own.join(' ')}]`;
  };
  return document
    .getAnimations()
    .filter((a) => a.constructor.name === kind)
    .map((a) => {
      const effect = a.effect as KeyframeEffect;
      const t = effect.getTiming();
      const frames = effect.getKeyframes().map((k) => {
        const { offset, computedOffset, easing, composite, ...props } = k as Record<string, unknown>;
        void offset;
        void composite;
        return { at: computedOffset, easing, ...props };
      });
      return {
        kind,
        target: describe(effect.target),
        property: (a as unknown as { transitionProperty?: string }).transitionProperty ?? '',
        keyframes: kind === 'CSSTransition' ? '' : JSON.stringify(frames),
        duration: Number(t.duration),
        delay: t.delay ?? 0,
        easing: t.easing ?? '',
        fill: t.fill ?? '',
        startTime: typeof a.startTime === 'number' ? a.startTime : null,
      };
    });
}

// Runs in the page: pauses every animation of one kind and sets it to the same time.
function freeze([seconds, kind]: readonly [number, 'CSSAnimation' | 'CSSTransition']): number {
  const list = document.getAnimations().filter((a) => a.constructor.name === kind);
  for (const a of list) {
    a.pause();
    a.currentTime = seconds * 1000;
  }
  return list.length;
}

async function open(browser: Browser, url: string, width: number, origin: string, fonts: 'local' | 'none', reduced: boolean) {
  const context: BrowserContext = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const blocked = await routeHosts(context, origin, fonts);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle(page);
  return { context, page, blocked };
}

async function drawingShot(page: Page): Promise<PNG> {
  await nextFrames(page);
  return PNG.sync.read(await page.locator(DRAWING).screenshot({ animations: 'allow', caret: 'initial' }));
}

function sameList(ref: AnimationInfo[], app: AnimationInfo[]): string[] {
  const problems: string[] = [];
  if (ref.length !== app.length) problems.push(`count: reference ${ref.length}, app ${app.length}`);
  for (let i = 0; i < Math.min(ref.length, app.length); i++) {
    const r = ref[i]!;
    const a = app[i]!;
    for (const k of ['target', 'property', 'keyframes', 'duration', 'delay', 'easing', 'fill'] as const) {
      if (r[k] !== a[k]) problems.push(`#${i + 1} ${k}: reference ${r[k]}, app ${a[k]}`);
    }
  }
  return problems;
}

const spread = (list: AnimationInfo[]): number => {
  const starts = list.map((a) => a.startTime).filter((s): s is number => s !== null);
  return starts.length ? Math.max(...starts) - Math.min(...starts) : 0;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(RESULT_DIR, { recursive: true });
  const server = await startCheckServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const refUrl = `${server.origin}/__reference/start.html`;
  const appUrl = `${server.origin}/`;
  let failures = 0;
  const summary: Record<string, unknown> = {};
  try {
    for (const width of args.widths) {
      console.log(`start ${width} px`);
      const ref = await open(browser, refUrl, width, server.origin, 'local', false);
      const app = await open(browser, appUrl, width, server.origin, 'none', false);

      // 1. The list of animations.
      const refList = await ref.page.evaluate(describeAnimations, 'CSSAnimation' as const);
      const appList = await app.page.evaluate(describeAnimations, 'CSSAnimation' as const);
      const listProblems = sameList(refList, appList);
      failures += listProblems.length;
      console.log(
        `  animations: reference ${refList.length}, app ${appList.length}; differences in target, keyframes, ` +
          `duration, delay, easing or fill: ${listProblems.length}; start times spread over ` +
          `reference ${spread(refList).toFixed(1)} ms, app ${spread(appList).toFixed(1)} ms`,
      );
      for (const p of listProblems.slice(0, 10)) console.log(`    ${p}`);
      if (spread(appList) > 0) {
        failures++;
        console.log('    the app animations did not start together');
      }

      // 2. Frames at fixed moments.
      const frames: Record<string, unknown>[] = [];
      for (const t of args.times) {
        const nRef = await ref.page.evaluate(freeze, [t, 'CSSAnimation'] as const);
        const nApp = await app.page.evaluate(freeze, [t, 'CSSAnimation'] as const);
        const a = await drawingShot(ref.page);
        const b = await drawingShot(app.page);
        const d = diffImages(a, b);
        const tag = `start-${width}-t${t.toFixed(2)}`;
        await writeFile(join(RESULT_DIR, `${tag}-reference.png`), PNG.sync.write(a));
        await writeFile(join(RESULT_DIR, `${tag}-app.png`), PNG.sync.write(b));
        await writeFile(join(RESULT_DIR, `${tag}-diff.png`), PNG.sync.write(d.diff));
        frames.push({ t, paused: [nRef, nApp], size: [d.width, d.height], ...d, diff: undefined });
        console.log(
          `  t = ${t.toFixed(2)} s: drawing ${d.width} x ${d.height}, different pixels ${percent(d.differentPixels, d.totalPixels)} % ` +
            `(${d.differentPixels}), strict ${percent(d.strictDifferentPixels, d.totalPixels)} % (${d.strictDifferentPixels})`,
        );
      }

      // 3. The layer switch: all reveal animations finished, then a click on layer 2.
      for (const p of [ref.page, app.page]) {
        await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
        await p.locator('button[aria-pressed]').nth(1).click();
      }
      const refTr = await ref.page.evaluate(describeAnimations, 'CSSTransition' as const);
      const appTr = await app.page.evaluate(describeAnimations, 'CSSTransition' as const);
      const trProblems = sameList(refTr, appTr);
      failures += trProblems.length;
      console.log(`  layer 2 clicked: transitions reference ${refTr.length}, app ${appTr.length}; differences ${trProblems.length}`);
      for (const p of trProblems.slice(0, 10)) console.log(`    ${p}`);
      const switches: Record<string, unknown>[] = [];
      for (const t of args.switchTimes) {
        await ref.page.evaluate(freeze, [t, 'CSSTransition'] as const);
        await app.page.evaluate(freeze, [t, 'CSSTransition'] as const);
        const a = await drawingShot(ref.page);
        const b = await drawingShot(app.page);
        const d = diffImages(a, b);
        const tag = `switch-${width}-t${t.toFixed(2)}`;
        await writeFile(join(RESULT_DIR, `${tag}-reference.png`), PNG.sync.write(a));
        await writeFile(join(RESULT_DIR, `${tag}-app.png`), PNG.sync.write(b));
        await writeFile(join(RESULT_DIR, `${tag}-diff.png`), PNG.sync.write(d.diff));
        switches.push({ t, ...d, diff: undefined });
        console.log(
          `  switch + ${t.toFixed(2)} s: different pixels ${percent(d.differentPixels, d.totalPixels)} % (${d.differentPixels}), ` +
            `strict ${percent(d.strictDifferentPixels, d.totalPixels)} % (${d.strictDifferentPixels})`,
        );
      }
      const blocked = app.blocked.length;
      if (blocked) failures++;
      await ref.context.close();
      await app.context.close();

      // 4. Reduced motion: nothing moves, on load and on a switch.
      const still: Record<string, number> = {};
      for (const [name, url, fonts] of [
        ['reference', refUrl, 'local'],
        ['app', appUrl, 'none'],
      ] as const) {
        const r = await open(browser, url, width, server.origin, fonts, true);
        const onLoad = await r.page.evaluate(() => document.getAnimations().length);
        await r.page.locator('button[aria-pressed]').nth(2).click();
        const onSwitch = await r.page.evaluate(() => document.getAnimations().length);
        still[`${name}OnLoad`] = onLoad;
        still[`${name}OnSwitch`] = onSwitch;
        if (name === 'app' && onLoad + onSwitch > 0) failures++;
        await r.context.close();
      }
      console.log(
        `  reduced motion: animations on load reference ${still.referenceOnLoad}, app ${still.appOnLoad}; ` +
          `after a switch reference ${still.referenceOnSwitch}, app ${still.appOnSwitch}`,
      );
      console.log(`  app requests to other hosts: ${blocked}`);
      summary[width] = { refList, appList, listProblems, frames, refTr, appTr, trProblems, switches, still, blocked };
    }
  } finally {
    await browser.close();
    await server.close();
  }
  await writeFile(join(RESULT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nFrames and diff images: ${RESULT_DIR}`);
  console.log(failures ? `Problems: ${failures}` : 'No differences in the animation lists; app animations start together.');
  if (failures) process.exitCode = 1;
}

await main();
