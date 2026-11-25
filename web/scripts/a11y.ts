// Accessibility check of the built pages (B1, B2): keyboard, visible focus and a full axe-core run.
//
// Pages: the home page and the scan screen with the example of the reference.
//
// Keyboard: Tab from the top of the page until focus leaves the page; every link, button and field
// must be reached in document order, the same controls in the same order as on the reference. For
// every stop the focus ring is measured: the screenshot of the element and its surroundings with focus
// is compared with the one without focus, and for every changed pixel the contrast between the two
// colours is computed (WCAG 2.2, 2.4.13 asks for at least 3:1 over an area at least as large as a 2 px
// line around the element). Right after each Tab the whole ring must be inside the window. On the home
// page the layer buttons are pressed with Space and Enter, the form is sent with Enter.
//
// axe-core: the pinned version of the scanner (node_modules/axe-core), every rule that is on by
// default (WCAG A, AA and best practices), with reduced motion (home: for each of the four layers) and
// once without reduced motion after every animation has finished. On the scan screen also, as an
// observation, with motion paused in the middle of the run, in the app and the reference.
//
//   npm run a11y                     builds web/ with the example pages first
//   node web/scripts/a11y.ts [--only start,pruefung] [--widths 1440,390] [--reference]
//
// --reference runs axe on the reference files too, for comparison. Results: local/a11y/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { ROOT, VIEWPORT_HEIGHT, nextFrames, routeHosts, settle, startCheckServer } from './browser-setup.ts';

const RESULT_DIR = join(ROOT, 'local', 'a11y');
const AXE_FILE = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
// `layers`: the home page's four layer buttons and its form. `midRun`: a moment (seconds) at which axe
// also runs with every animation paused, as an observation that does not count.
// `notBuilt`: the parts of the reference the app does not have yet; their controls are left out of the reference's Tab
// order before the orders are compared. `tabs` (session B4 part 1): the page has the system tabs of the report, by the
// WAI-ARIA tabs pattern (brief, B4): the reference gets the same Tab stops before its walk (only the selected tab, and
// the panel), and the arrow keys are tried in the app. `extraInApp`: parts of the app the reference shows only once as
// a pattern (the finding details after the first): their Tab stops are measured but left out of the order comparison.
// `bfsg` (session B5 part 1): the BFSG scheme. Tab is also walked with all three questions open; every path and "Neu
// beginnen" are taken by keyboard in the app and in the reference, and their states compared; axe and the contrast by
// pixels run in the start state and at the end of each of the four paths.
const PAGES: { name: string; path: string; reference: string; layers: boolean; midRun?: number; notBuilt?: string; tabs?: boolean; extraInApp?: string; bfsg?: boolean }[] = [
  { name: 'start', path: '/', reference: 'start.html', layers: true },
  // The scan screen with the example of the reference (the example build, WC_EXAMPLES=1).
  { name: 'pruefung', path: '/pruefung/beispiel', reference: 'pruefung.html', layers: false, midRun: 3.3 },
  // B3 and B4 part 1: the report with the example, the whole page.
  { name: 'bericht', path: '/bericht/beispiel', reference: 'bericht.html', layers: false, tabs: true, extraInApp: 'article section[id^="fund-"]:not(#fund-1)' },
  // B5 part 1: the BFSG page.
  { name: 'bfsg', path: '/bfsg', reference: 'bfsg.html', layers: false, bfsg: true },
];

// The BFSG page: the buttons in the order of the page (0 and 1 "Ja" and "Nein" of question 1, 2 and 3 of question 2, 4
// and 5 of question 3, 6 "Neu beginnen"), the four paths, and the clicks that open all three questions.
const BFSG_PATHS: { name: string; buttons: number[] }[] = [
  { name: 'path 1', buttons: [1] },
  { name: 'path 2', buttons: [0, 2] },
  { name: 'path 3', buttons: [0, 3, 4] },
  { name: 'path 4', buttons: [0, 3, 5] },
];
const BFSG_ALL_OPEN = [0, 3];

// Runs in the page: what the BFSG scheme shows (the same in the app and the reference).
function bfsgState(): string {
  const buttons = Array.from(document.querySelectorAll('section[aria-labelledby="schema-titel"] button'));
  const pressed = buttons.map((b) => (b.getAttribute('aria-pressed') === 'true' ? 'p' : b.hasAttribute('aria-pressed') ? '-' : '')).join('');
  const disabled = buttons.map((b) => ((b as HTMLButtonElement).disabled ? 'd' : '-')).join('');
  // The filled exit: the box of an h3 whose background is the chalk white.
  const hit = Array.from(document.querySelectorAll('section[aria-labelledby="schema-titel"] div'))
    .filter((d) => d.firstElementChild?.tagName === 'H3' && getComputedStyle(d).backgroundColor === 'rgb(242, 246, 255)')
    .map((d) => d.firstElementChild!.textContent)
    .join(' / ');
  const verdict = document.querySelector('[aria-live="polite"]')?.textContent ?? '';
  return `pressed ${pressed}, disabled ${disabled}, exit "${hit}", verdict "${verdict}"`;
}

