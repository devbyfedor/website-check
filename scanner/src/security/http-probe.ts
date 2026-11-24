import { createDohResolver } from './doh.ts';
import { isConnectionFailure } from './fetch-errors.ts';
import { createUrlGuard, describeRejection, SSRF_LIMITS, type UrlGuard } from './ssrf.ts';
import type { HttpProbe, HttpProbeHop, HttpProbeOutcome, HttpsProbe, HttpsProbeOutcome } from './types.ts';

/**
 * Checks whether the http:// address of a site redirects to https://, with plain HTTP requests
 * and no browser. Runs the same in Node (local runner) and in a Durable Object (Cloudflare):
 * the `fetch` is passed in.
 *
 * Every address, the first one included, passes the SSRF guard before it is requested (session
 * A5: http or https, ports 80 and 443, public addresses after resolving the name). Every
 * redirect is followed by hand (`redirect: 'manual'`), at most `maxRedirects` times. The chain
 * stops at the first https:// address: that address is not requested, because the browser
 * capture loads the https page anyway. No cookies are sent.
 *
 * Session fix-a2: an answer 2xx is not yet "no redirect". The `Refresh` header and the first
 * `HTTP_PROBE_BODY_LIMIT` bytes of the page are read (within the same time limit): a meta refresh to
 * https:// is a redirect in the browser, and an inline script that changes the address and names https
 * cannot be decided without a browser. And `probeHttps` asks the https:// address of a site that was
 * entered with http://, so "ohne HTTPS" is said only after https:// was really asked.
 */

export interface HttpProbeOptions {
  fetch?: typeof fetch;
  /** The same browser user agent as the capture, so the site answers as it answers the browser. */
  userAgent?: string;
  acceptLanguage?: string;
  /** For the whole chain. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** The SSRF guard of the scan. Default: a new guard that resolves names with DNS over HTTPS through `fetch`. */
  guard?: UrlGuard;
}

export const HTTP_PROBE_DEFAULTS = { timeoutMs: SSRF_LIMITS.timeoutMs, maxRedirects: SSRF_LIMITS.maxRedirects } as const;

/** How much of a page answered with 2xx on http:// is read to look for a redirect inside the page. */
export const HTTP_PROBE_BODY_LIMIT = 64 * 1024;

/** The http:// address on the default port for a requested address (`https://www.x.de/` → `http://www.x.de/`). */
export function httpVariantOf(requestedUrl: string): string | null {
  try {
    const url = new URL(requestedUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.protocol = 'http:';
    url.port = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** The https:// address on the default port, only for a requested address that starts with http:// (otherwise null). */
export function httpsVariantOf(requestedUrl: string): string | null {
  try {
    const url = new URL(requestedUrl);
    if (url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    url.port = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    return `${error.name}: ${error.message}${detail}`.slice(0, 300);
  }
  return String(error).slice(0, 300);
}

/** The connection was refused: nothing listens on the port (Node names it in the cause of the fetch error). */
function isRefused(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 4; current = (current as { cause?: unknown }).cause, depth += 1) {
    if ((current as { code?: unknown }).code === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(current.message)) return true;
  }
  return false;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * The start of a response body as text, at most `limit` bytes. `ended` is true when the whole body was
 * read, false when it stalled, broke off, or is longer than the limit: what was read may still show a
 * redirect, but its absence is known only for the part that was read.
 */
async function readStart(response: Response, limit: number, leftMs: number): Promise<{ text: string; ended: boolean; cut: boolean }> {
  const body = response.body;
  if (body === null) return { text: '', ended: true, cut: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, leftMs));
  });
  // 'ended': the body is over; 'cut': the limit was reached with more to come; false: it stalled or broke off.
  const read = (async (): Promise<'ended' | 'cut'> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return 'ended';
      if (value === undefined || value.byteLength === 0) continue;
      if (size >= limit) return 'cut';
      const part = value.byteLength > limit - size ? value.subarray(0, limit - size) : value;
      chunks.push(part);
      size += part.byteLength;
      if (part.byteLength < value.byteLength) return 'cut';
    }
  })().catch(() => false as const);
  const outcome = await Promise.race([read, timeout]);
  clearTimeout(timer);
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks.slice()) {
    if (offset + chunk.byteLength > bytes.byteLength) break;
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const data = bytes.subarray(0, offset);
  // Only ASCII patterns are looked for, so the page's real encoding matters only for UTF-16 (two bytes per letter).
  const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
  return { text: new TextDecoder(encoding).decode(data), ended: outcome === 'ended', cut: outcome === 'cut' };
}

/**
 * The target of a refresh value ("0; url=https://…", "5,URL='/neu'", "0;https://…") against `base`, or null
 * when the value names no address. Parsed step by step, never with one pattern over the whole value.
 */
