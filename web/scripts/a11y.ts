// Accessibility check of the built pages (B1): keyboard, visible focus and a full axe-core run.
//
// Keyboard: Tab from the top of the page until focus leaves the page; every link, button and field
// must be reached in document order. For every stop the focus ring is measured: the screenshot of the
// element and its surroundings with focus is compared with the one without focus, and for every changed
// pixel the contrast between the two colours is computed (WCAG 2.2, 2.4.13 asks for at least 3:1 over an
// area at least as large as a 2 px line around the element). Right after each Tab the whole ring must be
// inside the window. The layer buttons are pressed with Space and Enter, the form is sent with Enter.
//
// axe-core: the pinned version of the scanner (node_modules/axe-core), every rule that is on by
// default (WCAG A, AA and best practices), with reduced motion for each of the four layers and once
// without reduced motion after the drawing has finished.
//
//   npm run a11y                     builds web/ first
//   node web/scripts/a11y.ts [--widths 1440,390] [--reference]
//
// --reference runs axe on design/reference/start.html too, for comparison. Results: local/a11y/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { ROOT, VIEWPORT_HEIGHT, nextFrames, routeHosts, settle, startCheckServer } from './browser-setup.ts';

const RESULT_DIR = join(ROOT, 'local', 'a11y');
const AXE_FILE = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
const PAGES = [{ name: 'start', path: '/', reference: 'start.html' }];
const RING_MARGIN = 10; // px around the element: the ring is 3 px wide at an offset of 3 px

