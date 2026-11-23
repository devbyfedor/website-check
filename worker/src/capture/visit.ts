import type { Browser } from '@cloudflare/puppeteer';
import type { CaptureVisit } from '@website-check/scanner';
import { withTimeout } from './common.ts';

/**
 * Where the browser runs (session A5 part 3, Fedor's decision of 21.11.2026: the country of the visit is
 * stored with every capture and named in the report). Browser Run starts the browser "close to the incoming
 * request", which was the Netherlands, Italy and Austria in A2 and A3, so the place is read once per browser
 * session: one tab in a fresh context opens Cloudflare's trace page and reads `loc` and `colo`, then closes.
 * Every capture of that session carries the result.
 */

export const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

/** Reads `key=value` lines of the trace page (only the keys we keep). */
export function parseTrace(text: string): { loc: string | null; colo: string | null; http: string | null; tls: string | null } {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return { loc: values.get('loc') ?? null, colo: values.get('colo') ?? null, http: values.get('http') ?? null, tls: values.get('tls') ?? null };
}

/** Only well-formed values: a two-letter country and a three-letter data center. */
export function visitOf(trace: { loc: string | null; colo: string | null }, source: CaptureVisit['source']): CaptureVisit {
  return {
    country: trace.loc !== null && /^[A-Z]{2}$/.test(trace.loc) ? trace.loc : null,
    colo: trace.colo !== null && /^[A-Z]{3}$/.test(trace.colo) ? trace.colo : null,
    source,
  };
}

/** The browser's place, and the browser time the trace tab took (open to close). Never throws. */
export async function traceBrowserVisit(browser: Browser, traceUrl: string = TRACE_URL): Promise<{ visit: CaptureVisit; ms: number }> {
  const started = Date.now();
  let visit: CaptureVisit = { country: null, colo: null, source: 'browser-trace' };
  try {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await withTimeout(page.goto(traceUrl, { waitUntil: 'domcontentloaded', timeout: 8_000 }), 9_000);
      const text = (await withTimeout(page.evaluate('document.body ? document.body.innerText : ""') as Promise<string>, 3_000)) ?? '';
      visit = visitOf(parseTrace(typeof text === 'string' ? text : ''), 'browser-trace');
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch {
    // Unknown place: the report says so (country null), the scan goes on.
  }
  return { visit, ms: Date.now() - started };
}

/**
 * The place of the Durable Object itself, for the quick check (its requests leave from there). Only the data
 * center counts: `loc` of a request made by the object names the country of Cloudflare's egress address, not
 * a place (the end-to-end check of A5 part 3 got `loc=US` from an object in Stockholm, A2 part 2 `DE` from one
 * in Milan), so the country stays unknown. Never throws.
 */
export async function traceObjectVisit(fetchFn: typeof fetch = fetch, traceUrl: string = TRACE_URL): Promise<CaptureVisit> {
  try {
    const response = await fetchFn(traceUrl, { signal: AbortSignal.timeout(5_000) });
    return { ...visitOf(parseTrace(await response.text()), 'object-trace'), country: null };
  } catch {
    return { country: null, colo: null, source: 'object-trace' };
  }
}