export function refreshTargetOf(value: string, base: URL): URL | null {
  let rest = value.slice(0, 2_000).trim();
  let digits = 0;
  while (digits < rest.length && /[0-9.]/.test(rest.charAt(digits))) digits += 1;
  if (digits === 0) return null;
  rest = rest.slice(digits).trimStart();
  if (rest.startsWith(';') || rest.startsWith(',')) rest = rest.slice(1).trimStart();
  if (/^url/i.test(rest)) {
    const afterUrl = rest.slice(3).trimStart();
    if (afterUrl.startsWith('=')) rest = afterUrl.slice(1).trimStart();
  }
  const quote = rest.charAt(0);
  if (quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    rest = end === -1 ? rest.slice(1) : rest.slice(1, end);
  }
  rest = rest.trim();
  if (rest === '') return null;
  try {
    return new URL(rest, base);
  } catch {
    return null;
  }
}

/** Elements whose content is text, not markup: nothing inside them is a tag of the page. */
const RAW_TEXT_ELEMENTS = ['script', 'style', 'noscript', 'template', 'textarea', 'title', 'xmp', 'iframe'] as const;
const TAG_MAX = 4_000;

function isTagBoundary(char: string): boolean {
  return char === '' || char === '>' || char === '/' || char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/** Lower case for A to Z only: the result has the length of the input, so positions in it are positions in the page. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** The position of the `>` that ends the tag starting at `from` (a `>` inside a quoted value does not end it), or -1. */
function tagEnd(html: string, from: number): number {
  let quote = '';
  const stop = Math.min(html.length, from + TAG_MAX);
  for (let i = from; i < stop; i += 1) {
    const char = html.charAt(i);
    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return html.indexOf('>', stop);
}

/** The value of one attribute of a start tag (at most `TAG_MAX` characters long), or null. */
function attributeOf(tag: string, name: string): string | null {
  const pattern = /([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let match = pattern.exec(tag); match !== null; match = pattern.exec(tag)) {
    if ((match[1] ?? '').toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? '';
  }
  return null;
}

/**
 * What the start of a page says about a redirect inside the page: the contents of its meta refresh tags
 * and its inline scripts. Comments and the text of script, style, noscript and similar elements are
 * skipped (a meta refresh inside noscript does nothing in a browser that runs scripts). The `onload` of the
 * body counts as an inline script. `headEnded`: the head is over in the part that was read (`</head>` or
 * `<body`). One pass with `indexOf`: the page is untrusted and may be built to be slow to read.
 */
export function scanPageStart(html: string): { metaRefresh: string[]; inlineScripts: string[]; headEnded: boolean } {
  const lower = asciiLower(html);
  const metaRefresh: string[] = [];
  const inlineScripts: string[] = [];
  let headEnded = false;
  let i = 0;
  while (i < html.length) {
    const lt = lower.indexOf('<', i);
    if (lt === -1) break;
    if (lower.startsWith('<!--', lt)) {
      // `<!-->` and `<!--->` are empty comments.
      const end = lower.indexOf('-->', lt + 2);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const raw = RAW_TEXT_ELEMENTS.find((name) => lower.startsWith(name, lt + 1) && isTagBoundary(lower.charAt(lt + 1 + name.length)));
    if (raw !== undefined) {
      const open = tagEnd(html, lt);
      if (open === -1) break;
      const close = lower.indexOf(`</${raw}`, open + 1);
      if (raw === 'script') {
        const tag = html.slice(lt, Math.min(open + 1, lt + TAG_MAX));
        const type = attributeOf(tag, 'type');
        const isScript = type === null || type.trim() === '' || /javascript|ecmascript|module/i.test(type);
        if (isScript && attributeOf(tag, 'src') === null) inlineScripts.push(html.slice(open + 1, close === -1 ? html.length : close));
      }
      i = close === -1 ? html.length : close + 2 + raw.length;
      continue;
    }
    if (lower.startsWith('/head', lt + 1) && isTagBoundary(lower.charAt(lt + 6))) headEnded = true;
    if (lower.startsWith('body', lt + 1) && isTagBoundary(lower.charAt(lt + 5))) {
      headEnded = true;
      const end = tagEnd(html, lt);
      const onload = attributeOf(html.slice(lt, Math.min(end === -1 ? html.length : end + 1, lt + TAG_MAX)), 'onload');
      if (onload !== null) inlineScripts.push(onload);
    }
    if (lower.startsWith('meta', lt + 1) && isTagBoundary(lower.charAt(lt + 5))) {
      const end = tagEnd(html, lt);
      const tag = html.slice(lt, Math.min(end === -1 ? html.length : end + 1, lt + TAG_MAX));
      if ((attributeOf(tag, 'http-equiv') ?? '').trim().toLowerCase() === 'refresh') metaRefresh.push(attributeOf(tag, 'content') ?? '');
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    i = lt + 1;
  }
  return { metaRefresh, inlineScripts, headEnded };
}

/** A script that changes the address of the page: an assignment to `location`, its `href` or `protocol`, or `replace()` / `assign()`. */
const SCRIPT_NAVIGATES = /location(?:["']\s*\])?\s*(?:\.\s*(?:href|protocol)\s*|\[\s*["'](?:href|protocol)["']\s*\]\s*)?=(?!=)|location(?:["']\s*\])?\s*\.\s*(?:replace|assign)\s*\(/g;
const SCRIPT_READS_PROTOCOL = /location(?:["']\s*\])?\s*\.\s*protocol/;
/** How far after the change of the address the script is read for "https". */
const SCRIPT_WINDOW = 300;

/**
 * True when an inline script may send the browser to https://: it changes `location`, and either names
 * https or the protocol right there, or looks at `location.protocol` anywhere. A script that only opens
 * another page of the site on a click does not count.
 */
export function scriptMayRedirect(script: string): boolean {
  const readsProtocol = SCRIPT_READS_PROTOCOL.test(script);
  for (const match of script.matchAll(SCRIPT_NAVIGATES)) {
    if (readsProtocol) return true;
    if (/https|protocol/i.test(script.slice(match.index, match.index + SCRIPT_WINDOW))) return true;
  }
  return false;
}

/** Session fix-a2: what a page answered with 2xx on http:// does next in a browser, as far as its start shows. */
function inPageRedirect(current: URL, refreshHeader: string | null, html: { text: string; ended: boolean; cut: boolean }): { outcome: HttpProbeOutcome; httpsTarget: string | null } {
  const targets: (URL | null)[] = [];
  if (refreshHeader !== null) targets.push(refreshTargetOf(refreshHeader, current));
  const page = scanPageStart(html.text);
  for (const content of page.metaRefresh) targets.push(refreshTargetOf(content, current));
  const https = targets.find((target) => target !== null && target.protocol === 'https:');
  if (https !== undefined && https !== null) return { outcome: 'redirects-in-page', httpsTarget: https.href };
  if (page.inlineScripts.some(scriptMayRedirect)) return { outcome: 'script-may-redirect', httpsTarget: null };
  // A refresh to another address on http://: the browser moves on, and what comes there was not looked at.
  if (targets.some((target) => target !== null && target.href !== current.href)) return { outcome: 'refresh-to-http', httpsTarget: null };
  // "No redirect" needs a page that was read: all of it, or at least its whole head (where a meta refresh
  // belongs) when the page is longer than the limit. A page that stalled or broke off is not known.
  if (!html.ended && !(html.cut && page.headEnded)) return { outcome: 'page-not-read', httpsTarget: null };
  return { outcome: 'no-redirect', httpsTarget: null };
}

export async function probeHttpRedirect(httpUrl: string, options: HttpProbeOptions = {}): Promise<HttpProbe> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? HTTP_PROBE_DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? HTTP_PROBE_DEFAULTS.maxRedirects;
  const guard = options.guard ?? createUrlGuard({ resolve: createDohResolver(fetchFn) });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const hops: HttpProbeHop[] = [];
  const done = (outcome: HttpProbeOutcome, httpsTarget: string | null = null): HttpProbe => ({
    url: httpUrl,
    startedAt,
    outcome,
    hops,
    httpsTarget,
    durationMs: Date.now() - started,
  });
  /** Null when the guard accepts the address, otherwise the refusal (recorded as a hop without a request). */
  const refused = async (url: URL): Promise<HttpProbe | null> => {
    // The time limit covers name resolution too.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const left = Math.max(0, timeoutMs - (Date.now() - started));
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), left);
    });
    const verdict = await Promise.race([guard.check(url), timeout]).finally(() => clearTimeout(timer));
    if (verdict === 'timeout') return done('timeout');
    if (verdict.allowed) return null;
    hops.push({ url: url.href, status: null, location: null, error: describeRejection(verdict) });
    return done('stopped');
  };

  let current: URL;
  try {
    current = new URL(httpUrl);
  } catch {
    return done('stopped');
  }
  if (current.protocol !== 'http:') return done('stopped');
  const first = await refused(current);
  if (first !== null) return first;

  const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  if (options.userAgent !== undefined) headers['user-agent'] = options.userAgent;
  if (options.acceptLanguage !== undefined) headers['accept-language'] = options.acceptLanguage;

  for (let redirects = 0; ; redirects += 1) {
    const left = timeoutMs - (Date.now() - started);
    if (left <= 0) return done('timeout');
    let response: Response;
    try {
      response = await fetchFn(current.href, { method: 'GET', redirect: 'manual', headers, signal: AbortSignal.timeout(left) });
    } catch (error) {
      hops.push({ url: current.href, status: null, location: null, error: errorText(error) });
      // "Unter http:// nicht erreichbar" only for a failure of the connection to the site; our own failure (the
      // subrequest limit, an internal error) is a manual check (session fix-a5, review finding 80).
      return done(isTimeout(error) ? 'timeout' : isConnectionFailure(errorText(error)) ? 'unavailable' : 'stopped');
    }
    const status = response.status;
    if (status >= 200 && status < 300) {
      // A page instead of a redirect: its Refresh header and its start decide what a browser does next.
      const html = await readStart(response, HTTP_PROBE_BODY_LIMIT, timeoutMs - (Date.now() - started));
      const next = inPageRedirect(current, response.headers.get('refresh'), html);
      hops.push({ url: current.href, status, location: next.httpsTarget, error: html.ended ? null : html.cut ? `only the first ${HTTP_PROBE_BODY_LIMIT} bytes of the page were read` : 'the page did not arrive completely' });
      return done(next.outcome, next.httpsTarget);
    }
    // No other body is needed; release the connection.
    await response.body?.cancel().catch(() => undefined);
    if (status >= 300 && status < 400) {
      const raw = response.headers.get('location');
      let next: URL | null = null;
      try {
        next = raw === null || raw.trim() === '' ? null : new URL(raw.trim(), current);
      } catch {
        next = null;
      }
      hops.push({ url: current.href, status, location: next?.href ?? null, error: null });
      if (next === null) return done('stopped');
      if (next.protocol === 'https:') return done('redirects-to-https', next.href);
      if (next.protocol !== 'http:') return done('stopped');
      if (redirects + 1 > maxRedirects) return done('too-many-redirects');
      const blocked = await refused(next);
      if (blocked !== null) return blocked;
      current = next;
      continue;
    }
    hops.push({ url: current.href, status, location: null, error: null });
    return done('http-error');
  }
}

/**
 * Session fix-a2: one request to the https:// address of a site entered with http:// (`httpsVariantOf`),
 * under the same SSRF guard. A redirect is not followed and no body is read: the question is only whether
 * the site answers on https://.
 */
export async function probeHttps(httpsUrl: string, options: HttpProbeOptions = {}): Promise<HttpsProbe> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? HTTP_PROBE_DEFAULTS.timeoutMs;
  const guard = options.guard ?? createUrlGuard({ resolve: createDohResolver(fetchFn) });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const done = (outcome: HttpsProbeOutcome, status: number | null = null, location: string | null = null, error: string | null = null): HttpsProbe => ({
    url: httpsUrl,
    startedAt,
    outcome,
    status,
    location,
    error,
    durationMs: Date.now() - started,
  });
  let url: URL;
  try {
    url = new URL(httpsUrl);
  } catch {
    return done('stopped');
  }
  if (url.protocol !== 'https:') return done('stopped');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const verdict = await Promise.race([guard.check(url), timeout]).finally(() => clearTimeout(timer));
  if (verdict === 'timeout') return done('timeout');
  if (!verdict.allowed) return done('stopped', null, null, describeRejection(verdict));
  const left = timeoutMs - (Date.now() - started);
  if (left <= 0) return done('timeout');
  const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  if (options.userAgent !== undefined) headers['user-agent'] = options.userAgent;
  if (options.acceptLanguage !== undefined) headers['accept-language'] = options.acceptLanguage;
  let response: Response;
  try {
    response = await fetchFn(url.href, { method: 'GET', redirect: 'manual', headers, signal: AbortSignal.timeout(left) });
  } catch (error) {
    return done(isTimeout(error) ? 'timeout' : isRefused(error) ? 'refused' : 'unavailable', null, null, errorText(error));
  }
  await response.body?.cancel().catch(() => undefined);
  const status = response.status;
  if (status >= 200 && status < 300) return done('answers', status);
  if (status >= 300 && status < 400) {
    const raw = response.headers.get('location');
    let next: URL | null = null;
    try {
      next = raw === null || raw.trim() === '' ? null : new URL(raw.trim(), url);
    } catch {
      next = null;
    }
    if (next === null) return done('stopped', status);
    if (next.protocol === 'https:') return done('answers', status, next.href);
    return done(next.protocol === 'http:' ? 'redirects-to-http' : 'stopped', status, next.href);
  }
  return done('http-error', status);
}
