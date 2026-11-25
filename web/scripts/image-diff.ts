// Pixel comparison of two screenshots, shared by npm run visual and npm run motion.
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface ImageDiff {
  diff: PNG;
  width: number;
  height: number;
  differentPixels: number; // pixelmatch defaults: threshold 0.1 in YIQ space, anti-aliased pixels not counted
  strictDifferentPixels: number; // threshold 0, anti-aliased pixels counted
  totalPixels: number;
}

// Pads a smaller image to the common size with one colour, so that every pixel outside the overlap counts.
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

export function diffImages(reference: PNG, app: PNG): ImageDiff {
  const width = Math.max(reference.width, app.width);
  const height = Math.max(reference.height, app.height);
  const a = pad(reference, width, height, [255, 0, 255]);
  const b = pad(app, width, height, [0, 255, 0]);
  const diff = new PNG({ width, height });
  const differentPixels = pixelmatch(a, b, diff.data, width, height, { threshold: 0.1 });
  const strictDifferentPixels = pixelmatch(a, b, null, width, height, { threshold: 0, includeAA: true });
  return { diff, width, height, differentPixels, strictDifferentPixels, totalPixels: width * height };
}

export const percent = (part: number, total: number): string => ((100 * part) / total).toFixed(3);

// The top `height` rows of a screenshot: the area of the blocks a page has so far (the report of B3 part 1 has its
// upper part only), so that the comparison counts that area and nothing below it.
export function cropTop(img: PNG, height: number): PNG {
  const h = Math.max(1, Math.min(img.height, Math.ceil(height)));
  if (h === img.height) return img;
  const out = new PNG({ width: img.width, height: h });
  img.data.copy(out.data, 0, 0, img.width * h * 4);
  return out;
}

// Runs in the page: the bottom of the last block of the compared area, in page coordinates (CSS px = image px at
// deviceScaleFactor 1). Null when the selector finds nothing.
export function regionBottom(selector: string): number | null {
  const el = document.querySelector(selector);
  return el === null ? null : el.getBoundingClientRect().bottom + scrollY;
}

// Session B4 part 1: the report is compared whole. bericht.html shows one finding detail (#fund-1) as the pattern of
// every card: its "Drei Dinge" link to #fund-2 and #fund-3, which the file does not have. The app shows one card per
// priority, so npm run visual and motion hide the app's cards after the first (and print how many) and compare the rest
// of the page; npm run a11y checks every card.
export const EXTRA_CARDS = 'article section[id^="fund-"]:not(#fund-1)';
// Session B5 part 2: the list of manual checks and hints under the cards (Fedor's decision, a state without design); the
// reference has none, so the comparisons of the whole report hide it too (and print how many parts were hidden).
export const EXTRA_PARTS = `${EXTRA_CARDS}, article section[data-part="checks"]`;

// Runs in the page of design/reference/bericht.html after `decidedWording` (session B4 part 1): the data of the example
// where schema v1 cannot hold the data of the reference (docs/report-schema.md, "What is missing"), so that a comparison
// can tell a fault of the page from a gap of the data. The YouTube row of the Stückliste ("erst nach Klick", "wird
// eingeholt": a service that waits for a click, gap 3) is left out, so jsDelivr is position 4 of "4 Dienste gefunden";
// "Google Analytics" of our rules data stands for the reference's "Google Analytics 4" (the scan does not tell the
// version; the other names of the reference are the short names of the rules data since B4 part 2); "Gefunden im
// Quelltext" holds the address of the request, not the tag (gap 2). npm run visual prints this comparison next to the
// one with the decided wording only. Returns the changes made (5 on bericht.html; docs/decisions.md lists them).
export const EXAMPLE_DATA_CHANGES = 5;
export function exampleData(): number {
  let changed = 0;
  const section = Array.from(document.querySelectorAll('section')).find((s) => s.querySelector('h2')?.textContent === 'Stückliste der fremden Dienste');
  if (!section) return 0;
  const count = section.querySelector('.sech .mut');
  if (count?.textContent === '5 Dienste gefunden') {
    count.textContent = '4 Dienste gefunden';
    changed += 1;
  }
  const names: Record<string, string> = { 'Google Analytics 4': 'Google Analytics' };
  for (const tr of Array.from(section.querySelectorAll('tbody tr'))) {
    const b = tr.querySelector('td b');
    const name = b?.textContent ?? '';
    if (name === 'YouTube') {
      tr.remove();
      changed += 1;
      continue;
    }
    if (b && Object.hasOwn(names, name)) {
      b.textContent = names[name]!;
      changed += 1;
    }
    const pos = tr.querySelector('.pos');
    if (pos?.textContent === '5') {
      pos.textContent = '4';
      changed += 1;
    }
  }
  const code = document.querySelector('#fund-1 pre.code');
  const href = /href="([^"]+)"/.exec(code?.textContent ?? '');
  if (code && href) {
    code.textContent = href[1]!;
    changed += 1;
  }
  return changed;
}

