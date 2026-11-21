import type { Capture } from '../capture/types.ts';
import type { HttpProbeOutcome } from '../security/types.ts';

/**
 * Basic security (session A3): HTTPS, the redirect from http to https, and five headers of the
 * main document. A pure function of the capture, tested without a browser or network.
 *
 * Every check states the technical fact. No law names these headers, so the texts never call a
 * missing header a violation; when the scanner cannot tell, the result is `manual`.
 */

export const SECURITY_ANALYSIS_VERSION = 1;

export const SECURITY_HEADERS = [
  { key: 'hsts', header: 'strict-transport-security' },
  { key: 'csp', header: 'content-security-policy' },
  { key: 'xcto', header: 'x-content-type-options' },
  { key: 'referrer-policy', header: 'referrer-policy' },
  { key: 'permissions-policy', header: 'permissions-policy' },
] as const;

export type SecurityHeaderKey = (typeof SECURITY_HEADERS)[number]['key'];
export type SecurityHeaderName = (typeof SECURITY_HEADERS)[number]['header'];

export type HeaderStatus =
  /** Set as a header with a usable value. */
  | 'present'
  /** Not set. */
  | 'missing'
  /** Set, but browsers ignore it or it switches the protection off (detail says why). */
  | 'invalid'
  /** Not a header, but set by a meta tag in the page (CSP, referrer): counts as present. */
  | 'meta'
  /** Only `Content-Security-Policy-Report-Only`: reports, blocks nothing. */
  | 'report-only'
  /** Only the old `Feature-Policy` instead of `Permissions-Policy`. */
  | 'legacy';

export interface HeaderCheck {
  key: SecurityHeaderKey;
  header: SecurityHeaderName;
  status: HeaderStatus;
  /** Counts for "{n} von 5". */
  counts: boolean;
  /** The value that was evaluated, at most 300 characters. */
  value: string | null;
  /** Short machine-readable reason, for example `max-age=0`, `not-https`, `directives: default-src, script-src`. */
  detail: string | null;
  /** Id of the draft text in `docs/content-drafts.md`; null when present. */
  textId: string | null;
}

export type CheckResult = 'pass' | 'fail' | 'manual' | 'info' | 'not-checked';

export interface SecurityAnalysis {
  version: typeof SECURITY_ANALYSIS_VERSION;
  https: { result: 'pass' | 'fail' | 'manual'; finalUrl: string | null; textId: string };
  httpRedirect: { result: CheckResult; outcome: HttpProbeOutcome | null; httpsTarget: string | null; textId: string | null };
  headers: HeaderCheck[];
  headersPresent: number;
  headersTotal: number;
}

const REFERRER_TOKENS = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

function clip(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.length > 300 ? value.slice(0, 300) : value;
}

/** Browsers and adapters join repeated headers with a line break or a comma. */
function firstValue(value: string): string {
  return (value.split(/\n/)[0] ?? '').trim();
}

function check(key: SecurityHeaderKey, header: SecurityHeaderName, status: HeaderStatus, value: string | null, detail: string | null = null): HeaderCheck {
  const counts = status === 'present' || status === 'meta';
  const textId = counts && status === 'present' ? null : status === 'meta' ? `security-header-${key}-meta` : status === 'report-only' ? 'security-header-csp-report-only' : status === 'legacy' ? 'security-header-permissions-policy-legacy' : `security-header-${key}-${status}`;
  return { key, header, status, counts, value: clip(value), detail, textId };
}

/** RFC 6797: only the first header counts; `max-age` is required, 0 removes the policy. */
export function checkHsts(value: string | undefined, isHttps: boolean): HeaderCheck {
  if (value === undefined || value.trim() === '') return check('hsts', 'strict-transport-security', 'missing', null);
  const first = (firstValue(value).split(',')[0] ?? '').trim();
  if (!isHttps) return check('hsts', 'strict-transport-security', 'invalid', first, 'not-https');
  const match = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?\s*(?:;|$)/i.exec(first);
  if (match === null) return check('hsts', 'strict-transport-security', 'invalid', first, 'no-max-age');
  const maxAge = Number(match[1]);
  if (maxAge === 0) return check('hsts', 'strict-transport-security', 'invalid', first, 'max-age=0');
  return check('hsts', 'strict-transport-security', 'present', first, `max-age=${maxAge}`);
}

function directivesOf(policy: string): string[] {
  return policy
    .split(/[;,]/)
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
    .filter((name) => name !== '');
}

