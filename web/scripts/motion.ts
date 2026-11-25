// Motion check of the built pages against their reference files (B1, B2), without reduced motion:
//
// 1. The list of animations in document order: target element, keyframes, duration, delay, easing,
//    fill mode, and the spread of their start times (all must start together, as in the reference).
// 2. Frames at fixed moments, on pages whose animations are paused from the first style on: every
//    animation is set to the same time in both pages, then the drawing (home) or the whole page (scan
//    screen) is photographed and compared pixel by pixel; at each moment the page must not scroll sideways.
// 3. Home only, the layer switch: a click on layer 2 in both pages, the transitions paused at fixed moments.
// 4. With reduced motion: no animation and no transition runs, on load (and, on the home page, on a switch).
// 5. Session B5 part 1, the BFSG page: nothing moves on load; its only motion is the transitions of 0.2 s of the
//    question cards and the exits when an answer is given. Both pages get the same clicks, one after the other along
//    every path and "Neu beginnen"; after each click the transitions are paused at once, compared (target by its text,
//    property, duration, delay, easing), and the scheme is photographed at fixed moments. With reduced motion no
//    transition runs after a click.
//
//   npm run motion                  builds web/ with the example pages first
//   node web/scripts/motion.ts [--only start,pruefung,bericht,bfsg] [--widths 1440,390] [--times 0.6,1.4] [--switch-times 0.08,0.16]
//
// --times replaces the moments of every page checked. Frames and diff images go to local/motion/.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { printConsoleLog, ROOT, VIEWPORT_HEIGHT, nextFrames, routeHosts, settle, startCheckServer } from './browser-setup.ts';
import { cropTop, decidedDimming, DECIDED_CHANGES, decidedWording, diffImages, DIMMED_CARDS_CSS, EXAMPLE_DATA_CHANGES, exampleData, EXTRA_PARTS, hideAll, WORDPRESS_FONTS_STEP_1, percent, regionBottom } from './image-diff.ts';

const RESULT_DIR = join(ROOT, 'local', 'motion');
const DRAWING = 'svg[viewBox="0 0 600 450"]';
const MAX_FRAME_PERCENT = 1; // session message of B2 part 1: frames at the same moment differ by at most 1 %

interface PageSpec {
  name: string;
  reference: string;
  app: string;
  times: number[]; // seconds after loading
  shot: string | null; // the part photographed; null for the whole page
  layers: boolean; // the four layer buttons of the home page
  region?: string; // the whole page down to the bottom of this block only (a page built in part, as in npm run visual)
  decided?: boolean; // the reference gets the wording a product rule decides before its frames (image-diff.ts, decidedWording)
  hideInApp?: string; // elements of the app the reference shows only once as a pattern, hidden before the frames (image-diff.ts)
  // the reference's frames get the data of the example where schema v1 cannot hold the reference's (image-diff.ts,
  // exampleData): motion compares motion; the difference of the data is measured by npm run visual
  exampleData?: boolean;
  // Session B5 part 1: the page has no animation on load, only transitions after a click: the buttons (their index
  // among the page's buttons, the same in both pages) clicked one after the other, the part photographed after each
  // click, and the moments (seconds after the click) of its frames.
  clicks?: { buttons: { index: number; label: string }[]; shot: string; times: number[] };
  // Session texts-fix: rules of a decided deviation put into the reference before its transitions and frames
  // (image-diff.ts, DIMMED_CARDS_CSS: the question cards that cannot be answered yet, dimmed to 0.8).
  css?: string;
}

// The six answer buttons and "Neu beginnen" of the BFSG page, in the order of the page (bfsg.html).
const BFSG_BUTTONS = ['1 Ja', '1 Nein', '2 Ja', '2 Nein', '3 Ja', '3 Nein', 'Neu beginnen'];
const bfsgButton = (label: string) => ({ index: BFSG_BUTTONS.indexOf(label), label });

