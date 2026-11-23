import { hostNameRejection, parseAddress, type AddressRejection } from './address.ts';

/**
 * SSRF protection (session A5, brief `<architecture>`): every server-side request to an address a
 * visitor gave, and every browser navigation of the main document, passes `UrlGuard.check`.
 *
 * Rules: http or https only; ports 80 and 443 only (the scheme's default port or the other one);
 * no user name or password in the address; no special-use host names; the host must be a public
 * address, checked after resolving the name (every A and AAAA record must be public). The
 * redirect limit (5), the time limit (10 s), the size limit (2 MB) and the rule "no cookies, no
 * credentials" are applied by `safeFetch` and the browser's navigation guard.
 *
 * Runs in Node and in a Worker: the name resolver is passed in (`scanner/src/local/node-resolver.ts`
 * with Node's resolver, `createDohResolver` with DNS over HTTPS in the Worker).
 *
 * Known limit: the browser and `fetch` resolve the name again themselves. A name that changes its
 * answer between our check and their connection (DNS rebinding) is not caught here; see
 * `docs/decisions.md` (A5) for why this is acceptable for the two places the scanner runs.
 */

export const SSRF_LIMITS = {
  maxRedirects: 5,
  timeoutMs: 10_000,
  maxBodyBytes: 2 * 1024 * 1024,
  /** URL port fields that are allowed: the default port of the scheme ('') or an explicit 80 or 443. */
  ports: ['', '80', '443'],
} as const;

export type UrlRejection =
  /** Not a parseable absolute URL. */
  | 'invalid-url'
  /** Not http or https. */
  | 'scheme'
  /** User name or password in the address. */
  | 'credentials'
  /** A port other than 80 or 443. */
  | 'port'
  /** localhost, .local, .internal, a single label, … */
  | 'host-name'
  /** The host is an IP address (literal or resolved) that is not public. */
  | 'address'
  /** The name has no A or AAAA record. */
  | 'unresolved'
  /** The resolver failed: unsure, so refused. */
  | 'dns-error';

export type UrlVerdict =
  | { allowed: true; url: string; addresses: string[]; exempt: boolean }
  | { allowed: false; url: string; rejection: UrlRejection; detail: string; addressRejection?: AddressRejection };

/** All addresses of a host name (A and AAAA); an empty list when the name does not exist. Throws when unsure. */
export type Resolver = (hostname: string) => Promise<string[]>;

export interface UrlGuardOptions {
  resolve: Resolver;
  /**
   * Tests and local `wrangler dev` only: addresses that skip the host, port and address rules
   * (scheme and credentials are still checked). Production passes nothing.
   */
  exempt?: (url: URL) => boolean;
}

export interface UrlGuard {
  check(url: string | URL): Promise<UrlVerdict>;
}

function refuse(url: string, rejection: UrlRejection, detail: string, addressRejection?: AddressRejection): UrlVerdict {
  return { allowed: false, url, rejection, detail, ...(addressRejection !== undefined ? { addressRejection } : {}) };
}

/** The host of a URL without IPv6 brackets and without a trailing dot. */
function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * Everything that can be decided without DNS. Returns a verdict when the address is refused, when
 * it is exempt, or when the host is a public IP literal; null when the host name still has to be
 * resolved.
 */
export function precheckUrl(input: string | URL, exempt?: (url: URL) => boolean): UrlVerdict | null {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : new URL(input.href);
  } catch {
    return refuse(String(input).slice(0, 300), 'invalid-url', 'not a valid absolute URL');
  }
  const href = url.href;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse(href, 'scheme', `scheme ${url.protocol} is not allowed`);
  if (url.username !== '' || url.password !== '') return refuse(href, 'credentials', 'user name or password in the address');
  if (exempt?.(url) === true) return { allowed: true, url: href, addresses: [], exempt: true };
  const host = bareHost(url);
  // The URL parser already turns every IPv4 form (decimal, octal, hex, short) into a dotted quad;
  // parseAddress accepts those forms too, so the check does not depend on it.
  const literal = parseAddress(host);
  if (literal !== null && literal.rejection !== null) {
    return refuse(href, 'address', `${literal.rejection} address ${literal.canonical}`, literal.rejection);
  }
  if (literal === null) {
    // bareHost dropped one trailing dot (the DNS root); an empty label left ("intern.local..", ".de") is no host (review of A5 part 2).
    if (host === '' || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return refuse(href, 'host-name', 'empty label in the host name');
    const nameReason = hostNameRejection(host);
    if (nameReason !== null) return refuse(href, 'host-name', nameReason);
  }
  if (!(SSRF_LIMITS.ports as readonly string[]).includes(url.port)) return refuse(href, 'port', `port ${url.port} is not allowed`);
  if (literal !== null) return { allowed: true, url: href, addresses: [literal.canonical], exempt: false };
  return null;
}