interface Args {
  widths: number[];
  reference: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { widths: [1440, 390], reference: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--widths') args.widths = (argv[++i] ?? '').split(',').map(Number).filter((n) => n > 0);
    else if (a === '--reference') args.reference = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

// Runs in the page: a short description of the focused element, or null when focus is on the body.
function activeElement(): { id: string; tag: string; text: string; focusVisible: boolean; outline: string } | null {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const cs = getComputedStyle(el);
  const index = Array.from(document.querySelectorAll(el.tagName)).indexOf(el);
  return {
    id: `${el.tagName.toLowerCase()}#${index}`,
    tag: el.tagName.toLowerCase(),
    text: (el.getAttribute('aria-label') ?? el.textContent ?? (el as HTMLInputElement).placeholder ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
    focusVisible: el.matches(':focus-visible'),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
  };
}

// Runs in the page: every element a keyboard user must reach, in document order.
function controls(): string[] {
  const list = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'));
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

interface RingMeasure {
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

async function newPage(browser: Browser, url: string, width: number, origin: string, reduced: boolean, fonts: 'local' | 'none') {
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

async function keyboard(page: Page, label: string): Promise<{ problems: string[]; stops: unknown[] }> {
  const problems: string[] = [];
  const expected = await page.evaluate(controls);
  const stops: { id: string; text: string; focusVisible: boolean; outline: string; ring: RingMeasure; ringCut: boolean }[] = [];
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
    if (placed.top < -0.5 || placed.bottom > placed.height + 0.5 || placed.left < -0.5 || placed.right > placed.width + 0.5) {
      problems.push(`${label}: ${active.id} "${active.text}" is not fully in view after Tab`);
    }
    const e = placed.ring - 0.5;
    const ringCut = placed.top < e || placed.bottom > placed.height - e || placed.left < e || placed.right > placed.width - e;
    if (ringCut) {
      problems.push(
        `${label}: ${active.id} "${active.text}" focus ring past the edge of the window right after Tab ` +
          `(box ${Math.round(placed.left)}, ${Math.round(placed.top)} to ${Math.round(placed.right)}, ${Math.round(placed.bottom)}; ring ${placed.ring} px)`,
      );
    }
    // The ring itself is measured with the element in the middle of the window; the scroll position
    // of the browser is restored afterwards, so the next Tab starts from where a visitor would be.
    const scroll = await page.evaluate(() => [scrollX, scrollY] as const);
    await page.evaluate(() => document.activeElement!.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await nextFrames(page);
    const handle = await page.evaluateHandle(() => document.activeElement as HTMLElement);
    const box = (await handle.asElement()!.boundingBox())!;
    const clip = {
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
    const ring = measureRing(box, focused, unfocused);
    const file = `focus-${label.replace(/[^a-z0-9]+/gi, '-')}-${active.id.replace('#', '')}`;
    await writeFile(join(RESULT_DIR, `${file}-on.png`), focused);
    await writeFile(join(RESULT_DIR, `${file}-off.png`), unfocused);
    // Back to the element; Chrome keeps the keyboard modality, so the next Tab goes on from here.
    await handle.asElement()!.focus();
    await page.evaluate(([x, y]) => window.scrollTo(x, y), scroll);
    stops.push({ id: active.id, text: active.text, focusVisible: active.focusVisible, outline: active.outline, ring, ringCut });
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

interface AxeSummary {
  state: string;
  violations: { id: string; impact: string | null; nodes: number }[];
  incomplete: { id: string; nodes: number }[];
  passes: number;
  rules: number;
}

async function axe(page: Page, state: string, source: string): Promise<AxeSummary> {
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

interface TextContrast {
  element: string;
  text: string;
  reason: string; // axe's message key, for example bgImage
  required: number; // 4.5, or 3 for large text as axe counts it (24 px, or 18.66 px at weight 700)
  typical: number; // contrast against the most common background pixel behind the text
  lowest: number; // contrast against the lightest background pixel behind the text (a grid line)
  below: number; // background pixels behind the text where the contrast is under `required`
  pixels: number;
}

// axe leaves color-contrast "incomplete" where the background is an image (the blueprint grid). For those
// elements the background is read from a screenshot with all text made transparent: every pixel behind
// the boxes of the element's own text is compared with its text colour. Needs axe in the page.
async function contrastByPixels(page: Page): Promise<TextContrast[]> {
  const items = await page.evaluate(async () => {
    type Node = { target: string[]; any: { data?: { messageKey?: string } }[] };
    const w = window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ incomplete: { nodes: Node[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['incomplete'] });
    return (r.incomplete[0]?.nodes ?? []).map((n) => {
      const el = document.querySelector(n.target[0]!)!;
      const cs = getComputedStyle(el);
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const q of Array.from(range.getClientRects())) rects.push({ x: q.left + scrollX, y: q.top + scrollY, w: q.width, h: q.height });
      }
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66);
      return {
        element: n.target.join(' '),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
        reason: n.any[0]?.data?.messageKey ?? '',
        // SVG text is painted with fill, HTML text with color.
        color: el instanceof SVGElement ? cs.fill : cs.color,
        required: large ? 3 : 4.5,
        rects,
      };
    });
  });
  const style = await page.addStyleTag({
    content:
      '*, *::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; } ' +
      'text, tspan { fill: transparent !important; stroke: transparent !important; }',
  });
  await nextFrames(page);
  const shot = PNG.sync.read(await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }));
  await style.evaluate((el) => (el as HTMLStyleElement).remove());
  return items.map((item) => {
    const fg = (item.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const counts = new Map<string, number>();
    let lowest = Infinity;
    let below = 0;
    let pixels = 0;
    for (const r of item.rects) {
      for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h) && y < shot.height; y++) {
        for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w) && x < shot.width; x++) {
          const i = (y * shot.width + x) * 4;
          const bg = [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
          const c = contrast(fg, bg);
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
      typical: Number(contrast(fg, mode).toFixed(2)),
      lowest: Number((pixels ? lowest : 0).toFixed(2)),
      below,
      pixels,
    };
  });
}

function printContrast(prefix: string, list: TextContrast[]): void {
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
    for (const p of PAGES) {
      for (const width of args.widths) {
        const label = `${p.name} ${width} px`;
        console.log(label);
        // Keyboard and focus.
        const k = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, true, 'none');
        const walk = await keyboard(k.page, label);
        const act = await activation(k.page, label);
        problems = problems.concat(walk.problems, act.problems);
        blocked += k.blocked.length;
        await k.context.close();
        const stops = walk.stops as { id: string; text: string; ring: RingMeasure; ringCut: boolean }[];
        const cut = stops.filter((s) => s.ringCut).map((s) => s.id);
        console.log(`  Tab stops: ${stops.length}; ring past the edge of the window right after Tab: ${cut.length ? cut.join(', ') : 'none'}`);
        for (const s of stops) {
          console.log(
            `    ${s.id.padEnd(10)} ${JSON.stringify(s.text).padEnd(44)} ring ${s.ring.strong} px at >= 3:1 ` +
              `(needs ${s.ring.required}), lowest ${s.ring.minStrongContrast}:1, median ${s.ring.medianContrast}:1`,
          );
        }
        for (const d of act.done) console.log(`  ${d}`);

        // axe-core: each layer with reduced motion, then once with motion after the drawing finished.
        const runs: AxeSummary[] = [];
        let textContrast: TextContrast[] = [];
        const a = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, true, 'none');
        for (const n of [1, 2, 3, 4]) {
          if (n > 1) await a.page.locator('button[aria-pressed]').nth(n - 1).click();
          runs.push(await axe(a.page, `reduced motion, layer ${n}`, axeSource));
          if (n === 1) textContrast = await contrastByPixels(a.page);
        }
        await a.page.locator('#objekt').focus();
        runs.push(await axe(a.page, 'reduced motion, address field focused', axeSource));
        blocked += a.blocked.length;
        await a.context.close();
        const m = await newPage(browser, `${server.origin}${p.path}`, width, server.origin, false, 'none');
        await m.page.evaluate(() => document.getAnimations().forEach((x) => x.finish()));
        runs.push(await axe(m.page, 'motion, drawing finished', axeSource));
        blocked += m.blocked.length;
        await m.context.close();
        for (const r of runs) {
          const v = r.violations.reduce((s, x) => s + x.nodes, 0);
          if (r.violations.length) problems.push(`${label}, ${r.state}: axe violations ${r.violations.map((x) => `${x.id} (${x.nodes})`).join(', ')}`);
          console.log(
            `  axe, ${r.state}: violations ${r.violations.length} (${v} elements), incomplete ${r.incomplete.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}, ` +
              `rules passed ${r.passes} of ${r.rules}`,
          );
        }
        printContrast('color-contrast incomplete, by pixels (layer 1)', textContrast);
        let refRun: AxeSummary | null = null;
        let refContrast: TextContrast[] = [];
        if (args.reference) {
          const r = await newPage(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, true, 'local');
          refRun = await axe(r.page, 'reference, reduced motion, layer 1', axeSource);
          refContrast = await contrastByPixels(r.page);
          printContrast('color-contrast incomplete on the reference, by pixels', refContrast);
          await r.context.close();
          const rk = await newPage(browser, `${server.origin}/__reference/${p.reference}`, width, server.origin, true, 'local');
          const refWalk = await keyboard(rk.page, `reference ${label}`);
          await rk.context.close();
          const refStops = refWalk.stops as { id: string; ringCut: boolean }[];
          console.log(
            `  keyboard on the reference: Tab stops ${refStops.length}, ring partly past the edge right after Tab: ` +
              `${refStops.filter((s) => s.ringCut).map((s) => s.id).join(', ') || 'none'}; problems ${refWalk.problems.length}`,
          );
          console.log(
            `  axe on the reference: violations ${refRun.violations.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}, ` +
              `incomplete ${refRun.incomplete.map((x) => `${x.id} (${x.nodes})`).join(', ') || 0}`,
          );
        }
        report[label] = { stops: walk.stops, activation: act.done, axe: runs, textContrast, reference: refRun, referenceContrast: refContrast };
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

await main();