// Clicks buttons of the BFSG page one by one (one round trip each, so that the app draws the answer before the next).
// By the click of the element, not of the mouse: a mouse click moves the place where the next Tab starts to the button,
// and the walk of the keyboard must start at the top of the page.
async function bfsgClick(page: Page, buttons: number[]): Promise<void> {
  for (const i of buttons) {
    const ok = await page.evaluate((n) => {
      const button = document.querySelectorAll('section[aria-labelledby="schema-titel"] button')[n];
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    }, i);
    if (!ok) throw new Error(`BFSG button ${i} not there or disabled`);
    await nextFrames(page);
  }
}

// Every path and "Neu beginnen" of the BFSG page by keyboard (Enter and Space by turns), in the app and in the reference
// with the same keys; after each key both must show the same state.
async function bfsgKeys(page: Page, ref: Page, label: string): Promise<{ problems: string[]; done: string[] }> {
  const problems: string[] = [];
  const done: string[] = [];
  const keys = ['Enter', 'Space'] as const;
  let k = 0;
  const press = async (i: number) => {
    const key = keys[k++ % 2]!;
    for (const p of [page, ref]) {
      await p.locator('section[aria-labelledby="schema-titel"] button').nth(i).focus();
      await p.keyboard.press(key);
      await nextFrames(p);
    }
    const [a, r] = [await page.evaluate(bfsgState), await ref.evaluate(bfsgState)];
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    return { key, a, r, focused };
  };
  const start = [await page.evaluate(bfsgState), await ref.evaluate(bfsgState)];
  if (start[0] !== start[1]) problems.push(`${label}: start: app ${start[0]}, reference ${start[1]}`);
  for (const path of BFSG_PATHS) {
    for (const i of [...path.buttons, 6]) {
      const s = await press(i);
      done.push(`${path.name}: button ${i} by ${s.key}: ${s.a}${s.a === s.r ? ' (as the reference)' : ''}; focus on "${s.focused}"`);
      if (s.a !== s.r) problems.push(`${label}: ${path.name}, button ${i} by ${s.key}: app ${s.a}, reference ${s.r}`);
    }
  }
  return { problems, done };
}
const RING_MARGIN = 10; // px around the element: the ring is 3 px wide at an offset of 3 px

