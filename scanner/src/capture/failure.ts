import { isLookupFailure } from '../security/fetch-errors.ts';
import { CAPTURE_SCHEMA_VERSION, type Capture, type CaptureFailure, type CaptureFailureReason } from './types.ts';

/**
 * Classification of capture failures, shared by all capture adapters.
 * Pure functions: they only look at error texts, status codes, headers and the page title.
 */

/** Maps a navigation error (Chromium net error or adapter timeout) to a failure reason. */
export function classifyNavigationError(message: string): CaptureFailureReason {
  if (/ERR_INVALID_URL|Cannot navigate to invalid URL|invalid URL|ERR_UNKNOWN_URL_SCHEME|ERR_DISALLOWED_URL_SCHEME/i.test(message)) {
    return 'invalid-address';
  }
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_ADDRESS_INVALID/i.test(message)) return 'invalid-address';
  if (/Timeout|ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/i.test(message)) return 'timeout';
  if (/ERR_BLOCKED_BY_|ERR_ACCESS_DENIED/i.test(message)) return 'blocked';
  if (
    /ERR_CONNECTION_(?:REFUSED|RESET|CLOSED|FAILED|ABORTED)|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE|ERR_SSL_|ERR_CERT_|ERR_BAD_SSL|ERR_TLS|ERR_HTTP2_|ERR_QUIC_|ERR_NETWORK_|ERR_INTERNET_DISCONNECTED|ERR_TOO_MANY_REDIRECTS|ERR_PROXY_/i.test(
      message,
    )
  ) {
    return 'unreachable';
  }
  return 'other';
}

const CHALLENGE_TITLE =
  /just a moment|attention required|access denied|zugriff verweigert|request (?:blocked|rejected)|are you a (?:robot|human)|captcha|ddos[- ]guard|security check|bot (?:check|protection)|sucuri website firewall|checking your browser/i;
/** Only unambiguous challenge titles count on their own when the status is 2xx. */
const CHALLENGE_TITLE_STRONG = /^(?:just a moment\.*|attention required!?.*|checking your browser.*|ddos-guard)$/i;

/**
 * What the page showed at the end of the visit, for recognising check pages: the title, the
 * visible text, the number of links and, when the adapter knows it, the number of requests.
 */
export interface PageEvidence {
  title: string;
  text: string;
  links: number;
  requests?: number;
}

/**
 * Check pages of web hosts and bot protection that answer with HTTP 200 (A2 part 2), on a page
 * that is almost empty and loaded almost nothing:
 * - the whole title is a "please wait" phrase ("Einen Moment bitte …", "Bitte warten",
 *   "One moment, please"), or
 * - the text says that the request or the browser is being checked ("während Ihre Anfrage
 *   geprüft wird", "Ihr Browser wird überprüft", "Checking your browser", …), whatever the title.
 * Seen on a test site: title "Einen Moment bitte …", text "Bitte warten Sie, während Ihre
 * Anfrage geprüft wird …", no links, 2 requests. Deliberately narrow, because a normal homepage
 * taken for a check page would hide its findings: a title that only starts with such words
 * ("Sicherheitsprüfung & HU – Kfz-Prüfstelle …") does not count, and neither does a page that
 * only asks to wait and says it redirects the visitor (a text that says the browser is being checked
 * counts with or without such a sentence: the classic check pages announce the redirect themselves).
 */
const WAIT_TITLE = /^(?:einen? moment,? bitte|bitte (?:kurz )?warten|one moment,? please|please wait)[\s.…!]*$/iu;
// Not "Ihre Anfrage wird geprüft" alone: a thank-you page after a contact form says that too.
const CHECK_TEXT =
  /während (?:wir )?ihre anfrage (?:geprüft|überprüft)|ihr browser wird (?:geprüft|überprüft)|überprüfung ihres browsers|wir (?:prüfen|überprüfen) ihren browser|checking your browser|checking if the site connection is secure|verify(?:ing)? (?:that )?you are (?:a )?human|your request is being (?:checked|verified)/iu;
