import type { Capture, CaptureFailure, CaptureFailureReason } from './types.ts';

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
  /just a moment|attention required|access denied|zugriff verweigert|request (?:blocked|rejected)|are you a (?:robot|human)|captcha|ddos[- ]guard|security check|bot (?:check|protection)|sucuri website firewall|checking your browser|sicherheits(?:über)?prüfung|browserprüfung/i;
/** Only unambiguous challenge titles count on their own when the status is 2xx. */
const CHALLENGE_TITLE_STRONG = /^(?:just a moment\.*|attention required!?.*|checking your browser.*|ddos-guard)$/i;

/**
 * What the page showed at the end of the visit, for recognising check pages: the title, the
 * visible text and the number of links.
 */
export interface PageEvidence {
  title: string;
  text: string;
  links: number;
}

/**
 * Check pages of web hosts and bot protection that answer with HTTP 200 (A2 part 2): a short
 * "please wait" title or a sentence saying that the request or the browser is being checked,
 * on a page that is almost empty. Seen on a test site: title "Einen Moment bitte …", text
 * "Bitte warten Sie, während Ihre Anfrage geprüft wird …", no links. A normal page with such a
 * phrase somewhere has more text and links, so it stays a normal page.
 */
const END = String.raw`(?=$|[\s.,:;!?…–-])`;
const WAIT_TITLE = new RegExp(
  String.raw`^(?:einen? moment,? bitte|bitte (?:kurz )?warten|one moment,? please|please wait|sicherheits(?:über)?prüfung|browserprüfung|überprüfung (?:ihres browsers|läuft)|verifying (?:your browser|you are human))${END}`,
  'iu',
);
// Not "Ihre Anfrage wird geprüft" alone: a thank-you page after a contact form says that too.
const CHECK_TEXT =
  /während (?:wir )?ihre anfrage (?:geprüft|überprüft)|ihr browser wird (?:geprüft|überprüft)|überprüfung ihres browsers|wir (?:prüfen|überprüfen) ihren browser|checking your browser|checking if the site connection is secure|verify(?:ing)? (?:that )?you are (?:a )?human|your request is being (?:checked|verified)/iu;
/** "Almost empty": what a check page shows, far less than any homepage. */
const CHECK_PAGE_MAX_TEXT = 600;
const CHECK_PAGE_MAX_LINKS = 3;

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Null for a normal page, otherwise why the page is a check page. */
export function checkPageReason(page: PageEvidence): string | null {
  const title = normalize(page.title);
  const text = normalize(page.text);
  if (text.length > CHECK_PAGE_MAX_TEXT || page.links > CHECK_PAGE_MAX_LINKS) return null;
  const titleMatch = WAIT_TITLE.test(title);
  const textMatch = CHECK_TEXT.exec(text);
  if (!titleMatch && textMatch === null) return null;
  const parts = [titleMatch ? `title "${title.slice(0, 80)}"` : null, textMatch !== null ? `text "${textMatch[0]}"` : null];
  return `check page: ${parts.filter((p) => p !== null).join(', ')}, ${text.length} characters, ${page.links} links`;
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
  return null;
}

/** Page evidence of a capture, or undefined if the capture has no page snapshot. */
export function pageEvidenceOf(page: { title: string; text: string; links: readonly unknown[] } | null): PageEvidence | undefined {
  return page === null ? undefined : { title: page.title, text: page.text, links: page.links.length };
}

/**
 * The capture with its failure decided again from its own data (main document and page). For
 * captures saved before a classification rule existed, for example the check pages of A2 part 2:
 * such a capture becomes `blocked` instead of a normal page. Returns the same object if nothing
 * changes; never turns a failed capture into a captured one.
 */
export function recheckCapture(capture: Capture): Capture {
  if (!capture.ok || capture.mainDocument === null) return capture;
  const { status, headers } = capture.mainDocument;
  const failure = classifyMainDocument(status, headers, capture.page?.title ?? '', pageEvidenceOf(capture.page));
  return failure === null ? capture : { ...capture, ok: false, failure };
}
