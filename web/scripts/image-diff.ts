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

// The report of B3 part 1 has its upper part only: head, Prüfmaße, "Drei Dinge" with the plan and the Zeitschnitt A–A,
// the first four sections of the sheet in bericht.html and in the app. npm run visual, motion and a11y compare that area.
export const REPORT_REGION = 'article section:nth-of-type(4)';

// Runs in the page of design/reference/bericht.html before a screenshot: the one place where a product rule decides
// against the reference. Product rule 3 and Fedor's decision of 23.11.2026 (docs/report-schema.md, conflict 14): an
// accessibility statement the scan did not find is "nicht gefunden" and "bitte manuell prüfen", never "fehlt" and
// "nicht erfüllt". The app follows the rule; so that the comparison measures everything else, the check writes the
// decided wording into that row of the reference (Ist, Ergebnis with the dash of "teilweise"). The file in design/
// stays as it is, and npm run visual prints the difference against the unchanged reference too. Returns the rows changed.
export function decidedWording(): number {
  let changed = 0;
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