const REDIRECT_TEXT = /weitergeleitet|weiterleitung|redirect/iu;
/** "Almost empty": what a check page shows, far less than any homepage. */
const CHECK_PAGE_MAX_TEXT = 600;
const CHECK_PAGE_MAX_LINKS = 3;
/** The check page of the test site made 2 requests; a homepage with a tracker and fonts makes far more. */
const CHECK_PAGE_MAX_REQUESTS = 15;

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * Null for a normal page, otherwise why the page is a check page. The reason names the rule and
 * the sizes, not the title, so it can be shown in logs without a site name.
 */
export function checkPageReason(page: PageEvidence): string | null {
  const title = normalize(page.title);
  const text = normalize(page.text);
  if (text.length > CHECK_PAGE_MAX_TEXT || page.links > CHECK_PAGE_MAX_LINKS) return null;
  if (page.requests !== undefined && page.requests > CHECK_PAGE_MAX_REQUESTS) return null;
  const titleMatch = WAIT_TITLE.test(title);
  const textMatch = CHECK_TEXT.test(text);
  if (!titleMatch && !textMatch) return null;
  // "Einen Moment bitte, Sie werden weitergeleitet" is a redirect page of the site, not a check.
  if (!textMatch && REDIRECT_TEXT.test(text)) return null;
  const rule = [titleMatch ? 'wait title' : null, textMatch ? 'check text' : null].filter((r) => r !== null).join(' and ');
  const requests = page.requests === undefined ? '' : `, ${page.requests} requests`;
  return `check page (${rule}): ${text.length} characters, ${page.links} links${requests}`;
}

/**
 * Session fix-a1: the sizes of a page that shows about as little as a check page, whatever its words:
 * at most 1 500 characters of text, 3 links and 15 requests. Null for any larger page. Such a page is
 * not `blocked` (a small page of the site itself looks the same), but nothing can be concluded from
 * what it does not show: `analyzeCapture` adds that it has no link to an Impressum or a
 * Datenschutzerklärung, and the report then gives no "erfüllt" and no risk for the missing Impressum
 * link. The text limit is wider than the check page's 600 characters: a protection page that explains
 * itself in two languages is longer, and the links decide (the smallest of 186 saved captures of
 * ordinary homepages has 17 links and 803 characters).
 */
const ALMOST_EMPTY_MAX_TEXT = 1_500;

export function almostEmptyReason(page: PageEvidence): string | null {
  const text = normalize(page.text);
  if (text.length > ALMOST_EMPTY_MAX_TEXT || page.links > CHECK_PAGE_MAX_LINKS) return null;
  if (page.requests !== undefined && page.requests > CHECK_PAGE_MAX_REQUESTS) return null;
  const requests = page.requests === undefined ? '' : `, ${page.requests} requests`;
  return `almost empty page: ${text.length} characters, ${page.links} links${requests}`;
}

/**
 * Session fix-a1: the failure of a capture that was cut off after the main document answered: the
 * hard limit of a page, a crashed tab or a closed tab. What was recorded until then is not the
 * page's whole behaviour, so it is never analysed.
 */
export function interruptedFailure(cause: 'hard-limit' | 'crashed' | 'closed'): CaptureFailure {
  if (cause === 'hard-limit') return { reason: 'timeout', message: 'Timeout: hard limit for one page reached' };
  return { reason: 'other', message: cause === 'crashed' ? 'capture interrupted: the tab crashed' : 'capture interrupted: the tab was closed' };
}

/**
 * Decides from the final main document whether the page counts as captured.
 * Returns null for a normal page, otherwise the failure. `page` (title, text and links of the
 * page) recognises check pages with HTTP 200; without it only the title is used.
 */
