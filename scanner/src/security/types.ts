/**
 * Security part of the capture (session A3): the redirect from http to https, checked with
 * plain HTTP requests and no browser (browser minutes are the narrowest limit). HTTPS and the
 * five headers come from the main document the browser loaded (`Capture.mainDocument`).
 */

export interface HttpProbeHop {
  url: string;
  /** HTTP status; null if the request failed. */
  status: number | null;
  /** Location header of a redirect, resolved against the hop's URL. */
  location: string | null;
  /** Network error text when the request failed. */
  error: string | null;
}

export type HttpProbeOutcome =
  /** A chain of HTTP redirects reaches an https:// address (not requested itself). */
  | 'redirects-to-https'
  /** The http:// address answers 2xx with a page that holds no redirect to https:// the check can see. */
  | 'no-redirect'
  /**
   * Session fix-a2: the http:// address answers 2xx, and its `Refresh` header or a meta refresh of the
   * page sends the browser to an https:// address. The redirect happens in the browser, not on the server.
   */
  | 'redirects-in-page'
  /**
   * Session fix-a2: the http:// address answers 2xx with a page whose inline script changes the address
   * and names https. Whether it redirects is known only in a browser: manual check.
   */
  | 'script-may-redirect'
  /** The http:// address answers 4xx or 5xx (could be bot protection: manual check). */
  | 'http-error'
  /** No answer on http:// at all: connection refused, reset, DNS or TLS error. */
  | 'unavailable'
  /** No answer within the time limit. */
  | 'timeout'
  /** More redirects than allowed, all on http://. */
  | 'too-many-redirects'
  /** A redirect without a usable Location, or to an address the scanner must not open. */
  | 'stopped';

export interface HttpProbe {
  /** The http:// address that was requested first. */
  url: string;
  startedAt: string;
  outcome: HttpProbeOutcome;
  hops: HttpProbeHop[];
  /** The https:// address the chain ends at (`redirects-to-https` and `redirects-in-page`). */
  httpsTarget: string | null;
  durationMs: number;
}

/** Session fix-a2: what one request to the https:// address of a site entered with http:// gave. */
export type HttpsProbeOutcome =
  /** https:// answers with a page (2xx) or with a redirect that stays on https://. */
  | 'answers'
  /** https:// answers with a redirect to an http:// address. */
  | 'redirects-to-http'
  /** https:// answers 4xx or 5xx (could be bot protection: manual check). */
  | 'http-error'
  /** No connection on https://: refused, reset, or a certificate the client does not accept. */
  | 'unavailable'
  /** No answer within the time limit. */
  | 'timeout'
  /** The address must not be opened, or a redirect without a usable address. */
  | 'stopped';

/**
 * Session fix-a2: the scan of an address entered with http:// asks its https:// address once, with a plain
 * request. Only then can the report say that the site has no HTTPS. No body is read.
 */
export interface HttpsProbe {
  /** The https:// address that was requested. */
  url: string;
  startedAt: string;
  outcome: HttpsProbeOutcome;
  status: number | null;
  /** Location header of a redirect, resolved against `url`. */
  location: string | null;
  error: string | null;
  durationMs: number;
}