const PAGES: PageSpec[] = [
  { name: 'start', reference: 'start.html', app: '/', times: [0.6, 1.4, 2.5, 3.45], shot: DRAWING, layers: true },
  // The scan screen with the example of the reference: the drawing, the steps, the marks and the
  // "Bericht öffnen" panel up to 7.8 s, each phase hit at least once.
  {
    name: 'pruefung',
    reference: 'pruefung.html',
    app: '/pruefung/beispiel',
    times: [0.35, 1.2, 2.3, 3.3, 4.2, 5.0, 5.6, 6.1, 6.6, 7.0, 7.6, 8.0],
    shot: null,
    layers: false,
  },
  // The report with the example of the reference, the whole page (B3, B4): the three red marks of the plan and their
  // numbers draw from 0.4 to 2.35 s; each phase hit at least once. The lower part has no animation.
  {
    name: 'bericht',
    reference: 'bericht.html',
    app: '/bericht/beispiel',
    times: [0.3, 0.6, 0.9, 1.15, 1.3, 1.5, 1.75, 2.0, 2.2, 2.5],
    shot: null,
    layers: false,
    decided: true,
    hideInApp: EXTRA_PARTS,
    exampleData: true,
  },
  // Session B5 part 1: the BFSG scheme. The clicks walk every path, every card state and every exit, and back: 1 Ja
  // (card 1 answered, card 2 to answer), 2 Nein, 3 Nein (exit 4), 3 Ja (exit 4 to exit 3), 2 Ja (card 3 dimmed again,
  // exit 2), 1 Nein (exit 1), Neu beginnen.
  {
    name: 'bfsg',
    reference: 'bfsg.html',
    app: '/bfsg',
    css: DIMMED_CARDS_CSS,
    times: [],
    shot: null,
    layers: false,
    clicks: {
      buttons: ['1 Ja', '2 Nein', '3 Nein', '3 Ja', '2 Ja', '1 Nein', 'Neu beginnen'].map(bfsgButton),
      shot: 'section[aria-labelledby="schema-titel"]',
      times: [0, 0.05, 0.1, 0.15, 0.2],
    },
  },
];

interface Args {
  only: string[] | null;
  widths: number[];
  times: number[] | null;
  switchTimes: number[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { only: null, widths: [1440, 390], times: null, switchTimes: [0.08, 0.16] };
  const list = (v: string | undefined) => (v ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--widths') args.widths = list(argv[++i]);
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
        // The CSS minifier of the build writes translateX(x) as translate(x), the same transform.
        keyframes: kind === 'CSSTransition' ? '' : JSON.stringify(frames).replace(/translateX\(([^,)]+)\)/g, 'translate($1)'),
        duration: Number(t.duration),
        delay: t.delay ?? 0,
        easing: t.easing ?? '',
        fill: t.fill ?? '',
        startTime: typeof a.startTime === 'number' ? a.startTime : null,
      };
    });
}

// Runs in the page (session B5 part 1): clicks a button (by its index among the buttons of the page), waits until the
// page has applied the answer (the reference at once, React in a microtask after the click), then pauses every
// transition the change started at its beginning and keeps them for `freezeClicked`. Returns how many there are,
// or -1 without such a button.
async function clickAndPause(index: number): Promise<number> {
  const button = document.querySelectorAll('button')[index];
  if (!(button instanceof HTMLButtonElement)) return -1;
  await new Promise<void>((done) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      done();
    });
    observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
    button.click();
    setTimeout(() => {
      observer.disconnect();
      done();
    }, 100);
  });
  const list = document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition');
  for (const a of list) {
    a.pause();
    a.currentTime = 0;
  }
  (window as unknown as { __wcClicked: Animation[] }).__wcClicked = list;
  return list.length;
}

// Runs in the page: the transitions kept by `clickAndPause`, the target named by its tag and text (the elements of the
// scheme have no attributes that place them, and the class names of the app are those of its CSS modules).
function describeClicked(): AnimationInfo[] {
  return (window as unknown as { __wcClicked: Animation[] }).__wcClicked.map((a) => {
    const effect = a.effect as KeyframeEffect;
    const t = effect.getTiming();
    const el = effect.target;
    return {
      kind: 'CSSTransition',
      target: el ? `${el.tagName.toLowerCase()} "${(el.textContent ?? '').replace(/\s+/g, '').slice(0, 40)}"` : '?',
      property: (a as unknown as { transitionProperty?: string }).transitionProperty ?? '',
      keyframes: '',
      duration: Number(t.duration),
      delay: t.delay ?? 0,
      easing: t.easing ?? '',
      fill: t.fill ?? '',
      startTime: null,
    };
  });
}