export function classifyMainDocument(status: number, headers: Record<string, string>, title: string, page?: PageEvidence): CaptureFailure | null {
  const mitigated = headers['cf-mitigated'];
  if (mitigated !== undefined && /challenge/i.test(mitigated)) {
    return { reason: 'blocked', message: `challenge page (cf-mitigated: ${mitigated})`, status };
  }
  if (status === 401 || status === 403 || status === 429 || status === 451) {
    return { reason: 'blocked', message: `HTTP ${status}${title ? `, title "${title.slice(0, 80)}"` : ''}`, status };
  }
  if (status === 503 && CHALLENGE_TITLE.test(title)) {
    return { reason: 'blocked', message: `HTTP 503 challenge page, title "${title.slice(0, 80)}"`, status };
  }
  const checkPage = page === undefined ? null : checkPageReason(page);
  if (status === 503 && checkPage !== null) return { reason: 'blocked', message: `${checkPage}, HTTP 503`, status };
  if (status >= 400) return { reason: 'http-error', message: `HTTP ${status}`, status };
  if (status >= 200 && status < 300 && CHALLENGE_TITLE_STRONG.test(title.trim())) {
    return { reason: 'blocked', message: `challenge page with HTTP ${status}, title "${title}"`, status };
  }
  if (status < 200 || status >= 300) return { reason: 'other', message: `unexpected HTTP status ${status}`, status };
  if (checkPage !== null) return { reason: 'blocked', message: `${checkPage}, HTTP ${status}`, status };
  const type = mediaTypeOf(headers['content-type']);
  if (type !== null && !HTML_TYPES.has(type)) return { reason: 'not-html', message: `main document is not HTML (content type ${type.slice(0, 80)})`, status };
  return null;
}

/** Session fix-a6 (review finding 66): the content types a browser renders as the site's own page. */
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** The media type of a `Content-Type` value, lower case without parameters; null when there is none (the browser then sniffs). */
export function mediaTypeOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const type = (value.split(/[\n,]/)[0] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return type === '' ? null : type;
}

/** Page evidence of a capture, or undefined if the capture has no page snapshot. */
export function pageEvidenceOf(page: { title: string; text: string; links: readonly unknown[] } | null, requests?: number): PageEvidence | undefined {
  if (page === null) return undefined;
  return { title: page.title, text: page.text, links: page.links.length, ...(requests === undefined ? {} : { requests }) };
}

/**
 * The capture with its failure decided again from its own data (main document and page). For
 * captures saved before a classification rule existed, for example the check pages of A2 part 2:
 * such a capture becomes `blocked` instead of a normal page. A capture that an adapter stopped
 * with an error although the main document had answered (session fix-a1) is a failed capture, whatever
 * the adapter said. Returns the same object if nothing changes; never turns a failed capture into a
 * captured one.
 */
/**
 * Session fix-a5 (review finding 32): a capture stopped by the address rules because the name lookup failed
 * (`dns-error`: the resolver failed, did not answer in time, or the subrequests were used up) is a failed check
 * of our own (`other`), never `not-allowed`: the address was not refused, and a failed check is not reused by
 * the cache, so the next start tries again. Applied by the adapters and to every saved capture.
 */
export function recheckLookup(capture: Capture): Capture {
  const failure = capture.failure;
  if (capture.ok || failure === null || failure.reason !== 'not-allowed' || !isLookupFailure(failure.message)) return capture;
  return { ...capture, failure: { reason: 'other', message: `name lookup failed during the scan: ${failure.message.replace(/^not allowed: /, '')}` } };
}

export function recheckCapture(capture: Capture): Capture {
  if (!capture.ok) return recheckLookup(capture);
  if (capture.timings.stopReason === 'error') return { ...capture, ok: false, failure: { reason: 'other', message: 'capture interrupted before the page was read' } };
  if (capture.mainDocument === null) return capture;
  const { status, headers } = capture.mainDocument;
  const failure = classifyMainDocument(status, headers, capture.page?.title ?? '', pageEvidenceOf(capture.page, capture.requests.length));
  return failure === null ? capture : { ...capture, ok: false, failure };
}

/**
 * Session A5: the capture of an address the SSRF guard refused before the browser opened it. No
 * page was loaded and no request was sent; the message says which rule refused it.
 */
export function notAllowedCapture(adapter: Capture['adapter'], environment: Capture['environment'], requestedUrl: string, message: string, strategy?: Capture['strategy']): Capture {
  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    adapter,
    ...(strategy !== undefined ? { strategy } : {}),
    environment,
    requestedUrl,
    startedAt: new Date().toISOString(),
    ok: false,
    failure: { reason: 'not-allowed', message },
    finalUrl: null,
    mainDocument: null,
    requests: [],
    page: null,
    consentBanner: { detected: false, toolId: null, method: null, selector: null, visibleAtMs: null, toolsInDom: [] },
    axe: null,
    timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs: 0, stopReason: 'error' },
  };
}