export function checkCsp(value: string | undefined, reportOnly: string | undefined, meta: string | null): HeaderCheck {
  if (value !== undefined && value.trim() !== '') {
    const policy = value.replace(/\n/g, ', ').trim();
    return check('csp', 'content-security-policy', 'present', policy, `directives: ${[...new Set(directivesOf(policy))].join(', ')}`);
  }
  if (meta !== null && meta.trim() !== '') return check('csp', 'content-security-policy', 'meta', meta.trim(), `directives: ${[...new Set(directivesOf(meta))].join(', ')}`);
  if (reportOnly !== undefined && reportOnly.trim() !== '') return check('csp', 'content-security-policy', 'report-only', reportOnly.trim());
  return check('csp', 'content-security-policy', 'missing', null);
}

export function checkXcto(value: string | undefined): HeaderCheck {
  if (value === undefined || value.trim() === '') return check('xcto', 'x-content-type-options', 'missing', null);
  const first = (firstValue(value).split(',')[0] ?? '').trim();
  return first.toLowerCase() === 'nosniff' ? check('xcto', 'x-content-type-options', 'present', first) : check('xcto', 'x-content-type-options', 'invalid', first, 'not-nosniff');
}

/** The browser uses the last token it knows; unknown tokens are skipped. */
export function checkReferrerPolicy(value: string | undefined, meta: string | null): HeaderCheck {
  const known = (raw: string): string[] => raw.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter((t) => REFERRER_TOKENS.has(t));
  if (value !== undefined && value.trim() !== '') {
    const tokens = known(value);
    const policy = value.replace(/\n/g, ', ').trim();
    return tokens.length > 0 ? check('referrer-policy', 'referrer-policy', 'present', policy, `effective: ${tokens.at(-1)}`) : check('referrer-policy', 'referrer-policy', 'invalid', policy, 'no-known-token');
  }
  if (meta !== null && known(meta).length > 0) return check('referrer-policy', 'referrer-policy', 'meta', meta.trim(), `effective: ${known(meta).at(-1)}`);
  return check('referrer-policy', 'referrer-policy', 'missing', null);
}

/** Structured field: `feature=(allowlist)`, comma separated. Without any `=` browsers ignore it. */
export function checkPermissionsPolicy(value: string | undefined, featurePolicy: string | undefined): HeaderCheck {
  if (value !== undefined && value.trim() !== '') {
    const policy = value.replace(/\n/g, ', ').trim();
    return policy.includes('=') ? check('permissions-policy', 'permissions-policy', 'present', policy) : check('permissions-policy', 'permissions-policy', 'invalid', policy, 'no-feature');
  }
  if (featurePolicy !== undefined && featurePolicy.trim() !== '') return check('permissions-policy', 'permissions-policy', 'legacy', featurePolicy.trim());
  return check('permissions-policy', 'permissions-policy', 'missing', null);
}

function redirectResult(outcome: HttpProbeOutcome | null): { result: CheckResult; textId: string | null } {
  switch (outcome) {
    case 'redirects-to-https':
      return { result: 'pass', textId: 'security-http-redirect-ok' };
    case 'no-redirect':
      return { result: 'fail', textId: 'security-http-no-redirect' };
    case 'unavailable':
      return { result: 'info', textId: 'security-http-unavailable' };
    case 'http-error':
    case 'timeout':
    case 'too-many-redirects':
    case 'stopped':
      return { result: 'manual', textId: 'security-http-redirect-manual' };
    case null:
      return { result: 'not-checked', textId: null };
  }
}

export function analyzeSecurity(capture: Capture): SecurityAnalysis {
  let protocol: string | null = null;
  try {
    protocol = capture.finalUrl === null ? null : new URL(capture.finalUrl).protocol;
  } catch {
    protocol = null;
  }
  const isHttps = protocol === 'https:';
  const https: SecurityAnalysis['https'] =
    protocol === 'https:'
      ? { result: 'pass', finalUrl: capture.finalUrl, textId: 'security-https-ok' }
      : protocol === 'http:'
        ? { result: 'fail', finalUrl: capture.finalUrl, textId: 'security-https-missing' }
        : { result: 'manual', finalUrl: capture.finalUrl, textId: 'security-https-missing' };
  const probe = capture.httpProbe ?? null;
  const redirect = redirectResult(probe?.outcome ?? null);
  const h = capture.mainDocument?.headers ?? {};
  const meta = capture.page?.securityMeta ?? null;
  const headers = [
    checkHsts(h['strict-transport-security'], isHttps),
    checkCsp(h['content-security-policy'], h['content-security-policy-report-only'], meta?.csp ?? null),
    checkXcto(h['x-content-type-options']),
    checkReferrerPolicy(h['referrer-policy'], meta?.referrer ?? null),
    checkPermissionsPolicy(h['permissions-policy'], h['feature-policy']),
  ];
  return {
    version: SECURITY_ANALYSIS_VERSION,
    https,
    httpRedirect: { ...redirect, outcome: probe?.outcome ?? null, httpsTarget: probe?.httpsTarget ?? null },
    headers,
    headersPresent: headers.filter((c) => c.counts).length,
    headersTotal: headers.length,
  };
}
