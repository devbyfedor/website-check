import { CAPTURE_SCHEMA_VERSION, type Capture, type CaptureEnvironment, type CaptureFailure, type CapturedRequest, type CaptureVisit, type ImpressumCapture, type PageSnapshot } from '../capture/types.ts';
import { classifyMainDocument, notAllowedCapture, pageEvidenceOf } from '../capture/failure.ts';
import { CAPTURE_SETTINGS } from '../capture/settings.ts';
import { chooseImpressumTarget } from '../legal/links.ts';
import { httpsVariantOf, httpVariantOf, probeHttpRedirect, probeHttps } from '../security/http-probe.ts';
import { describeRejection, safeFetch, type SafeFetchResult, type UrlGuard } from '../security/ssrf.ts';
import type { HttpProbe, HttpsProbe } from '../security/types.ts';
import { decodeHtml, snapshotFromHtml } from './html-snapshot.ts';

/**
 * The quick check without a browser (session A5 part 3, brief A5 step 4): when the day's browser time is
 * used up, the homepage and the Impressum are fetched as HTML under the SSRF rules (`safeFetch`: every
 * address and redirect checked, at most 5 redirects, 10 s, 2 MB, no cookies) and read without running any
 * script. The result has the same `Capture` shape as the browser adapters (adapter `quick-fetch`), so the
 * analyzers run unchanged; the report is built with `mode: 'quick'`, which marks third-party services and
 * accessibility as not checked ("Die vollständige Prüfung ist morgen wieder möglich.").
 *
 * What the quick check can say: the security headers and HTTPS of the homepage, the redirect from http to
 * https, the Impressum and Datenschutz links and the Impressum fields as far as they are in the HTML, and
 * the system from what the HTML shows. What it cannot: requests to third parties (no script runs), the
 * consent banner, accessibility (needs a layout), content that scripts build.
 */

export const QUICK_ADAPTER = 'quick-fetch' as const;

export interface QuickCaptureOptions {
  guard: UrlGuard;
  /** The same desktop Chrome user agent as the browser adapters, so the site answers as it answers them. */
  userAgent: string;
  fetch?: typeof fetch;
  /** Fetch the Impressum too (default true). */
  impressum?: boolean;
  /** Check the redirect from http to https (default true). */
  httpProbe?: boolean;
  visit?: CaptureVisit | null;
  now?: () => number;
  /** Per page, DNS and body included (default: the SSRF limit of 10 s). */
  timeoutMs?: number;
}

function environmentOf(userAgent: string): CaptureEnvironment {
  return {
    browser: 'none (quick check)',
    userAgent,
    locale: CAPTURE_SETTINGS.locale,
    timezoneId: CAPTURE_SETTINGS.timezoneId,
    viewport: { ...CAPTURE_SETTINGS.viewport },
  };
}

/** The capture failure of a fetch that did not give a response to read. */
export function fetchFailure(result: SafeFetchResult): CaptureFailure | null {
  switch (result.outcome) {
    case 'ok':
      return null;
    case 'not-allowed':
      return { reason: 'not-allowed', message: result.rejection !== undefined ? describeRejection(result.rejection) : 'not allowed' };
    case 'too-many-redirects':
      return { reason: 'not-allowed', message: `not allowed: too-many-redirects (more than ${result.redirects.length - 1} redirects)` };
    case 'timeout':
      return { reason: 'timeout', message: result.error ?? 'time limit reached' };
    case 'network-error':
      return { reason: 'unreachable', message: result.error ?? 'network error' };
    case 'too-large':
      return { reason: 'other', message: 'the page is larger than 2 MB' };
    case 'bad-redirect':
      return { reason: 'other', message: 'a redirect without a usable address' };
  }
}

/** The fetched chain as request records: every redirect hop and the final document, all of the main frame. */
function requestsOf(result: SafeFetchResult, endMs: number): CapturedRequest[] {
  const records: CapturedRequest[] = [];
  let previous: string | null = null;
  for (const hop of result.redirects) {
    records.push({ seq: records.length, url: hop.url, method: 'GET', resourceType: 'document', startMs: 0, endMs, status: hop.status, failure: null, isMainFrame: true, frameUrls: [], isNavigation: true, initiator: null, redirectedFrom: previous });
    previous = hop.url;
  }
  if (result.status !== null && result.outcome !== 'not-allowed') {
    records.push({ seq: records.length, url: result.finalUrl, method: 'GET', resourceType: 'document', startMs: 0, endMs, status: result.status, failure: null, isMainFrame: true, frameUrls: [], isNavigation: true, initiator: null, redirectedFrom: previous });
  }
  return records;
}