/** Checks resolved addresses: every one must be public. */
export function checkResolved(url: string, hostname: string, addresses: readonly string[]): UrlVerdict {
  if (addresses.length === 0) return refuse(url, 'unresolved', `no address for ${hostname}`);
  for (const text of addresses) {
    const parsed = parseAddress(text);
    if (parsed === null) return refuse(url, 'dns-error', `resolver returned a value that is not an address`);
    if (parsed.rejection !== null) return refuse(url, 'address', `${hostname} resolves to a ${parsed.rejection} address (${parsed.canonical})`, parsed.rejection);
  }
  return { allowed: true, url, addresses: [...addresses], exempt: false };
}

/**
 * A guard for one scan: resolved names are cached for its lifetime, so the redirect check, the
 * page and the Impressum tab resolve the site's name once.
 */
export function createUrlGuard(options: UrlGuardOptions): UrlGuard {
  const cache = new Map<string, Promise<string[]>>();
  return {
    async check(input) {
      const pre = precheckUrl(input, options.exempt);
      if (pre !== null) return pre;
      const url = new URL(typeof input === 'string' ? input : input.href);
      const host = bareHost(url).toLowerCase();
      let pending = cache.get(host);
      if (pending === undefined) {
        pending = options.resolve(host);
        cache.set(host, pending);
      }
      let addresses: string[];
      try {
        addresses = await pending;
      } catch (error) {
        cache.delete(host);
        return refuse(url.href, 'dns-error', `name resolution failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`);
      }
      return checkResolved(url.href, host, addresses);
    },
  };
}

/** One line for logs and capture failures, e.g. "not allowed: address (loopback address 127.0.0.1)". */
export function describeRejection(verdict: Extract<UrlVerdict, { allowed: false }>): string {
  return `not allowed: ${verdict.rejection} (${verdict.detail})`;
}

// ---------------------------------------------------------------------------------------------
// safeFetch: a plain HTTP request under the SSRF rules (http redirect check, later the quick check).

export interface SafeFetchOptions {
  guard: UrlGuard;
  fetch?: typeof fetch;
  method?: 'GET' | 'HEAD';
  /** Only these request headers are sent; never cookies or authorization. */
  userAgent?: string;
  accept?: string;
  acceptLanguage?: string;
  /** For the whole chain, DNS and body included. */
  timeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  /** Read the body of the final response (default true for GET). */
  readBody?: boolean;
}

export type SafeFetchOutcome =
  /** A final response that is not a redirect (any status), body read if asked. */
  | 'ok'
  /** The address or a redirect target was refused by the guard. */
  | 'not-allowed'
  | 'too-many-redirects'
  /** A redirect without a usable Location header. */
  | 'bad-redirect'
  /** The body (or its announced length) is larger than the limit; nothing more is read. */
  | 'too-large'
  | 'timeout'
  /** Connection refused, reset, TLS error, … */
  | 'network-error';

export interface SafeFetchHop {
  url: string;
  status: number;
  location: string | null;
}

export interface SafeFetchResult {
  outcome: SafeFetchOutcome;
  /** The first address. */
  url: string;
  /** The last address requested (or refused). */
  finalUrl: string;
  /** Status and headers of the last response; null without a response. */
  status: number | null;
  headers: Record<string, string>;
  /** The body of the final response (`ok` only, when read). */
  body: Uint8Array | null;
  bodyBytes: number;
  /** Redirects that were followed, in order. */
  redirects: SafeFetchHop[];
  /** The guard's verdict that stopped the chain (`not-allowed`). */
  rejection?: Extract<UrlVerdict, { allowed: false }>;
  error?: string;
  durationMs: number;
}

