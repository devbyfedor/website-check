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
