import type { CaptureFailure, CaptureFailureReason } from './types.ts';

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
/** Only unambiguous challenge titles count when the status is 2xx. */
const CHALLENGE_TITLE_STRONG = /^(?:just a moment\.*|attention required!?.*|checking your browser.*|ddos-guard)$/i;

/**
 * Decides from the final main document whether the page counts as captured.
 * Returns null for a normal page, otherwise the failure.
 */
export function classifyMainDocument(status: number, headers: Record<string, string>, title: string): CaptureFailure | null {
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
  if (status >= 400) return { reason: 'http-error', message: `HTTP ${status}`, status };
  if (status >= 200 && status < 300 && CHALLENGE_TITLE_STRONG.test(title.trim())) {
    return { reason: 'blocked', message: `challenge page with HTTP ${status}, title "${title}"`, status };
  }
  if (status < 200 || status >= 300) return { reason: 'other', message: `unexpected HTTP status ${status}`, status };
  return null;
}
