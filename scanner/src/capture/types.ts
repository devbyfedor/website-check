/**
 * The capture: a plain data object that a capture adapter returns after loading one page.
 *
 * Capture and analysis are separate. Two adapters produce this shape: local Playwright on
 * the laptop (`scanner/src/local/`) and Cloudflare Browser Run (`worker/src/capture/`). Analyzers are pure
 * functions from a capture to findings and never touch a browser.
 *
 * All times are milliseconds since the capture start, which is the moment right before
 * navigation to the requested URL begins.
 */

import type { AxeCapture } from '../a11y/types.ts';
import type { HttpProbe, HttpsProbe } from '../security/types.ts';

export const CAPTURE_SCHEMA_VERSION = 1;

/**
 * `quick-fetch` (session A5 part 3): the quick check without a browser, when the day's browser time is used
 * up: the HTML and headers of the homepage and the Impressum, fetched under the SSRF rules.
 */
export type CaptureAdapterId = 'playwright-local' | 'cloudflare-browser-run' | 'quick-fetch';

/**
 * Session A5 part 3: where the site was visited from (Fedor, 21.11.2026: named in the report). On
 * Cloudflare it comes from Cloudflare's trace page, once per browser session (`browser-trace`), or for the
 * quick check from the Durable Object's own request (`object-trace`).
 */
export interface CaptureVisit {
  /** ISO 3166 country code (`loc` of the trace page), or null when unknown. */
  country: string | null;
  /** Cloudflare data center (`colo`), or null. */
  colo: string | null;
  source: 'browser-trace' | 'object-trace' | 'local';
}

/**
 * How the Cloudflare adapter collected the requests:
 * `cdp-events`: request events through the browser protocol, like the local adapter (the only strategy since
 * 21.11.2026);
 * `resource-timing`: legacy value. One call into the page that read the Resource Timing API, tried in session A2 and
 * deleted in session fix-a6. No code writes it any more; it stays in the type because captures saved in A2 and A3 carry
 * it and the analyzers and the report must keep reading them (`frameUnknown` treats them as before).
 */
export type CaptureStrategy = 'cdp-events' | 'resource-timing';

/** Why a page could not be captured. */
export type CaptureFailureReason =
  /** The page did not answer within the time limit. */
  | 'timeout'
  /** The site refused the scan (bot protection, challenge page, 401/403/429). */
  | 'blocked'
  /** Not a valid web address, or the host name does not exist. */
  | 'invalid-address'
  /** The host exists but could not be reached (connection refused or reset, TLS error). */
  | 'unreachable'
  /** The main document answered with an HTTP error status. */
  | 'http-error'
  /**
   * Session A5, SSRF protection: the address, one of its redirects or a later navigation of the
   * main document was refused before it was requested (not http or https, a port other than 80
   * or 443, a host name or address that is not public, more than 5 redirects). Nothing was sent there.
   */
  | 'not-allowed'
  /**
   * Session fix-a4: the page is larger than the scan records (more requests, more address text or more
   * data than `CAPTURE_LIMITS`). The scan stopped watching it; nothing is concluded from the part it saw.
   */
  | 'page-limit'
  | 'other';

export interface CaptureFailure {
  reason: CaptureFailureReason;
  /** Raw error text or a short description, for the local log. */
  message: string;
  /** HTTP status of the main document, if there was one. */
  status?: number;
}

export interface RequestInitiator {
  /** As reported by the browser, e.g. `parser`, `script`, `preload`, `other`. */
  type: string;
  /** Document, stylesheet or script that caused the request, when known. */
  url: string | null;
}