interface Args {
  only: string[] | null;
  widths: number[];
  reference: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { only: null, widths: [1440, 390], reference: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--widths') args.widths = (argv[++i] ?? '').split(',').map(Number).filter((n) => n > 0);
    else if (a === '--reference') args.reference = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

// Runs in the page: a short description of the focused element, or null when focus is on the body.
function activeElement(): { id: string; tag: string; text: string; key: string; focusVisible: boolean; outline: string } | null {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const cs = getComputedStyle(el);
  const index = Array.from(document.querySelectorAll(el.tagName)).indexOf(el);
  return {
    id: `${el.tagName.toLowerCase()}#${index}`,
    tag: el.tagName.toLowerCase(),
    text: (el.getAttribute('aria-label') ?? el.textContent ?? (el as HTMLInputElement).placeholder ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
    // The whole text without white space, to compare the order with the reference: the reference has line
    // breaks between the parts of a control, React writes none. A box that scrolls sideways (Chrome puts it in the Tab
    // order by itself when nothing in it can take focus) is compared by what it is, not by the whole text inside it.
    // The panel of tabs (B4) is compared by what it is too: the reference's panel holds the hidden steps of every system.
    key: el.matches('[role="tabpanel"]')
      ? '[tab panel]'
      : el.matches('a[href], button, input, select, textarea') || !(['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
        ? (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, '')
        : `[scroll box ${el.tagName.toLowerCase()}]`,
    focusVisible: el.matches(':focus-visible'),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
  };
}

// Runs in the page: the ids (as `activeElement` names them) of every element inside the parts a page does not have yet.
function idsInside(selector: string): string[] {
  const out: string[] = [];
  for (const root of Array.from(document.querySelectorAll(selector))) {
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      out.push(`${el.tagName.toLowerCase()}#${Array.from(document.querySelectorAll(el.tagName)).indexOf(el)}`);
    }
  }
  return out;
}

// Runs in the page: every element a keyboard user must reach, in document order. A box that scrolls sideways with
// nothing in it that can take focus is one too: Chrome makes it focusable, so its content can be scrolled by keyboard.
export function controls(): string[] {
  const focusable = 'a[href], button, input, select, textarea, [tabindex]';
  const list = Array.from(document.querySelectorAll('*')).filter((el) => {
    if (el.matches(focusable)) return true;
    const ox = getComputedStyle(el).overflowX;
    return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.querySelector(focusable) === null;
  });
  return list
    .filter((el) => !(el as HTMLButtonElement).disabled && el.getAttribute('tabindex') !== '-1')
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    })
    .map((el) => `${el.tagName.toLowerCase()}#${Array.from(document.querySelectorAll(el.tagName)).indexOf(el)}`);
}

const luminance = (r: number, g: number, b: number): number => {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a: number[], b: number[]): number => {
  const la = luminance(a[0]!, a[1]!, a[2]!);
  const lb = luminance(b[0]!, b[1]!, b[2]!);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export interface RingMeasure {
  changed: number; // pixels that differ between focused and unfocused
  strong: number; // of them with a contrast of at least 3:1 between the two states
  required: number; // area of a 2 px line around the element (2.4.13)
  minStrongContrast: number;
  medianContrast: number;
}

function measureRing(box: { width: number; height: number }, focused: Buffer, unfocused: Buffer): RingMeasure {
  const a = PNG.sync.read(focused);
  const b = PNG.sync.read(unfocused);
  const ratios: number[] = [];
  for (let i = 0; i < a.width * a.height; i++) {
    const p = [a.data[i * 4]!, a.data[i * 4 + 1]!, a.data[i * 4 + 2]!];
    const q = [b.data[i * 4]!, b.data[i * 4 + 1]!, b.data[i * 4 + 2]!];
    if (p[0] === q[0] && p[1] === q[1] && p[2] === q[2]) continue;
    ratios.push(contrast(p, q));
  }
  ratios.sort((x, y) => x - y);
  const strong = ratios.filter((r) => r >= 3);
  return {
    changed: ratios.length,
    strong: strong.length,
    required: Math.round(2 * 2 * (box.width + box.height) + 16),
    minStrongContrast: strong.length ? Number(strong[0]!.toFixed(2)) : 0,
    medianContrast: ratios.length ? Number(ratios[Math.floor(ratios.length / 2)]!.toFixed(2)) : 0,
  };
}

/**
 * Session B4 part 2: the ring of an element larger than the window, in the window as the browser placed it after Tab:
 * the 2 px line (2.4.13) along the edges of the element that lie in the window, at 3:1. The window's own edges, where
 * the element goes on, carry no ring.
 */
function measureRingInView(p: { top: number; bottom: number; left: number; right: number; height: number; width: number }, focused: Buffer, unfocused: Buffer): RingMeasure {
  const visibleH = Math.max(0, Math.min(p.bottom, p.height) - Math.max(p.top, 0));
  const visibleW = Math.max(0, Math.min(p.right, p.width) - Math.max(p.left, 0));
  const inView = (v: number, max: number) => v >= 0 && v <= max;
  const edges = (inView(p.left, p.width) ? visibleH : 0) + (inView(p.right, p.width) ? visibleH : 0) + (inView(p.top, p.height) ? visibleW : 0) + (inView(p.bottom, p.height) ? visibleW : 0);
  const m = measureRing({ width: 0, height: 0 }, focused, unfocused);
  return { ...m, required: Math.round(2 * edges + 16) };
}

export async function newPage(browser: Browser, url: string, width: number, origin: string, reduced: boolean, fonts: 'local' | 'none') {
  const context = await browser.newContext({
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

export async function keyboard(page: Page, label: string): Promise<{ problems: string[]; stops: unknown[] }> {
  const problems: string[] = [];
  const expected = await page.evaluate(controls);
  const stops: { id: string; text: string; key: string; focusVisible: boolean; outline: string; ring: RingMeasure; ringCut: boolean }[] = [];
  // Tab from the top until focus leaves the page (back to the body or the browser).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < expected.length + 3; i++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(activeElement);
    if (!active) break;
    if (stops.some((s) => s.id === active.id)) break;
    await nextFrames(page);
    // Right after Tab, where the browser scrolled to: the element and its whole ring must be in the
    // window. The ring reaches outline-width plus outline-offset past the box (3 + 3 px); scroll-margin
    // keeps 8 px to the edge (docs/decisions.md, 24.11.2026), so a ring cut by the edge is an error.
    const placed = await page.evaluate(() => {
      const el = document.activeElement!;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: innerHeight, width: innerWidth, ring };
    });
    // Session B4 part 2: an element larger than the window (the box of a Stückliste of 80 rows at 390 px, 9,657 px high)
    // can never be whole in view. For it, Tab must leave it across the window, and its ring is measured along those of
    // its edges that lie in the window (below), with the place where the browser put it.
    // Only taller than the window (review of B4 part 2): its sides and their ring must still be in the window.
    const larger = placed.bottom - placed.top > placed.height - 2 * placed.ring;
    if (larger) {
      if (placed.bottom <= 0 || placed.top >= placed.height || placed.left < placed.ring - 0.5 || placed.right > placed.width - placed.ring + 0.5) {
        problems.push(`${label}: ${active.id} "${active.text}" (taller than the window) is not in view across the window after Tab, or its sides are cut`);
      }
    } else if (placed.top < -0.5 || placed.bottom > placed.height + 0.5 || placed.left < -0.5 || placed.right > placed.width + 0.5) {
      problems.push(`${label}: ${active.id} "${active.text}" is not fully in view after Tab`);
    }
    const e = placed.ring - 0.5;
    const ringCut = !larger && (placed.top < e || placed.bottom > placed.height - e || placed.left < e || placed.right > placed.width - e);
    if (ringCut) {
      problems.push(
        `${label}: ${active.id} "${active.text}" focus ring past the edge of the window right after Tab ` +
          `(box ${Math.round(placed.left)}, ${Math.round(placed.top)} to ${Math.round(placed.right)}, ${Math.round(placed.bottom)}; ring ${placed.ring} px)`,
      );
    }
    // The ring itself is measured with the element in the middle of the window; the scroll position
    // of the browser is restored afterwards, so the next Tab starts from where a visitor would be.
    const scroll = await page.evaluate(() => [scrollX, scrollY] as const);
    if (!larger) await page.evaluate(() => document.activeElement!.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await nextFrames(page);
    const handle = await page.evaluateHandle(() => document.activeElement as HTMLElement);
    const box = (await handle.asElement()!.boundingBox())!;
    const clip = larger
      ? { x: 0, y: 0, width: placed.width, height: placed.height }
      : {
          x: Math.max(0, box.x - RING_MARGIN),
          y: Math.max(0, box.y - RING_MARGIN),
          width: box.width + 2 * RING_MARGIN,
          height: box.height + 2 * RING_MARGIN,
        };
    const focused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    // The same place without focus: blur() moves focus to the body without scrolling.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await nextFrames(page);
    const unfocused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    const ring = larger ? measureRingInView(placed, focused, unfocused) : measureRing(box, focused, unfocused);
    const file = `focus-${label.replace(/[^a-z0-9]+/gi, '-')}-${active.id.replace('#', '')}`;
    await writeFile(join(RESULT_DIR, `${file}-on.png`), focused);
    await writeFile(join(RESULT_DIR, `${file}-off.png`), unfocused);
    // Back to the element; Chrome keeps the keyboard modality, so the next Tab goes on from here.
    await handle.asElement()!.focus();
    await page.evaluate(([x, y]) => window.scrollTo(x, y), scroll);
    stops.push({ id: active.id, text: active.text, key: active.key, focusVisible: active.focusVisible, outline: active.outline, ring, ringCut });
    if (!active.focusVisible) problems.push(`${label}: ${active.id} "${active.text}" has focus without :focus-visible`);
    if (ring.strong < ring.required) {
      problems.push(`${label}: ${active.id} "${active.text}" focus ring ${ring.strong} px at 3:1, needs ${ring.required}`);
    }
  }
  const reached = stops.map((s) => s.id);
  const missing = expected.filter((id) => !reached.includes(id));
  if (missing.length) problems.push(`${label}: not reached by Tab: ${missing.join(', ')}`);
  if (reached.join() !== expected.filter((id) => reached.includes(id)).join()) problems.push(`${label}: Tab order differs from document order`);
  return { problems, stops };
}

// Runs in the page of the reference: the Tab stops of the WAI-ARIA tabs pattern (brief, B4), which the reference does not
// follow (every tab is a Tab stop there, its panel none): only the selected tab and the panel. Returns the tab lists.
function tabsPattern(): number {
  const lists = Array.from(document.querySelectorAll('[role="tablist"]'));
  for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) tab.setAttribute('tabindex', tab.getAttribute('aria-selected') === 'true' ? '0' : '-1');
  for (const panel of Array.from(document.querySelectorAll('[role="tabpanel"]'))) panel.setAttribute('tabindex', '0');
  return lists.length;
}

// The system tabs of the first finding detail by keyboard (WAI-ARIA tabs pattern): the arrow keys, Home and End move to
// a tab and select it, focus and the panel follow, only the selected tab is a Tab stop, Tab goes on to the panel; a
// click selects too.
async function tabKeys(page: Page, label: string): Promise<{ problems: string[]; done: string[] }> {
  const problems: string[] = [];
  const done: string[] = [];
  if ((await page.locator('[role="tablist"]').count()) === 0) {
    problems.push(`${label}: no tab list`);
    return { problems, done };
  }
  const state = () =>
    page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]')!;
      const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
      const panel = document.getElementById(tabs[0]!.getAttribute('aria-controls') ?? '');
      return {
        selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.id).join(','),
        stops: tabs.filter((t) => t.getAttribute('tabindex') === '0').map((t) => t.id).join(','),
        focus: document.activeElement?.id ?? '',
        labelledBy: panel?.getAttribute('aria-labelledby') ?? '',
        step: panel?.querySelector('li, p')?.textContent?.slice(0, 48) ?? '',
      };
    });
  await page.locator('[role="tablist"] [role="tab"][aria-selected="true"]').first().focus();
  const steps = new Map<string, string>();
  steps.set('wordpress', (await state()).step);
  for (const [key, system] of [
    ['ArrowRight', 'shopify'],
    ['ArrowRight', 'wix'],
    ['ArrowRight', 'jimdo'],
    ['End', 'shopware'],
    ['ArrowRight', 'wordpress'],
    ['ArrowLeft', 'shopware'],
    ['Home', 'wordpress'],
  ] as const) {
    await page.keyboard.press(key);
    await nextFrames(page);
    const s = await state();
    steps.set(system, s.step);
    const ok = s.selected.endsWith(`-tab-${system}`) && s.focus === s.selected && s.labelledBy === s.selected && s.stops === s.selected;
    done.push(`tabs: ${key} to ${system}: selected and focused ${ok ? 'yes' : 'NO'}, panel "${s.step}"`);
    if (!ok) problems.push(`${label}: tabs: ${key} should select and focus ${system}: ${JSON.stringify(s)}`);
  }
  if (new Set(steps.values()).size !== steps.size) problems.push(`${label}: tabs: two systems show the same first step`);
  await page.keyboard.press('Tab');
  const role = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName ?? '');
  done.push(`tabs: Tab from the selected tab to: ${role}`);
  if (role !== 'tabpanel') problems.push(`${label}: tabs: Tab from the selected tab went to ${role}, not to the panel`);
  await page.locator('[role="tablist"] [role="tab"]').nth(2).click();
  const clicked = await state();
  done.push(`tabs: click on the third tab: selected ${clicked.selected}`);
  if (!clicked.selected.endsWith('-tab-wix')) problems.push(`${label}: tabs: a click on Wix selected ${clicked.selected}`);
  return { problems, done };
}

