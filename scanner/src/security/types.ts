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
  /** The http:// address answers 2xx without any redirect. */
  | 'no-redirect'
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
  /** The https:// address the chain ends at (`redirects-to-https` only). */
  httpsTarget: string | null;
  durationMs: number;
}
