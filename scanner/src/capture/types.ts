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

export const CAPTURE_SCHEMA_VERSION = 1;

export type CaptureAdapterId = 'playwright-local' | 'cloudflare-browser-run';

/**
 * How the Cloudflare adapter collected the requests (session A2 measures both):
 * `cdp-events`: request events through the browser protocol, like the local adapter;
 * `resource-timing`: one call into the page that reads the Resource Timing API.
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
}

export interface PageLink {
  /** Absolute URL as resolved by the browser. */
  href: string;
  /** Visible link text, trimmed, at most 200 characters. */
  text: string;
}

export interface PageSnapshot {
  title: string;
  /** Value of `<html lang>`, or null if missing. */
  lang: string | null;
  /** Visible text of the page (`innerText`), possibly truncated. */
  text: string;
  textTruncated: boolean;
  links: PageLink[];
  linksTruncated: boolean;
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
  stopReason: 'network-quiet' | 'max-wait' | 'error';
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
  /** Accessibility results: filled from session A3 on. */
  axe: null;
  timings: CaptureTimings;
}