// The layer buttons by Space and Enter, the form by Enter in the field and on the button.
async function activation(page: Page, label: string): Promise<{ problems: string[]; done: string[] }> {
  const problems: string[] = [];
  const done: string[] = [];
  const pressed = () => page.evaluate(() => Array.from(document.querySelectorAll('button[aria-pressed]'), (b) => b.getAttribute('aria-pressed')).join(' '));
  const shown = () =>
    page.evaluate(() => {
      const svg = document.querySelector('svg[viewBox="0 0 600 450"]')!;
      return Array.from(svg.querySelectorAll('text'))
        .filter((t) => Number(getComputedStyle(t.parentElement!).opacity) === 1 && t.parentElement!.querySelector('rect'))
        .map((t) => t.textContent)
        .join(' / ');
    });
  for (const [n, key] of [
    [3, 'Space'],
    [4, 'Enter'],
    [2, 'Space'],
    [1, 'Enter'],
  ] as const) {
    await page.locator('button[aria-pressed]').nth(n - 1).focus();
    await page.keyboard.press(key);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    const state = await pressed();
    const expected = [1, 2, 3, 4].map((k) => String(k === n)).join(' ');
    const note = await shown();
    done.push(`layer ${n} by ${key}: aria-pressed "${state}", note "${note}"`);
    if (state !== expected) problems.push(`${label}: layer ${n} by ${key} gave aria-pressed "${state}"`);
  }
  const before = page.url();
  await page.locator('#objekt').focus();
  await page.keyboard.type('ihre-website.de');
  await page.keyboard.press('Enter');
  await page.locator('button[type="submit"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await nextFrames(page);
  const after = page.url();
  done.push(`form: Enter in the field, Enter and Space on "Website prüfen": address ${after === before ? 'unchanged' : `changed to ${after}`}`);
  if (after !== before) problems.push(`${label}: the form navigated to ${after}`);
  return { problems, done };
}

export interface AxeSummary {
  state: string;
  violations: { id: string; impact: string | null; nodes: number }[];
  incomplete: { id: string; nodes: number }[];
  passes: number;
  rules: number;
}

export async function axe(page: Page, state: string, source: string): Promise<AxeSummary> {
  await page.addScriptTag({ content: source });
  const r = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<Record<string, { id: string; impact?: string | null; nodes: unknown[] }[]>> } };
    return w.axe.run(document, { resultTypes: ['violations', 'incomplete'] });
  });
  const pick = (list: { id: string; impact?: string | null; nodes: unknown[] }[]) => list.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length }));
  return {
    state,
    violations: pick(r.violations ?? []),
    incomplete: pick(r.incomplete ?? []).map(({ id, nodes }) => ({ id, nodes })),
    passes: (r.passes ?? []).length,
    rules: (r.violations ?? []).length + (r.passes ?? []).length + (r.incomplete ?? []).length + (r.inapplicable ?? []).length,
  };
}

