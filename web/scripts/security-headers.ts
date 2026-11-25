// Writes web/out/_headers after `next build` (session B5 part 2, Fedor): the headers of the static pages that Workers
// Static Assets sends (the API Worker sends its own, worker/src/api/router.ts). Every page gets the security headers of
// the site (worker/src/api/site-headers.ts) and a Content-Security-Policy of its own, with the SHA-256 of each inline
// script of Next.js and of each inline style of its HTML (`'unsafe-hashes'` for style attributes); no `unsafe-inline`
// and no `unsafe-eval`. The rule `/*` holds the headers of every path and the CSP of 404.html (Workers serve it for an
// unknown path); the rule of a page removes that CSP (`! Content-Security-Policy`) and sets its own.
//
// Limits of Workers Static Assets (wrangler 4, `parseHeaders`): at most 100 rules, at most 2,000 characters per line;
// a longer line is dropped without a word. The production build fails above either limit; the example build (never
// deployed) only says so.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pageCsp, SITE_HEADERS } from '../../worker/src/api/site-headers.ts';

export const MAX_RULES = 100;
export const MAX_LINE = 2000;

export interface InlineHashes {
  scripts: string[];
  styles: string[];
  attributes: string[];
}

const sha256 = (text: string): string => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;

/** The value of an attribute as the browser reads it: the five entities Next.js and React write, and numeric ones. */
function decodeAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|#39|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'quot') return '"';
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'apos') return "'";
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
    return m;
  });
}

/**
 * The hashes a page needs: each inline script (a script element without `src`; its text is raw, so it is hashed as
 * written), each style element and each distinct value of a style attribute, sorted. Script elements of a type that is
 * not executed (JSON data) need no hash and are left out.
 */
export function inlineHashes(html: string): InlineHashes {
  const scripts = new Set<string>();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.toLowerCase();
    if (type !== undefined && type !== '' && type !== 'text/javascript' && type !== 'module') continue;
    scripts.add(sha256(m[2] ?? ''));
  }
  const styles = new Set<string>();
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) styles.add(sha256(m[1] ?? ''));
  const attributes = new Set<string>();
  for (const m of html.matchAll(/<[a-zA-Z][^<>]*?\sstyle="([^"]*)"/g)) attributes.add(sha256(decodeAttribute(m[1] ?? '')));
  return { scripts: [...scripts].sort(), styles: [...styles].sort(), attributes: [...attributes].sort() };
}

/** The paths of a page of the static export: `index.html` → `/` and `/index.html`, `bfsg.html` → `/bfsg` and `/bfsg.html`. */
export function routesOf(file: string): string[] {
  const path = `/${file.split(sep).join('/')}`;
  if (path === '/index.html') return ['/', '/index.html'];
  const bare = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  return bare === path ? [path] : [bare, path];
}

/**
 * Headers of single pages besides the CSP (session B2 part 2 and B3 part 2, before in web/public/_headers): the page of
 * a scan and the report of a real scan are never indexed, and the address of a report (with its id) never leaves the
 * page in a Referer (docs/report-schema.md, "The page of the report").
 */
const PAGE_HEADERS: Record<string, readonly string[]> = {
  '/pruefung': ['X-Robots-Tag: noindex, nofollow'],
  '/bericht': ['X-Robots-Tag: noindex, nofollow', '! Referrer-Policy', 'Referrer-Policy: no-referrer'],
};

export interface HeadersResult {
  file: string;
  pages: number;
  rules: number;
  longest: number;
  problems: string[];
}

/** Writes `<outDir>/_headers` from the HTML files of the export. `problems`: the limits of Workers Static Assets that do not hold. */
export async function writeHeaders(outDir: string): Promise<HeadersResult> {
  const files: string[] = [];
  for (const entry of await readdir(outDir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) files.push(relative(outDir, join(entry.parentPath, entry.name)));
  }
  files.sort();
  const notFound = files.find((f) => f === '404.html');
  if (notFound === undefined) throw new Error('web/out/404.html is missing: the rule /* needs its CSP');
  const lines: string[] = [
    '# Written by web/scripts/security-headers.ts after `next build` (session B5 part 2): do not edit, build again.',
    '# Every path: the security headers of the site and the CSP of 404.html; every page: its own CSP with the hashes',
    '# of its inline scripts and styles (no unsafe-inline, no unsafe-eval).',
    '/*',
    ...Object.entries(SITE_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
    `  Content-Security-Policy: ${pageCsp(inlineHashes(await readFile(join(outDir, notFound), 'utf8')))}`,
  ];
  let rules = 1;
  for (const file of files) {
    const csp = pageCsp(inlineHashes(await readFile(join(outDir, file), 'utf8')));
    for (const route of routesOf(file)) {
      const extra = PAGE_HEADERS[route.replace(/\.html$/, '')] ?? [];
      lines.push(route, ...extra.map((l) => `  ${l}`), '  ! Content-Security-Policy', `  Content-Security-Policy: ${csp}`);
      rules += 1;
    }
  }
  const text = `${lines.join('\n')}\n`;
  const target = join(outDir, '_headers');
  await writeFile(target, text, 'utf8');
  const longest = Math.max(...lines.map((l) => l.trim().length));
  const problems: string[] = [];
  if (rules > MAX_RULES) problems.push(`${rules} rules, Workers Static Assets reads at most ${MAX_RULES}`);
  if (longest > MAX_LINE) problems.push(`a line of ${longest} characters, Workers Static Assets drops lines over ${MAX_LINE}`);
  return { file: target, pages: files.length, rules, longest, problems };
}
