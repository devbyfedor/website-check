// Writes web/app/favicon.ico from web/app/icon.svg (session B5 part 2): the mark of the logo in the header (design/
// reference, `.mk`: the frame, the title block and the tick) on the blue of the paper, so that a browser or a tool that
// asks for /favicon.ico gets an answer instead of a 404. The ICO holds PNG images of 16, 32 and 48 px, drawn by the
// local Chromium of Playwright. Run it again only when the mark changes:
//
//   node web/scripts/make-favicon.ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { ROOT } from './browser-setup.ts';

const SVG = join(ROOT, 'web', 'app', 'icon.svg');
const ICO = join(ROOT, 'web', 'app', 'favicon.ico');
const SIZES = [16, 32, 48];

const svg = await readFile(SVG, 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const pngs: Buffer[] = [];
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    // Chromium writes an opaque screenshot as RGB; Next.js asks for RGBA in an ICO, so the image is written again with alpha.
    const shot = PNG.sync.read(await page.screenshot({ type: 'png' }));
    pngs.push(PNG.sync.write(shot, { colorType: 6 }));
    await page.close();
  }
} finally {
  await browser.close();
}

// ICO: a header of 6 bytes, one entry of 16 bytes per image, then the PNG files (Windows Vista and later read PNG in ICO).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);
let offset = 6 + 16 * SIZES.length;
const entries = SIZES.map((size, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0);
  e.writeUInt8(size === 256 ? 0 : size, 1);
  e.writeUInt8(0, 2); // no palette
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(pngs[i]!.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i]!.length;
  return e;
});
const ico = Buffer.concat([header, ...entries, ...pngs]);
await writeFile(ICO, ico);
console.log(`${ICO}: ${ico.length} bytes, ${SIZES.join(', ')} px`);