// Runs in the page: hides every element of the selector (display none) and returns how many there were.
export function hideAll(selector: string): number {
  const list = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const el of list) el.style.display = 'none';
  return list.length;
}

// Session texts-fix (Fedor's answer 1 of B5 part 1, a deviation from the reference, docs/decisions.md): the question
// cards of the BFSG page that cannot be answered yet are dimmed to 0.8, not 0.45, so that their text reaches 4.5 : 1
// (the cyan "Frage 2" is the weakest: 4.78 : 1 against the plain background); the frame and the disabled buttons keep
// about the look of the reference (0.2 × 0.8 = 0.16 for the 0.35 × 0.45 of the frame, 0.28 × 0.8 = 0.22 for the
// 0.5 × 0.45 of the buttons). The same rules as `.qc.off` in web/components/bfsg/bfsg.module.css, with the class names
// of bfsg.html. npm run visual, motion and a11y put them into the reference (the file in design/ stays as it is), and
// npm run visual prints the difference against the unchanged reference too.
export const DIMMED_CARDS_CSS =
  '.qc.off { opacity: 0.8; border-color: rgba(242, 246, 255, 0.2); } .qc.off .yn:disabled { opacity: 0.28; }';

// Runs in the page of design/reference/bfsg.html: adds the rules above and returns the number of question cards (3).
export function decidedDimming(css: string): number {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return document.querySelectorAll('.qc').length;
}

// Runs in the page of design/reference/bericht.html before a screenshot: the one place where a product rule decides
// against the reference. Product rule 3 and Fedor's decision of 23.11.2026 (docs/report-schema.md, conflict 14): an
// accessibility statement the scan did not find is "nicht gefunden" and "bitte manuell prüfen", never "fehlt" and
// "nicht erfüllt". The app follows the rule; so that the comparison measures everything else, the check writes the
// decided wording into that row of the reference (Ist, Ergebnis with the dash of "teilweise"). The file in design/
// stays as it is, and npm run visual prints the difference against the unchanged reference too. Returns the places changed.
// Session B5 part 2 (Fedor: the three WordPress steps of Google Fonts by the rules of the session of the fix texts): the
// first step in the narrower wording the second check confirmed ("Oft … in den Theme-Einstellungen" had no source;
// the label „Typografie“ is the German WordPress core's, docs/content-drafts.md), so 2 places (DECIDED_CHANGES). The step is an
// argument (WORDPRESS_FONTS_STEP_1), because the function runs in the page.
export const DECIDED_CHANGES = 2;
export const WORDPRESS_FONTS_STEP_1 = {
  reference: 'Finden Sie heraus, ob Ihr Theme oder ein Plugin die Schrift einbindet. Oft steht es in den Theme-Einstellungen unter „Typografie“.',
  decided: 'Finden Sie heraus, ob Ihr Theme oder ein Plugin die Schrift einbindet. Bei Block-Themes stehen die Schriften in den Stilen des Website-Editors unter „Typografie“.',
} as const;
export function decidedWording(step: { reference: string; decided: string }): number {
  let changed = 0;
  for (const li of Array.from(document.querySelectorAll('ol.steps li'))) {
    if (li.textContent !== step.reference) continue;
    li.textContent = step.decided;
    changed += 1;
  }
  for (const tr of Array.from(document.querySelectorAll('table.mt tbody tr'))) {
    const cells = tr.querySelectorAll('td');
    if (cells[0]?.textContent !== 'Erklärung zur Barrierefreiheit') continue;
    const actual = cells[2] as HTMLElement;
    actual.textContent = 'nicht gefunden';
    actual.classList.remove('bad');
    const result = cells[3]?.querySelector('.res');
    if (!result) continue;
    result.className = 'res r-mid';
    result.querySelector('path')?.setAttribute('d', 'M4 9h10');
    if (result.lastChild) result.lastChild.textContent = 'bitte manuell prüfen';
    changed += 1;
  }
  return changed;
}
