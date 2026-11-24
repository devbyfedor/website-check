// What the browser checks of web/ share (npm run visual, npm run motion, npm run a11y): the folders,
// the static server with the app, the reference and the font files, the answer to the reference's
// Google Fonts stylesheet and the count of requests to other hosts.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright';
import { startStaticServer, type StaticServer } from './static-server.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_DIR = join(ROOT, 'web', 'out');
export const REFERENCE_DIR = join(ROOT, 'design', 'reference');
export const FONT_DIR = join(ROOT, 'web', 'fonts');

export const VIEWPORT_HEIGHT: Record<number, number> = { 1440: 900, 390: 844 };

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

function fontCss(origin: string): string {
  return FONT_FACES.map(
    (f) =>
      `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${f.weight}; font-display: swap; ` +
      `src: url(${origin}/__fonts/${f.file}) format('woff2'); unicode-range: ${LATIN}; }`,
  ).join('\n');
}

// The app at `/`, the reference at `/__reference/`, the font files at `/__fonts/`.
export function startCheckServer(): Promise<StaticServer> {
  return startStaticServer([
    { prefix: '/', dir: OUT_DIR },
    { prefix: '/__reference/', dir: REFERENCE_DIR },
    { prefix: '/__fonts/', dir: FONT_DIR },
  ]);
}

// How requests to Google Fonts are treated: 'local' answers the reference's stylesheet with the local
// font files, 'google' lets the reference ask Google, 'none' (the app) treats them like any other host.
export type FontRouting = 'local' | 'google' | 'none';

// Lets requests to the check server through and handles Google Fonts by `fonts`; every other request
// to another host is blocked and its address added to the returned list.
export async function routeHosts(context: BrowserContext, origin: string, fonts: FontRouting): Promise<string[]> {
  const blocked: string[] = [];
  const css = fontCss(origin);
  await context.route('**/*', async (route) => {
    const reqUrl = new URL(route.request().url());
    if (`${reqUrl.protocol}//${reqUrl.host}` === origin || reqUrl.protocol === 'data:') return route.continue();
    if (fonts === 'local' && reqUrl.host === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    }
    if (fonts === 'google' && (reqUrl.host === 'fonts.googleapis.com' || reqUrl.host === 'fonts.gstatic.com')) {
      return route.continue();
    }
    blocked.push(reqUrl.href);
    return route.abort('blockedbyclient');
  });
  return blocked;
}

// Waits until every font is loaded and the layout after the font swap is painted.
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.fonts).filter((f) => f.status === 'loading').map((f) => f.loaded));
  });
  await nextFrames(page);
}

// Two animation frames, so that a change is painted before a screenshot.
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
}
