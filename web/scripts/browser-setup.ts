// What the browser checks of web/ share (npm run visual, npm run motion, npm run a11y): the folders,
// the static server with the app, the reference and the font files, the answer to the reference's
// Google Fonts stylesheet and the count of requests to other hosts.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page, Response } from 'playwright';
import { headersFor, parseHeaderRules, startStaticServer, type HeaderRule, type StaticServer } from './static-server.ts';

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

/**
 * Session B5 part 2: what the console of the app's pages said in every check (Fedor: "0 Verstöße gegen die CSP in der
 * Konsole in allen Prüfungen"). `csp`: each message that names the Content Security Policy (Chromium logs every refused
 * script, style, image, font, connection or frame so); `errors`: every other error and every uncaught exception, which
 * a check prints (some states of the checks answer the API with errors on purpose). Pages of the reference
 * (`/__reference/`) are left out: they are not ours and carry no CSP.
 */
export const CONSOLE_LOG = { csp: [] as string[], errors: [] as string[] };

function watchConsole(context: BrowserContext, origin: string): void {
  const ours = (url: string | undefined) => url !== undefined && url.startsWith(origin) && !url.startsWith(`${origin}/__reference/`);
  context.on('page', (page) => {
    page.on('pageerror', (e) => {
      if (ours(page.url())) CONSOLE_LOG.errors.push(`${page.url()}: uncaught ${e.message.slice(0, 200)}`);
    });
  });
  context.on('console', (m) => {
    const url = m.page()?.url();
    if (!ours(url)) return;
    const text = `${url}: ${m.type()}: ${m.text().slice(0, 300)}`;
    if (/Content Security Policy/i.test(m.text())) CONSOLE_LOG.csp.push(text);
    else if (m.type() === 'error') CONSOLE_LOG.errors.push(text);
  });
}

/** Prints the console of the app's pages; returns the number of CSP violations (a check fails on any). */
export function printConsoleLog(): number {
  const unique = (list: string[]) => [...new Set(list)];
  console.log(`\nConsole of the app's pages: ${CONSOLE_LOG.csp.length} CSP violations, ${CONSOLE_LOG.errors.length} other errors (${unique(CONSOLE_LOG.errors).length} different).`);
  for (const line of unique(CONSOLE_LOG.csp).slice(0, 20)) console.log(`  CSP: ${line}`);
  for (const line of unique(CONSOLE_LOG.errors).slice(0, 20)) console.log(`  error: ${line}`);
  return CONSOLE_LOG.csp.length;
}

/**
 * Session C0 (Fedor: check:report on every state and on the saved reports, and check:scan, with the headers of
 * production): `productionHeaderRules` reads `web/out/_headers` and throws when it is the example build's (a rule of an
 * example page, which only `build:examples` writes), so a check that runs without its own build never runs on the
 * example headers; `watchDocuments` notes every page of ours the browser loads (the main document of each tab and
 * navigation) with the Content-Security-Policy it came with; `documentHeaderProblems` names each one whose CSP is not
 * the one the production rules give its path.
 */
export function productionHeaderRules(): HeaderRule[] {
  const rules = parseHeaderRules(readFileSync(join(OUT_DIR, '_headers'), 'utf8'));
  const example = rules.filter((r) => /beispiel/.test(r.path));
  if (example.length > 0) throw new Error(`web/out/_headers is the example build's (${example.length} rules of example pages): run npm run build:web first`);
  if (!rules.some((r) => r.path === '/bericht') || !rules.some((r) => r.path === '/pruefung')) throw new Error('web/out/_headers has no rule for /bericht or /pruefung');
  return rules;
}

const DOCUMENTS: Promise<{ path: string; csp: string | undefined }>[] = [];

export function watchDocuments(context: BrowserContext, origin: string): void {
  context.on('response', (response: Response) => {
    if (response.request().resourceType() !== 'document') return;
    const url = new URL(response.url());
    if (url.origin !== origin || url.pathname.startsWith('/__')) return;
    DOCUMENTS.push(response.allHeaders().then((h) => ({ path: url.pathname, csp: h['content-security-policy'] })));
  });
}

/** Prints how many pages of ours came with the CSP of production; returns a problem for each that did not. */
export async function documentHeaderProblems(rules: readonly HeaderRule[]): Promise<string[]> {
  const docs = await Promise.all(DOCUMENTS);
  const problems: string[] = [];
  const paths = new Map<string, number>();
  for (const d of docs) {
    const want = headersFor(rules, d.path).get('content-security-policy') ?? undefined;
    if (want === undefined) problems.push(`${d.path}: no CSP in the production rules`);
    else if (d.csp !== want) problems.push(`${d.path}: ${d.csp === undefined ? 'no CSP' : 'a CSP other than production'} on the page`);
    paths.set(d.path, (paths.get(d.path) ?? 0) + 1);
  }
  const list = [...paths].map(([p, n]) => `${p} ${n}`).join(', ');
  console.log(`Pages of ours loaded: ${docs.length} (${list}); with the CSP of the production _headers: ${docs.length - problems.length}.`);
  if (docs.length === 0) problems.push('no page of ours was loaded');
  return [...new Set(problems)];
}

/**
 * Session B5 part 2: a style of a check (to hide text, to pause animations) as a constructed style sheet, which the
 * CSP of our pages does not restrict (a <style> element would need 'unsafe-inline'). Runs in the page; returns nothing,
 * `removeCheckStyle` takes it away again.
 */
export function addCheckStyle(css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  (sheet as unknown as { __check: boolean }).__check = true;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
export function removeCheckStyle(): void {
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => (s as unknown as { __check?: boolean }).__check !== true);
}

// Lets requests to the check server through and handles Google Fonts by `fonts`; every other request
// to another host is blocked and its address added to the returned list. Session B5 part 2: also watches the console
// of the app's pages (CONSOLE_LOG).
export async function routeHosts(context: BrowserContext, origin: string, fonts: FontRouting): Promise<string[]> {
  watchConsole(context, origin);
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