export interface TextContrast {
  element: string;
  text: string;
  reason: string; // axe's message key, for example bgImage
  required: number; // 4.5, or 3 for large text as axe counts it (24 px, or 18.66 px at weight 700)
  typical: number; // contrast against the most common background pixel behind the text
  lowest: number; // contrast against the lightest background pixel behind the text (a grid line)
  below: number; // background pixels behind the text where the contrast is under `required`
  pixels: number;
  // Session B5 part 1: the text lies in a dimmed part (opacity under 1) whose controls are all disabled, a user
  // interface component that cannot be used yet (a question of the BFSG scheme not reached); WCAG 1.4.3 exempts it.
  inactive?: boolean;
}

// axe leaves color-contrast "incomplete" where the background is an image (the blueprint grid). For those
// elements the background is read from a screenshot with all text made transparent: every pixel behind
// the boxes of the element's own text is compared with its text colour, blended with that pixel by the
// opacity of the element and its ancestors (a step of the scan screen that has not lit up yet is shown
// at 0.32). Paused animations stay where they are. Needs axe in the page.
// Text that axe could not decide ("incomplete"), measured by pixels: its colour against every pixel behind it, with the
// text itself made transparent. A text inside a box that scrolls sideways (the tables and the Zeitschnitt of the report
// at 390 px) is measured with the box scrolled so that the text is whole in view (session B3 part 1): the boxes are
// scrolled by their own width, step by step, and each text is measured at the first step that shows all of it; before,
// a text past the edge of its box was measured against what lay there on the page.
export async function contrastByPixels(page: Page): Promise<TextContrast[]> {
  const { items, steps } = await page.evaluate(async () => {
    type Node = { target: string[]; any: { data?: { messageKey?: string } }[] };
    const w = window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ incomplete: { nodes: Node[] }[] }> }; __wcText: Element[]; __wcBoxes: Element[] };
    const r = await w.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['incomplete'] });
    const nodes = r.incomplete[0]?.nodes ?? [];
    w.__wcText = nodes.map((n) => document.querySelector(n.target[0]!)!);
    w.__wcBoxes = Array.from(document.querySelectorAll('*')).filter((e) => {
      const ox = getComputedStyle(e).overflowX;
      return (ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1;
    });
    const steps = Math.max(1, ...w.__wcBoxes.map((b) => Math.ceil(b.scrollWidth / b.clientWidth)));
    const items = nodes.map((n, i) => {
      const el = w.__wcText[i]!;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66);
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      let dimmed: Element | null = el;
      while (dimmed && Number(getComputedStyle(dimmed).opacity) >= 1) dimmed = dimmed.parentElement;
      const controls = dimmed ? Array.from(dimmed.querySelectorAll('button, input, select, textarea')) : [];
      const inactive = controls.length > 0 && controls.every((c) => (c as HTMLButtonElement).disabled);
      return {
        element: n.target.join(' '),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
        reason: n.any[0]?.data?.messageKey ?? '',
        // SVG text is painted with fill, HTML text with color.
        color: el instanceof SVGElement ? cs.fill : cs.color,
        required: large ? 3 : 4.5,
        opacity,
        inactive,
      };
    });
    return { items, steps };
  });
  const measured: (TextContrast | null)[] = items.map(() => null);
  for (let step = 0; step < steps; step++) {
    const placed = await page.evaluate((k) => {
      const w = window as unknown as { __wcText: Element[]; __wcBoxes: Element[] };
      for (const b of w.__wcBoxes) b.scrollLeft = Math.min(k * b.clientWidth, b.scrollWidth - b.clientWidth);
      return w.__wcText.map((el) => {
        const rects: { x: number; y: number; w: number; h: number }[] = [];
        let whole = true;
        const box = w.__wcBoxes.find((b) => b.contains(el))?.getBoundingClientRect();
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          for (const q of Array.from(range.getClientRects())) {
            rects.push({ x: q.left + scrollX, y: q.top + scrollY, w: q.width, h: q.height });
            if (box && (q.left < box.left - 0.5 || q.right > box.right + 0.5)) whole = false;
          }
        }
        return { rects, whole };
      });
    }, step);
    const style = await page.addStyleTag({
      content:
        '*, *::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; } ' +
        'text, tspan { fill: transparent !important; stroke: transparent !important; }',
    });
    await nextFrames(page);
    const shot = PNG.sync.read(await page.screenshot({ fullPage: true, animations: 'allow', caret: 'hide' }));
    await style.evaluate((el) => (el as HTMLStyleElement).remove());
    items.forEach((item, i) => {
      if (measured[i] !== null || !placed[i]!.whole) return;
      measured[i] = measure(item, placed[i]!.rects, shot);
    });
    // A text no step shows whole (wider than its box) is measured where the last step left it.
    if (step === steps - 1) items.forEach((item, i) => (measured[i] ??= measure(item, placed[i]!.rects, shot)));
  }
  await page.evaluate(() => {
    for (const b of (window as unknown as { __wcBoxes: Element[] }).__wcBoxes) b.scrollLeft = 0;
  });
  return measured.filter((m): m is TextContrast => m !== null);
}