class Deadline {
  readonly controller = new AbortController();
  readonly #timer: ReturnType<typeof setTimeout>;
  expired = false;
  constructor(ms: number) {
    this.#timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort(new Error(`time limit of ${ms} ms reached`));
    }, ms);
  }
  /** Rejects when the deadline passes first. */
  race<T>(promise: Promise<T>): Promise<T> {
    if (this.controller.signal.aborted) return Promise.reject(this.controller.signal.reason);
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(this.controller.signal.reason);
      this.controller.signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          this.controller.signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          this.controller.signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }
  clear(): void {
    clearTimeout(this.#timer);
  }
}

function headersOf(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

function shortError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${error.name}: ${error.message}${cause instanceof Error ? `: ${cause.message}` : ''}`.slice(0, 300);
  }
  return String(error).slice(0, 300);
}

/** Reads at most `limit` bytes; null if the body is larger (the rest is cancelled, not read). */
async function readLimited(response: Response, limit: number, deadline: Deadline): Promise<Uint8Array | null> {
  const stream = response.body;
  if (stream === null) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * One request under the SSRF rules: the guard checks the first address and every redirect target
 * before it is requested; redirects are followed by hand, at most `maxRedirects`; one time limit
 * covers DNS, every hop and the body; the body is read up to `maxBodyBytes`. Only the user agent,
 * `Accept` and `Accept-Language` are sent: no cookies, no authorization (neither runtime has a
 * cookie jar, and `credentials` is not supported by Workers' fetch, so it is not set).
 */
export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? SSRF_LIMITS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? SSRF_LIMITS.maxRedirects;
  const maxBodyBytes = options.maxBodyBytes ?? SSRF_LIMITS.maxBodyBytes;
  const readBody = options.readBody ?? method === 'GET';
  const started = Date.now();
  const headers: Record<string, string> = { accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  if (options.userAgent !== undefined) headers['user-agent'] = options.userAgent;
  if (options.acceptLanguage !== undefined) headers['accept-language'] = options.acceptLanguage;

  const redirects: SafeFetchHop[] = [];
  const deadline = new Deadline(timeoutMs);
  let current = input;
  let status: number | null = null;
  let responseHeaders: Record<string, string> = {};
  const done = (outcome: SafeFetchOutcome, extra: Partial<SafeFetchResult> = {}): SafeFetchResult => {
    deadline.clear();
    return {
      outcome,
      url: input,
      finalUrl: current,
      status,
      headers: responseHeaders,
      body: null,
      bodyBytes: 0,
      redirects,
      durationMs: Date.now() - started,
      ...extra,
    };
  };

  try {
    for (;;) {
      const verdict = await deadline.race(options.guard.check(current));
      if (!verdict.allowed) return done('not-allowed', { rejection: verdict, error: describeRejection(verdict) });
      current = verdict.url;
      const response = await deadline.race(fetchFn(current, { method, redirect: 'manual', headers, signal: deadline.controller.signal }));
      status = response.status;
      responseHeaders = headersOf(response);
      if (status >= 300 && status < 400 && status !== 304) {
        await response.body?.cancel().catch(() => undefined);
        const raw = response.headers.get('location');
        let next: string | null = null;
        try {
          next = raw === null || raw.trim() === '' ? null : new URL(raw.trim(), current).href;
        } catch {
          next = null;
        }
        redirects.push({ url: current, status, location: next });
        if (next === null) return done('bad-redirect');
        if (redirects.length > maxRedirects) return done('too-many-redirects');
        current = next;
        continue;
      }
      const announced = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(announced) && announced > maxBodyBytes) {
        await response.body?.cancel().catch(() => undefined);
        return done('too-large', { bodyBytes: announced });
      }
      if (!readBody || method === 'HEAD') {
        await response.body?.cancel().catch(() => undefined);
        return done('ok');
      }
      const body = await readLimited(response, maxBodyBytes, deadline);
      if (body === null) return done('too-large', { bodyBytes: maxBodyBytes + 1 });
      return done('ok', { body, bodyBytes: body.byteLength });
    }
  } catch (error) {
    if (deadline.expired) return done('timeout', { error: `time limit of ${timeoutMs} ms reached` });
    return done('network-error', { error: shortError(error) });
  }
}