// Runs in the page: sets the kept transitions to one moment, or finishes them (null).
function freezeClicked(seconds: number | null): number {
  const list = (window as unknown as { __wcClicked: Animation[] }).__wcClicked;
  for (const a of list) {
    if (seconds === null) a.finish();
    else a.currentTime = seconds * 1000;
  }
  return list.length;
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

// Runs before any script of the page: pauses every CSS animation from the first style on, so that a
// frame does not depend on how far each page has played in real time (the reference loads slower). Session B5 part 2: a
// constructed style sheet of the document, which the CSP of our pages allows (a <style> element it refuses).
function pauseFromStart(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('*, *::before, *::after { animation-play-state: paused !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

async function open(
  browser: Browser,
  url: string,
  width: number,
  origin: string,
  fonts: 'local' | 'none',
  reduced: boolean,
  paused = false,
) {
  const context: BrowserContext = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  if (paused) await context.addInitScript(pauseFromStart);
  const blocked = await routeHosts(context, origin, fonts);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle(page);
  if (paused) {
    // Lays the page out and paints it once more from scratch, now that every font is loaded. Without it
    // the reference often painted the bottom borders of two steps of the scan screen 1 px off its own
    // still state (0.119 % of the page at 1440 px, the app matching the still state); probably because
    // the reference gets its fonts after the first paint, when those steps already had a layer of their
    // own. The animations are paused and set to each moment afterwards, so starting them again changes nothing.
    await page.evaluate(() => {
      document.body.style.display = 'none';
      void document.body.offsetHeight;
      document.body.style.display = '';
    });
    await nextFrames(page);
  }
  return { context, page, blocked };
}

async function shot(page: Page, selector: string | null, region?: string): Promise<PNG> {
  await nextFrames(page);
  const buffer = selector
    ? await page.locator(selector).screenshot({ animations: 'allow', caret: 'initial' })
    : await page.screenshot({ fullPage: true, animations: 'allow', caret: 'initial' });
  const png = PNG.sync.read(buffer);
  if (region === undefined) return png;
  const bottom = await page.evaluate(regionBottom, region);
  if (bottom === null) throw new Error(`no element ${region}`);
  return cropTop(png, bottom);
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

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

async function checkPage(browser: Browser, origin: string, spec: PageSpec, width: number, args: Args): Promise<{ failures: number; summary: unknown }> {
  let failures = 0;
  const refUrl = `${origin}/__reference/${spec.reference}`;
  const appUrl = `${origin}${spec.app}`;
  const ref = await open(browser, refUrl, width, origin, 'local', false);
  if (spec.css !== undefined) {
    const cards = await ref.page.evaluate(decidedDimming, spec.css);
    if (cards !== 3) failures++;
    console.log(`  reference with the question cards dimmed as decided (Fedor, answer 1 of B5 part 1): ${cards} cards`);
  }
  const app = await open(browser, appUrl, width, origin, 'none', false);

  // 0. In real time, right after the page is ready: how many animations run and their clock.
  const live = async (p: Page) =>
    p.evaluate(() => {
      const list = document.getAnimations();
      const running = list.filter((x) => x.playState === 'running').length;
      const clock = Math.round(Number(list[0]?.currentTime ?? 0));
      return { total: list.length, running, clock };
    });
  const liveRef = await live(ref.page);
  const liveApp = await live(app.page);
  console.log(
    `  in real time after loading: reference ${liveRef.running} of ${liveRef.total} running at ${liveRef.clock} ms, ` +
      `app ${liveApp.running} of ${liveApp.total} running at ${liveApp.clock} ms`,
  );
  // The BFSG page (B5) has no animation on load, like its reference; the other pages start theirs at once.
  if (spec.clicks ? liveApp.total !== liveRef.total : liveApp.running === 0) failures++;

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

  // 2. Frames at fixed moments, on a second pair of pages paused from the start, and no sideways
  // scrolling at any of them.
  const frames: Record<string, unknown>[] = [];
  const part = spec.shot ? 'drawing' : spec.region ? 'blocks of the page so far' : 'page';
  const refF = await open(browser, refUrl, width, origin, 'local', false, true);
  if (spec.css !== undefined && (await refF.page.evaluate(decidedDimming, spec.css)) !== 3) failures++;
  const appF = await open(browser, appUrl, width, origin, 'none', false, true);
  if (spec.decided) {
    const rows = await refF.page.evaluate(decidedWording, WORDPRESS_FONTS_STEP_1);
    if (rows !== DECIDED_CHANGES) failures++;
    console.log(`  frames of the reference with the decided wording of the row "Erklärung zur Barrierefreiheit" (product rule 3) and of the first WordPress step of Google Fonts (B5 part 2): ${rows} places`);
  }
  if (spec.exampleData) {
    const n = await refF.page.evaluate(exampleData);
    if (n !== EXAMPLE_DATA_CHANGES) failures++;
    console.log(`  frames of the reference with the data of the example where schema v1 cannot hold the reference's (${n} changes: the Stückliste without the YouTube row, "Google Analytics" for "Google Analytics 4", the address in "Gefunden im Quelltext")`);
  }
  if (spec.hideInApp !== undefined) {
    const n = await appF.page.evaluate(hideAll, spec.hideInApp);
    console.log(`  frames of the app with ${n} parts hidden: the finding details after the first (the reference shows one card as the pattern) and the list of manual checks and hints (B5 part 2)`);
  }
  for (const t of args.times ?? spec.times) {
    const nRef = await refF.page.evaluate(freeze, [t, 'CSSAnimation'] as const);
    const nApp = await appF.page.evaluate(freeze, [t, 'CSSAnimation'] as const);
    const a = await shot(refF.page, spec.shot, spec.region);
    const b = await shot(appF.page, spec.shot, spec.region);
    const scroll = [await sideways(refF.page), await sideways(appF.page)];
    const d = diffImages(a, b);
    const tag = `${spec.name}-${width}-t${t.toFixed(2)}`;
    await writeFile(join(RESULT_DIR, `${tag}-reference.png`), PNG.sync.write(a));
    await writeFile(join(RESULT_DIR, `${tag}-app.png`), PNG.sync.write(b));
    await writeFile(join(RESULT_DIR, `${tag}-diff.png`), PNG.sync.write(d.diff));
    frames.push({ t, paused: [nRef, nApp], scroll, size: [d.width, d.height], ...d, diff: undefined });
    const share = (100 * d.differentPixels) / d.totalPixels;
    if (share > MAX_FRAME_PERCENT) failures++;
    if (scroll[1]! > 0) failures++;
    console.log(
      `  t = ${t.toFixed(2)} s: ${part} ${d.width} x ${d.height}, different pixels ${percent(d.differentPixels, d.totalPixels)} % ` +
        `(${d.differentPixels}), strict ${percent(d.strictDifferentPixels, d.totalPixels)} % (${d.strictDifferentPixels}); ` +
        `sideways scrolling reference ${scroll[0]} px, app ${scroll[1]} px`,
    );
  }
  const framesBlocked = appF.blocked.length;
  await refF.context.close();
  await appF.context.close();

  // 3. Home: the layer switch, all reveal animations finished, then a click on layer 2.
  let layerSummary: Record<string, unknown> = {};
  if (spec.layers) {
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
      const a = await shot(ref.page, DRAWING);
      const b = await shot(app.page, DRAWING);
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
    // Every layer in turn: the drawing after the transitions and the aria-pressed states.
    const layers: Record<string, unknown>[] = [];
    for (const n of [2, 3, 4, 1]) {
      const pressed: string[] = [];
      for (const p of [ref.page, app.page]) {
        await p.locator('button[aria-pressed]').nth(n - 1).click();
        await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
        pressed.push(await p.evaluate(() => Array.from(document.querySelectorAll('button[aria-pressed]'), (b) => b.getAttribute('aria-pressed')).join(' ')));
      }
      const a = await shot(ref.page, DRAWING);
      const b = await shot(app.page, DRAWING);
      const d = diffImages(a, b);
      await writeFile(join(RESULT_DIR, `layer-${width}-${n}-diff.png`), PNG.sync.write(d.diff));
      const expected = [1, 2, 3, 4].map((k) => String(k === n)).join(' ');
      if (pressed[0] !== expected || pressed[1] !== expected) failures++;
      if (d.differentPixels > 0) failures++;
      layers.push({ layer: n, pressed, ...d, diff: undefined });
      console.log(
        `  layer ${n} after its transitions: different pixels ${percent(d.differentPixels, d.totalPixels)} % (${d.differentPixels}), ` +
          `strict ${percent(d.strictDifferentPixels, d.totalPixels)} %; aria-pressed reference "${pressed[0]}", app "${pressed[1]}"`,
      );
    }
    layerSummary = { refTr, appTr, trProblems, switches, layers };
  }
  // 5. The BFSG page (session B5 part 1): the same clicks in both pages, the transitions of each click and its frames.
  let clickSummary: Record<string, unknown> = {};
  if (spec.clicks) {
    const c = spec.clicks;
    const steps: Record<string, unknown>[] = [];
    let frameCount = 0;
    let worst = 0;
    for (const button of c.buttons) {
      const nRef = await ref.page.evaluate(clickAndPause, button.index);
      const nApp = await app.page.evaluate(clickAndPause, button.index);
      const refTr = await ref.page.evaluate(describeClicked);
      const appTr = await app.page.evaluate(describeClicked);
      const trProblems = sameList(refTr, appTr);
      if (nRef < 0 || nApp < 0) trProblems.push(`no button ${button.label}`);
      failures += trProblems.length;
      const shares: number[] = [];
      for (const t of c.times) {
        await ref.page.evaluate(freezeClicked, t);
        await app.page.evaluate(freezeClicked, t);
        const a = await shot(ref.page, c.shot);
        const b = await shot(app.page, c.shot);
        const scroll = [await sideways(ref.page), await sideways(app.page)];
        const d = diffImages(a, b);
        const tag = `${spec.name}-${width}-${button.label.replace(/\s+/g, '-').toLowerCase()}-t${t.toFixed(2)}`;
        await writeFile(join(RESULT_DIR, `${tag}-reference.png`), PNG.sync.write(a));
        await writeFile(join(RESULT_DIR, `${tag}-app.png`), PNG.sync.write(b));
        await writeFile(join(RESULT_DIR, `${tag}-diff.png`), PNG.sync.write(d.diff));
        const share = (100 * d.differentPixels) / d.totalPixels;
        shares.push(share);
        frameCount++;
        worst = Math.max(worst, share);
        if (share > MAX_FRAME_PERCENT) failures++;
        if (scroll[1]! > 0) failures++;
      }
      await ref.page.evaluate(freezeClicked, null);
      await app.page.evaluate(freezeClicked, null);
      steps.push({ button: button.label, refTr, appTr, trProblems, shares });
      const kinds = [...new Set(appTr.map((x) => x.property))].join(', ');
      console.log(
        `  click "${button.label}": transitions reference ${refTr.length}, app ${appTr.length} (${kinds || 'none'}; ` +
          `${[...new Set(appTr.map((x) => `${x.duration} ms ${x.easing}, delay ${x.delay} ms`))].join('; ') || '-'}); differences ${trProblems.length}; ` +
          `frames at ${c.times.map((t) => `${t.toFixed(2)} s`).join(', ')}: ${shares.map((x) => `${x.toFixed(3)} %`).join(', ')}`,
      );
      for (const p of trProblems.slice(0, 10)) console.log(`    ${p}`);
    }
    console.log(`  clicks: ${c.buttons.length}, frames ${frameCount}, the largest difference ${worst.toFixed(3)} % (at most ${MAX_FRAME_PERCENT} %)`);
    clickSummary = { clicks: steps };
  }
  const blocked = app.blocked.length + framesBlocked;
  if (blocked) failures++;
  await ref.context.close();
  await app.context.close();

  // 4. Reduced motion: nothing moves, on load and (home) on a switch.
  const still: Record<string, number> = {};
  for (const [name, url, fonts] of [
    ['reference', refUrl, 'local'],
    ['app', appUrl, 'none'],
  ] as const) {
    const r = await open(browser, url, width, origin, fonts, true);
    const onLoad = await r.page.evaluate(() => document.getAnimations().length);
    still[`${name}OnLoad`] = onLoad;
    if (spec.layers) {
      await r.page.locator('button[aria-pressed]').nth(2).click();
      still[`${name}OnSwitch`] = await r.page.evaluate(() => document.getAnimations().length);
    }
    // The BFSG page: every click of the walk; the transitions each one starts are counted.
    if (spec.clicks) {
      let n = 0;
      for (const button of spec.clicks.buttons) n += Math.max(0, await r.page.evaluate(clickAndPause, button.index));
      still[`${name}OnSwitch`] = n;
    }
    if (name === 'app' && onLoad + (still.appOnSwitch ?? 0) > 0) failures++;
    await r.context.close();
  }
  console.log(
    `  reduced motion: animations on load reference ${still.referenceOnLoad}, app ${still.appOnLoad}` +
      (spec.layers ? `; after a switch reference ${still.referenceOnSwitch}, app ${still.appOnSwitch}` : '') +
      (spec.clicks ? `; transitions after the ${spec.clicks.buttons.length} clicks reference ${still.referenceOnSwitch}, app ${still.appOnSwitch}` : ''),
  );
  console.log(`  app requests to other hosts: ${blocked}`);
  return { failures, summary: { refList, appList, listProblems, frames, ...layerSummary, ...clickSummary, still, blocked } };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(RESULT_DIR, { recursive: true });
  const server = await startCheckServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  let failures = 0;
  const summary: Record<string, unknown> = {};
  try {
    for (const spec of PAGES.filter((p) => !args.only || args.only.includes(p.name))) {
      for (const width of args.widths) {
        console.log(`${spec.name} ${width} px`);
        const r = await checkPage(browser, server.origin, spec, width, args);
        failures += r.failures;
        summary[`${spec.name}-${width}`] = r.summary;
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  await writeFile(join(RESULT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nFrames and diff images: ${RESULT_DIR}`);
  console.log(failures ? `Problems: ${failures}` : 'No differences in the animation lists; app animations start together.');
  // Session B5 part 2: the CSP of production holds on every page of the app.
  if (printConsoleLog() > 0) failures++;
  if (failures) process.exitCode = 1;
}

await main();