function measure(
  item: { element: string; text: string; reason: string; color: string; required: number; opacity: number; inactive: boolean },
  rects: { x: number; y: number; w: number; h: number }[],
  shot: PNG,
): TextContrast {
  const fg = (item.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const seen = (bg: number[]) => fg.map((v, k) => v * item.opacity + bg[k]! * (1 - item.opacity));
  const counts = new Map<string, number>();
  let lowest = Infinity;
  let below = 0;
  let pixels = 0;
  for (const r of rects) {
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h) && y < shot.height; y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w) && x < shot.width; x++) {
        const i = (y * shot.width + x) * 4;
        const bg = [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
        const c = contrast(seen(bg), bg);
        pixels++;
        if (c < lowest) lowest = c;
        if (c < item.required) below++;
        const key = bg.join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].split(',').map(Number) ?? [0, 0, 0];
  return {
    element: item.element,
    text: item.text,
    reason: item.reason,
    required: item.required,
    typical: Number(contrast(seen(mode), mode).toFixed(2)),
    lowest: Number((pixels ? lowest : 0).toFixed(2)),
    below,
    pixels,
    ...(item.inactive ? { inactive: true } : {}),
  };
}

export function printContrast(prefix: string, list: TextContrast[]): void {
  if (!list.length) return;
  const reasons = [...new Set(list.map((t) => t.reason))].join(', ');
  const worstTypical = list.reduce((a, b) => (b.typical / b.required < a.typical / a.required ? b : a));
  const worstPixel = list.reduce((a, b) => (b.lowest < a.lowest ? b : a));
  const below = list.reduce((s, t) => s + t.below, 0);
  const pixels = list.reduce((s, t) => s + t.pixels, 0);
  const underTypical = list.filter((t) => t.typical < t.required).length;
  console.log(
    `  ${prefix}: ${list.length} elements (${reasons}); against the usual background under the required ratio: ${underTypical}; ` +
      `lowest ${worstTypical.typical}:1 (needs ${worstTypical.required}, "${worstTypical.text}"); ` +
      `on single grid-line pixels lowest ${worstPixel.lowest}:1 ("${worstPixel.text}"), ` +
      `${below} of ${pixels} background pixels behind text (${((100 * below) / Math.max(1, pixels)).toFixed(2)} %) under the required ratio`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(RESULT_DIR, { recursive: true });
  const axeSource = await readFile(AXE_FILE, 'utf8');
  const axeVersion = JSON.parse(await readFile(join(ROOT, 'node_modules', 'axe-core', 'package.json'), 'utf8')).version as string;
  const server = await startCheckServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const report: Record<string, unknown> = { axeVersion };
  let problems: string[] = [];
  let blocked = 0;
  console.log(`axe-core ${axeVersion}`);
  try {
    for (const p of PAGES.filter((x) => !args.only || args.only.includes(x.name))) {
      for (const width of args.widths) {
        const label = `${p.name} ${width} px`;
        console.log(label);
        // Keyboard and focus, on the app and on the reference: the same controls in the same order.
        const k = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, true, 'none');
        const walk = await keyboard(k.page, label);
        const extra = p.extraInApp === undefined ? [] : await k.page.evaluate(idsInside, p.extraInApp);
        const rk = await newPage(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, true, 'local');
        const act = p.layers
          ? await activation(k.page, label)
          : p.tabs
            ? await tabKeys(k.page, label)
            : p.bfsg
              ? await bfsgKeys(k.page, rk.page, label)
              : { problems: [], done: [] };
        problems = problems.concat(walk.problems, act.problems);
        blocked += k.blocked.length;
        await k.context.close();
        await rk.page.reload({ waitUntil: 'networkidle' });
        await settle(rk.page);
        if (p.tabs) console.log(`  reference: the Tab stops of the WAI-ARIA tabs pattern in ${await rk.page.evaluate(tabsPattern)} tab list (only the selected tab and the panel)`);
        const refWalk = await keyboard(rk.page, `reference ${label}`);
        const notBuilt = p.notBuilt === undefined ? [] : await rk.page.evaluate(idsInside, p.notBuilt);
        await rk.context.close();
        // The BFSG page with all three questions open: Tab reaches all six answer buttons, in the order of the reference.
        if (p.bfsg) {
          const open: { stops: { key: string }[]; problems: string[] }[] = [];
          for (const [url, fonts, who] of [
            [`${server.origin}${p.path}`, 'none', label],
            [`${server.origin}/__reference/${p.reference}`, 'local', `reference ${label}`],
          ] as const) {
            const o = await newPage(browser, url, width, server.origin, true, fonts);
            await bfsgClick(o.page, BFSG_ALL_OPEN);
            const w = await keyboard(o.page, `${who}, all three questions open`);
            open.push({ stops: w.stops as { key: string }[], problems: w.problems });
            if (fonts === 'none') blocked += o.blocked.length;
            await o.context.close();
          }
          problems = problems.concat(open[0]!.problems);
          const same = open[0]!.stops.map((s) => s.key).join('\n') === open[1]!.stops.map((s) => s.key).join('\n');
          if (!same) problems.push(`${label}, all three questions open: Tab order differs from the reference`);
          console.log(`  all three questions open: Tab stops ${open[0]!.stops.length}, reference ${open[1]!.stops.length}, ${same ? 'same controls in the same order' : 'ORDER DIFFERS'}; problems ${open[0]!.problems.length}`);
        }
        const allStops = walk.stops as { id: string; text: string; key: string; ring: RingMeasure; ringCut: boolean }[];
        const stops = allStops.filter((s) => !extra.includes(s.id));
        if (p.extraInApp !== undefined) {
          console.log(`  app: ${allStops.length - stops.length} of ${allStops.length} Tab stops are in the finding details after the first (${p.extraInApp}), measured but left out of the order comparison`);
        }
        const allRefStops = refWalk.stops as { id: string; text: string; key: string; ringCut: boolean }[];
        const refStops = allRefStops.filter((s) => !notBuilt.includes(s.id));
        if (p.notBuilt !== undefined) {
          console.log(`  reference: ${allRefStops.length - refStops.length} of ${allRefStops.length} Tab stops are in parts not built yet (${p.notBuilt}), left out of the comparison`);
        }
        const order = stops.map((s) => s.key);
        const refOrder = refStops.map((s) => s.key);
        const sameOrder = order.join('\n') === refOrder.join('\n');
        if (!sameOrder) problems.push(`${label}: Tab order differs from the reference: app ${JSON.stringify(order)}, reference ${JSON.stringify(refOrder)}`);
        const cut = stops.filter((s) => s.ringCut).map((s) => s.id);
        console.log(
          `  Tab stops: ${stops.length}, reference ${refStops.length}, ${sameOrder ? 'same controls in the same order' : 'ORDER DIFFERS'}; ` +
            `ring past the edge of the window right after Tab: ${cut.length ? cut.join(', ') : 'none'} ` +
            `(reference without scroll-margin: ${refStops.filter((s) => s.ringCut).map((s) => s.id).join(', ') || 'none'})`,
        );
        for (const s of stops) {
          console.log(
            `    ${s.id.padEnd(10)} ${JSON.stringify(s.text).padEnd(44)} ring ${s.ring.strong} px at >= 3:1 ` +
              `(needs ${s.ring.required}), lowest ${s.ring.minStrongContrast}:1, median ${s.ring.medianContrast}:1`,
          );
        }
        for (const d of act.done) console.log(`  ${d}`);

        // axe-core with reduced motion (home: each layer and the focused field), then with motion after
        // every animation finished.
        const runs: AxeSummary[] = [];
        let textContrast: TextContrast[] = [];
        const a = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, true, 'none');
        if (p.layers) {
          for (const n of [1, 2, 3, 4]) {
            if (n > 1) await a.page.locator('button[aria-pressed]').nth(n - 1).click();
            runs.push(await axe(a.page, `reduced motion, layer ${n}`, axeSource));
            if (n === 1) textContrast = await contrastByPixels(a.page);
          }
          await a.page.locator('#objekt').focus();
          runs.push(await axe(a.page, 'reduced motion, address field focused', axeSource));
        } else {
          runs.push(await axe(a.page, 'reduced motion', axeSource));
          textContrast = await contrastByPixels(a.page);
        }
        blocked += a.blocked.length;
        await a.context.close();
        // The BFSG page: axe and the contrast by pixels at the end of each path too.
        const pathContrast: Record<string, TextContrast[]> = {};
        if (p.bfsg) {
          for (const path of BFSG_PATHS) {
            const s = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, true, 'none');
            await bfsgClick(s.page, path.buttons);
            runs.push(await axe(s.page, `reduced motion, ${path.name}`, axeSource));
            pathContrast[path.name] = await contrastByPixels(s.page);
            blocked += s.blocked.length;
            await s.context.close();
          }
        }
        const m = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, false, 'none');
        await m.page.evaluate(() => document.getAnimations().forEach((x) => x.finish()));
        runs.push(await axe(m.page, 'motion, every animation finished', axeSource));
        blocked += m.blocked.length;
        await m.context.close();
        // Observation, not counted: the page in the middle of its run, in the app and the reference.
        const midRun: AxeSummary[] = [];
        const midContrast: Record<string, TextContrast[]> = {};
        if (p.midRun !== undefined) {
          for (const [who, url, fonts] of [
            ['app', `${server.origin}${p.path}`, 'none'],
            ['reference', `${server.origin}/__reference/${p.reference}`, 'local'],
          ] as const) {
            const r = await newPage(browser, url, width, server.origin, false, fonts);
            await r.page.evaluate((ms) => document.getAnimations().forEach((x) => (x.finish(), x.pause(), (x.currentTime = ms))), p.midRun * 1000);
            midRun.push(await axe(r.page, `${who}, motion paused at ${p.midRun} s`, axeSource));
            midContrast[who] = await contrastByPixels(r.page);
            if (who === 'app') blocked += r.blocked.length;
            await r.context.close();
          }
        }
        for (const r of runs) {
          const v = r.violations.reduce((s, x) => s + x.nodes, 0);
          if (r.violations.length) problems.push(`${label}, ${r.state}: axe violations ${r.violations.map((x) => `${x.id} (${x.nodes})`).join(', ')}`);
          console.log(
            `  axe, ${r.state}: violations ${r.violations.length} (${v} elements), incomplete ${r.incomplete.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}, ` +
              `rules passed ${r.passes} of ${r.rules}`,
          );
        }
        printContrast(`color-contrast incomplete, by pixels (${p.layers ? 'layer 1' : p.bfsg ? 'reduced motion, start' : 'reduced motion'})`, textContrast);
        for (const [name, list] of Object.entries(pathContrast)) printContrast(`color-contrast incomplete, by pixels (reduced motion, ${name})`, list);
        // The BFSG page (B5): a text under the required ratio against its usual background is a problem, except the text
        // of a question card that cannot be answered yet (dimmed to 45 % with its buttons disabled, as in the reference):
        // WCAG 1.4.3 asks no contrast of the text of an inactive user interface component. Those are listed apart.
        if (p.bfsg) {
          const all: [string, TextContrast[]][] = [['start', textContrast], ...Object.entries(pathContrast)];
          for (const [state, list] of all) {
            for (const t of list.filter((x) => x.typical < x.required)) {
              if (t.inactive) console.log(`    ${state}: "${t.text}" ${t.typical}:1 (needs ${t.required}), in a question card that cannot be answered yet`);
              else problems.push(`${label}, ${state}: "${t.text}" ${t.typical}:1, needs ${t.required}`);
            }
          }
        }
        for (const r of midRun) {
          console.log(
            `  observation, axe ${r.state}: violations ${r.violations.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}, ` +
              `incomplete ${r.incomplete.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}`,
          );
        }
        for (const [who, list] of Object.entries(midContrast)) {
          printContrast(`observation, ${who} at ${p.midRun} s, color-contrast incomplete by pixels`, list);
          const dim = list.filter((t) => t.typical < t.required);
          if (dim.length) console.log(`    under the required ratio: ${dim.map((t) => `"${t.text}" ${t.typical}:1`).join(', ')}`);
        }
        let refRun: AxeSummary | null = null;
        let refContrast: TextContrast[] = [];
        if (args.reference) {
          const r = await newPage(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, true, 'local');
          refRun = await axe(r.page, 'reference, reduced motion', axeSource);
          refContrast = await contrastByPixels(r.page);
          printContrast('color-contrast incomplete on the reference, by pixels', refContrast);
          await r.context.close();
          console.log(
            `  axe on the reference: violations ${refRun.violations.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}, ` +
              `incomplete ${refRun.incomplete.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}`,
          );
        }
        report[label] = {
          stops: walk.stops,
          referenceStops: refWalk.stops,
          activation: act.done,
          axe: runs,
          textContrast,
          midRun,
          midContrast,
          reference: refRun,
          referenceContrast: refContrast,
        };
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  report.problems = problems;
  report.blocked = blocked;
  await writeFile(join(RESULT_DIR, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nRequests of the app to other hosts: ${blocked}`);
  console.log(problems.length ? `Problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'Problems: 0');
  if (problems.length || blocked) process.exitCode = 1;
}

// web/scripts/scan-check.ts uses the functions above without running these checks.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