export interface CapturedRequest {
  /** Position in the order the browser started the requests, from 0. */
  seq: number;
  url: string;
  method: string;
  /** `document`, `stylesheet`, `script`, `image`, `font`, `xhr`, `fetch`, `websocket`, `ping`, `other`, … */
  resourceType: string;
  startMs: number;
  /** When the response finished or the request failed; null if it was still open at the end. */
  endMs: number | null;
  /** HTTP status; null if there was no response. */
  status: number | null;
  /** Network error text such as `net::ERR_BLOCKED_BY_CLIENT`; null if it did not fail. */
  failure: string | null;
  /** True if the request belongs to the top-level document (not to an iframe). */
  isMainFrame: boolean;
  /**
   * URLs of the iframes the request was made in, innermost first, up to (not including)
   * the top-level document. Frames without an http(s) URL (about:blank, srcdoc) are skipped.
   * Empty for requests of the top-level document.
   */
  frameUrls: string[];
  /**
   * Session fix-a1: false when the adapter could not tell which document made the request (on Cloudflare:
   * an iframe whose address never became known, a CORS preflight without its request, a web worker whose
   * script request was not seen). Then `isMainFrame` is false and `frameUrls` is empty, and the request
   * is never taken for one of the top-level page. Missing in captures made before; `frameUnknown`
   * (`scanner/src/capture/frames.ts`) decides for both.
   */
  frameKnown?: boolean;
  /** True for navigation requests (the main document and iframe documents). */
  isNavigation: boolean;
  /** Best effort: who triggered the request. Null when the adapter cannot tell. */
  initiator: RequestInitiator | null;
  /** If this request is a redirect target: the URL that redirected to it. */
  redirectedFrom: string | null;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface MainDocument {
  /** HTTP status of the final main document response. */
  status: number;
  /** Response headers of the final main document, header names in lower case. */
  headers: Record<string, string>;
  /** Hops before the final URL, in order (empty if there was no redirect). */
  redirectChain: RedirectHop[];
  /**
   * Session fix-a4: names of headers that are not in `headers` because their value is longer than the limit
   * (or the response has more header text than the budget). Such a header is not analysed: "bitte manuell
   * prüfen", never "fehlt". Missing when every header was kept.
   */
  headersCut?: string[];
}

export interface PageLink {
  /** Absolute URL as resolved by the browser. */
  href: string;
  /** Visible link text, trimmed, at most 200 characters (aria-label or title when the link has no text). */
  text: string;
  /**
   * Session A4: true if the link sits in the page footer (`<footer>`, `role="contentinfo"`, or an
   * element whose id or class names a footer and that holds no header or main part). Missing in older captures.
   */
  footer?: boolean;
}

/**
 * Session A4: what the page itself shows about the system it runs on, read once at the end of the
 * visit from fixed lists (`scanner/src/platform/fingerprints.ts`, documented in `docs/cms-fingerprints.md`).
 */
export interface PlatformHints {
  /** Contents of `<meta name="generator">`, at most 5, each at most 120 characters. */
  generators: string[];
  /** Known JavaScript globals (dotted paths such as `Shopify.shop`) that exist in the page. */
  globals: string[];
  /** Known CSS selectors that match an element of the page. */
  selectors: string[];
}

export interface PageSnapshot {
  /**
   * Session A4: the document's own address (`location.href`), which link addresses are resolved
   * against; it can differ from the response URL (history.replaceState, `<base href>`). Missing in older captures.
   */
  url?: string;
  title: string;
  /** Value of `<html lang>`, or null if missing. */
  lang: string | null;
  /** Visible text of the page (`innerText`), possibly truncated. */
  text: string;
  textTruncated: boolean;
  links: PageLink[];
  /**
   * True when the page has links that are not in `links`: more than the cap, or (session fix-a4) links whose
   * address is longer than the limit or that no longer fit the page's budget for links.
   */
  linksTruncated: boolean;
  /**
   * Security settings made by meta tags instead of headers (session A3): the first
   * `<meta http-equiv="Content-Security-Policy">` and `<meta name="referrer">`. Missing in older captures.
   */
  securityMeta?: SecurityMeta;
  /** Session A4: system hints (generator, globals, selectors). Missing in older captures and on the Impressum page. */
  platform?: PlatformHints;
}

/**
 * Session A4: the Impressum page, opened in a second tab of the same browser after the homepage was
 * captured. Only text and links are read: no accessibility check, no request analysis, no interaction.
 */
export interface ImpressumCapture {
  /** The address the adapter opened: the Impressum link chosen on the homepage (`chooseImpressumTarget`). */
  url: string;
  ok: boolean;
  failure: CaptureFailure | null;
  finalUrl: string | null;
  /** HTTP status of the Impressum document; null if there was no response. */
  status: number | null;
  page: PageSnapshot | null;
  /** Requests the second tab started (counted only, not analysed). */
  requestCount: number;
  timings: ImpressumTimings;
}

export interface ImpressumTimings {
  /** When the second tab was opened, in ms since the start of the homepage capture. */
  openedAtMs: number;
  /** From opening the tab: DOMContentLoaded of the Impressum, or null. */
  domContentLoadedMs: number | null;
  /** From opening the tab: when the text was read. */
  snapshotMs: number | null;
  /** Browser time of the Impressum: from opening the tab until it was closed. */
  totalMs: number;
  /** `fetched`: the quick check read the HTML as the server sent it (no browser, no waiting). */
  stopReason: 'text-stable' | 'max-wait' | 'fetched' | 'error';
}

export interface SecurityMeta {
  csp: string | null;
  referrer: string | null;
}

export interface ConsentBannerObservation {
  /** True if a consent banner was seen visible on the screen. */
  detected: boolean;
  /** Id from `scanner/data/consent-tools.json`, `generic` for the text heuristic, or null. */
  toolId: string | null;
  method: 'selector' | 'heuristic' | null;
  /** The selector or element that matched. */
  selector: string | null;
  /** When the banner became visible. Best effort: never base a finding on it alone. */
  visibleAtMs: number | null;
  /** Consent tools whose banner element was present in the page, visible or not. */
  toolsInDom: string[];
  /**
   * What consent tools report about consent at the end of the visit, read from their public
   * JavaScript APIs (best effort, null if the tool is absent). The scan never consents, so a
   * reported consent means the tool consented on its own (for example for bots).
   */
  signals?: ConsentSignals;
}

export interface ConsentSignals {
  /** `Cookiebot.consent.method` is `implied` for automatic consent, `explicit` for a user decision */
  cookiebot: { consented: boolean; declined: boolean; method: string | null } | null;
  /** `UC_UI.areAllConsentsAccepted()` */
  usercentrics: { allAccepted: boolean } | null;
}

export interface CaptureEnvironment {
  /** e.g. `chromium 141.0.7390.37` */
  browser: string;
  userAgent: string;
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
}

export interface CaptureTimings {
  /** DOMContentLoaded of the main document. */
  domContentLoadedMs: number | null;
  /** Load event of the main document. */
  loadMs: number | null;
  /** When the network became quiet; null if it never did within the limit. */
  networkQuietMs: number | null;
  /** When the adapter stopped watching the page. */
  endMs: number;
  /** `fetched`: the quick check without a browser (session A5 part 3). */
  stopReason: 'network-quiet' | 'max-wait' | 'fetched' | 'error';
}

export interface Capture {
  schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
  adapter: CaptureAdapterId;
  /** Set by the Cloudflare adapter; the local adapter always records CDP request events. */
  strategy?: CaptureStrategy;
  environment: CaptureEnvironment;
  requestedUrl: string;
  /** ISO 8601 time of the capture start. */
  startedAt: string;
  /** True if the main document loaded with a 2xx status. */
  ok: boolean;
  failure: CaptureFailure | null;
  /** URL of the main document after all redirects; null if navigation failed early. */
  finalUrl: string | null;
  mainDocument: MainDocument | null;
  /** Every request the page made, in start order, including those inside iframes. */
  requests: CapturedRequest[];
  page: PageSnapshot | null;
  consentBanner: ConsentBannerObservation;
  /**
   * Accessibility results of the pinned axe-core on the top-level document (session A3); null in
   * captures made before A3 or when the adapter was told not to run it.
   */
  axe: AxeCapture | null;
  /**
   * The redirect from http:// to https://, checked with plain HTTP requests in parallel to the
   * page load (no browser time). Missing or null when not checked.
   */
  httpProbe?: HttpProbe | null;
  /**
   * Session fix-a2: one plain request to the https:// address, made only when the requested address starts
   * with http://. Missing in older captures and for addresses entered with https://; null when it could not run.
   */
  httpsProbe?: HttpsProbe | null;
  /**
   * Session A4: the Impressum page in a second tab. Missing in older captures and when the adapter was
   * told not to open it; null when the homepage has no Impressum link that can be opened (none, a PDF,
   * a `javascript:` link, or an anchor on the homepage itself).
   */
  impressum?: ImpressumCapture | null;
  /** Session A5 part 3: where the site was visited from. Missing in older captures and in local runs. */
  visit?: CaptureVisit | null;
  /**
   * Session fix-a4: set when `limitCapture` cut strings of the page to their limits (`CAPTURE_LIMITS`):
   * how many. The start of each string is kept. Links that were left out are `linksTruncated` of the page,
   * headers that were left out `mainDocument.headersCut`.
   */
  limited?: { strings: number };
  timings: CaptureTimings;
}
