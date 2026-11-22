import { createDohResolver } from './doh.ts';
import { createUrlGuard, describeRejection, SSRF_LIMITS, type UrlGuard } from './ssrf.ts';
import type { HttpProbe, HttpProbeHop, HttpProbeOutcome } from './types.ts';

/**
 * Checks whether the http:// address of a site redirects to https://, with plain HTTP requests
 * and no browser. Runs the same in Node (local runner) and in a Durable Object (Cloudflare):
 * the `fetch` is passed in.
 *
 * Every address, the first one included, passes the SSRF guard before it is requested (session
 * A5: http or https, ports 80 and 443, public addresses after resolving the name). Every
 * redirect is followed by hand (`redirect: 'manual'`), at most `maxRedirects` times. The chain
 * stops at the first https:// address: that address is not requested, because the browser
 * capture loads the https page anyway. No cookies are sent and no body is read.
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

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    return `${error.name}: ${error.message}${detail}`.slice(0, 300);
  }
  return String(error).slice(0, 300);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
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
      return done(isTimeout(error) ? 'timeout' : 'unavailable');
    }
    // The body is never needed; release the connection.
    await response.body?.cancel().catch(() => undefined);
    const status = response.status;
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
    return done(status >= 200 && status < 300 ? 'no-redirect' : 'http-error');
  }
}