function readPage(result: SafeFetchResult, platform: boolean): PageSnapshot | null {
  if (result.outcome !== 'ok' || result.body === null) return null;
  const html = decodeHtml(result.body, result.headers['content-type']);
  return snapshotFromHtml(html, result.finalUrl, { platform });
}

async function fetchImpressum(url: string, options: QuickCaptureOptions, homepageStartedAt: number, now: () => number): Promise<ImpressumCapture> {
  const opened = now();
  const result = await safeFetch(url, { guard: options.guard, userAgent: options.userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}), ...(options.fetch !== undefined ? { fetch: options.fetch } : {}) });
  const page = readPage(result, false);
  const totalMs = Math.max(0, now() - opened);
  let failure = fetchFailure(result);
  if (failure === null && result.status !== null) {
    failure = page === null ? { reason: 'other', message: 'the text of the Impressum could not be read' } : classifyMainDocument(result.status, result.headers, page.title, pageEvidenceOf(page, 1));
  }
  return {
    url,
    ok: failure === null,
    failure,
    finalUrl: result.status === null ? null : result.finalUrl,
    status: result.status,
    page: failure === null ? page : null,
    requestCount: result.redirects.length + (result.status === null ? 0 : 1),
    timings: { openedAtMs: Math.max(0, opened - homepageStartedAt), domContentLoadedMs: null, snapshotMs: totalMs, totalMs, stopReason: failure === null ? 'fetched' : 'error' },
  };
}

export async function quickCapture(url: string, options: QuickCaptureOptions): Promise<Capture> {
  const now = options.now ?? (() => Date.now());
  const environment = environmentOf(options.userAgent);
  const verdict = await options.guard.check(url);
  if (!verdict.allowed) return notAllowedCapture(QUICK_ADAPTER, environment, url, describeRejection(verdict));
  const startedAt = new Date(now()).toISOString();
  const t0 = now();
  // The redirect check needs no browser either; it runs while the homepage is fetched.
  const httpUrl = options.httpProbe === false ? null : httpVariantOf(url);
  const probe: Promise<HttpProbe | null> | null =
    httpUrl === null
      ? null
      : probeHttpRedirect(httpUrl, { userAgent: options.userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, guard: options.guard, ...(options.fetch !== undefined ? { fetch: options.fetch } : {}) }).catch(() => null);
  // Session fix-a2: an address entered with http:// gets one request to its https:// address, so the report
  // says "ohne HTTPS" only after https:// was asked.
  const httpsUrl = options.httpProbe === false ? null : httpsVariantOf(url);
  const httpsProbe: Promise<HttpsProbe | null> | null =
    httpsUrl === null
      ? null
      : probeHttps(httpsUrl, { userAgent: options.userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, guard: options.guard, ...(options.fetch !== undefined ? { fetch: options.fetch } : {}) }).catch(() => null);
  const home = await safeFetch(url, { guard: options.guard, userAgent: options.userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}), ...(options.fetch !== undefined ? { fetch: options.fetch } : {}) });
  const endMs = Math.max(0, now() - t0);
  const page = readPage(home, true);
  let failure = fetchFailure(home);
  if (failure === null && home.status !== null) {
    failure = page === null ? { reason: 'other', message: 'the homepage could not be read' } : classifyMainDocument(home.status, home.headers, page.title, pageEvidenceOf(page, 1));
  }
  const capture: Capture = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    adapter: QUICK_ADAPTER,
    environment,
    requestedUrl: url,
    startedAt,
    ok: failure === null,
    failure,
    finalUrl: home.status === null ? null : home.finalUrl,
    mainDocument: home.status === null ? null : { status: home.status, headers: home.headers, redirectChain: home.redirects.map((hop) => ({ url: hop.url, status: hop.status })) },
    requests: requestsOf(home, endMs),
    page: failure === null ? page : null,
    consentBanner: { detected: false, toolId: null, method: null, selector: null, visibleAtMs: null, toolsInDom: [] },
    axe: null,
    timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs, stopReason: failure === null ? 'fetched' : 'error' },
    ...(options.visit !== undefined && options.visit !== null ? { visit: options.visit } : {}),
  };
  if (capture.ok && capture.page !== null && options.impressum !== false) {
    const target = chooseImpressumTarget(capture.page.links, capture.page.url ?? capture.finalUrl);
    capture.impressum = target.action === 'open' ? await fetchImpressum(target.url, options, t0, now) : null;
  }
  if (probe !== null) capture.httpProbe = await probe;
  if (httpsProbe !== null) capture.httpsProbe = await httpsProbe;
  return capture;
}
