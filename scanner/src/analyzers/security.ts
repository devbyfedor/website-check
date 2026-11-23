import type { Capture } from '../capture/types.ts';
import type { HttpProbeOutcome } from '../security/types.ts';

/**
 * Basic security (session A3): HTTPS, the redirect from http to https, and five headers of the
 * main document. A pure function of the capture, tested without a browser or network.
 *
 * Every check states the technical fact. No law names these headers, so the texts never call a
 * missing header a violation; when the scanner cannot tell, the result is `manual`.
 */

export const SECURITY_ANALYSIS_VERSION = 3;

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
  | 'legacy'
  /** No header, and the page's meta tags could not be read (no page snapshot): bitte manuell prüfen. */
  | 'manual';

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

function defaultTextId(key: SecurityHeaderKey, status: HeaderStatus): string | null {
  switch (status) {
    case 'present':
      return null;
    case 'meta':
      return `security-header-${key}-meta`;
    case 'report-only':
      return 'security-header-csp-report-only';
    case 'legacy':
      return 'security-header-permissions-policy-legacy';
    case 'missing':
    case 'invalid':
    case 'manual':
      return `security-header-${key}-${status}`;
  }
}

function check(
  key: SecurityHeaderKey,
  header: SecurityHeaderName,
  status: HeaderStatus,
  value: string | null,
  detail: string | null = null,
  textId: string | null = defaultTextId(key, status),
): HeaderCheck {
  return { key, header, status, counts: status === 'present' || status === 'meta', value: clip(value), detail, textId };
}

/**
 * RFC 6797: only the first header counts; `max-age` is required, 0 removes the policy. On a page
 * without HTTPS the header has no effect and gets no text of its own: `security-https-missing` covers it.
 */
export function checkHsts(value: string | undefined, isHttps: boolean): HeaderCheck {
  const set = value !== undefined && value.trim() !== '';
  const first = set ? (firstValue(value).split(',')[0] ?? '').trim() : null;
  if (!isHttps) return check('hsts', 'strict-transport-security', set ? 'invalid' : 'missing', first, 'not-https', null);
  if (first === null) return check('hsts', 'strict-transport-security', 'missing', null);
  const match = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?\s*(?:;|$)/i.exec(first);
  if (match === null) return check('hsts', 'strict-transport-security', 'invalid', first, 'no-max-age', 'security-header-hsts-no-max-age');
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

/** `meta`: the content of the meta tag, null if there is none, undefined if the page's meta tags were not read. */
export function checkCsp(value: string | undefined, reportOnly: string | undefined, meta: string | null | undefined): HeaderCheck {
  if (value !== undefined && value.trim() !== '') {
    const policy = value.replace(/\n/g, ', ').trim();
    return check('csp', 'content-security-policy', 'present', policy, `directives: ${[...new Set(directivesOf(policy))].join(', ')}`);
  }
  if (meta !== null && meta !== undefined && meta.trim() !== '') return check('csp', 'content-security-policy', 'meta', meta.trim(), `directives: ${[...new Set(directivesOf(meta))].join(', ')}`);
  // Unknown meta tags: a meta CSP would count, so neither report-only nor missing is certain.
  if (meta === undefined) return check('csp', 'content-security-policy', 'manual', reportOnly?.trim() || null, 'meta-not-read');
  if (reportOnly !== undefined && reportOnly.trim() !== '') return check('csp', 'content-security-policy', 'report-only', reportOnly.trim());
  return check('csp', 'content-security-policy', 'missing', null);
}

export function checkXcto(value: string | undefined): HeaderCheck {
  if (value === undefined || value.trim() === '') return check('xcto', 'x-content-type-options', 'missing', null);
  const first = (firstValue(value).split(',')[0] ?? '').trim();
  return first.toLowerCase() === 'nosniff' ? check('xcto', 'x-content-type-options', 'present', first) : check('xcto', 'x-content-type-options', 'invalid', first, 'not-nosniff');
}

/**
 * Old values that the HTML standard still accepts in `<meta name="referrer">` (not in the header):
 * never, default, always, origin-when-crossorigin.
 */
const LEGACY_META_REFERRER: Record<string, string> = {
  never: 'no-referrer',
  default: 'strict-origin-when-cross-origin',
  always: 'unsafe-url',
  'origin-when-crossorigin': 'origin-when-cross-origin',
};

/** The browser uses the last token it knows; unknown tokens are skipped. A valid meta tag wins over an unusable header. */
export function checkReferrerPolicy(value: string | undefined, meta: string | null | undefined): HeaderCheck {
  const known = (raw: string): string[] => raw.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter((t) => REFERRER_TOKENS.has(t));
  const metaPolicy = ((): string | null => {
    if (meta === null || meta === undefined) return null;
    const token = meta.trim().toLowerCase();
    return REFERRER_TOKENS.has(token) ? token : (LEGACY_META_REFERRER[token] ?? null);
  })();
  let invalidHeader: string | null = null;
  if (value !== undefined && value.trim() !== '') {
    const tokens = known(value);
    const policy = value.replace(/\n/g, ', ').trim();
    if (tokens.length > 0) return check('referrer-policy', 'referrer-policy', 'present', policy, `effective: ${tokens.at(-1)}`);
    invalidHeader = policy;
  }
  if (meta !== null && meta !== undefined && metaPolicy !== null) return check('referrer-policy', 'referrer-policy', 'meta', meta.trim(), `effective: ${metaPolicy}`);
  // Unknown meta tags: a valid meta tag would win over an unusable or missing header.
  if (meta === undefined) return check('referrer-policy', 'referrer-policy', 'manual', invalidHeader, 'meta-not-read');
  if (invalidHeader !== null) return check('referrer-policy', 'referrer-policy', 'invalid', invalidHeader, 'no-known-token');
  return check('referrer-policy', 'referrer-policy', 'missing', null);
}

/** Features that browsers no longer know; a header with nothing else restricts nothing. */
const RETIRED_FEATURES = new Set(['interest-cohort']);

const SF_KEY = /^[a-z*][a-z0-9_.*-]*/;
const SF_TOKEN = /^[A-Za-z*][A-Za-z0-9!#$%&'*+.^_`|~:/-]*/;
const SF_STRING = /^"(?:[^"\\\x00-\x1f\x7f]|\\["\\])*"/;
const SF_NUMBER = /^-?\d{1,15}(?:\.\d{1,3})?/;

/**
 * Members of a Structured Field dictionary (RFC 8941) as browsers parse Permissions-Policy, or null
 * if the value does not parse: then Chromium drops the whole header. Values are bare items (token,
 * string, number, boolean) or inner lists of them, each with optional parameters. A member without
 * `=` is a boolean and gives no allowlist, so it is listed in `bare`.
 */
export function parseSfDictionaryKeys(input: string): { keys: string[]; bare: string[] } | null {
  let s = input.replace(/^[ \t]+|[ \t]+$/g, '');
  const keys: string[] = [];
  const bare: string[] = [];
  const bareItem = (): boolean => {
    for (const re of [SF_STRING, SF_TOKEN, SF_NUMBER, /^\?[01]/]) {
      const m = re.exec(s);
      if (m !== null) {
        s = s.slice(m[0].length);
        return true;
      }
    }
    return false;
  };
  const params = (): boolean => {
    while (s.startsWith(';')) {
      s = s.slice(1).replace(/^ +/, '');
      const key = SF_KEY.exec(s);
      if (key === null) return false;
      s = s.slice(key[0].length);
      if (s.startsWith('=')) {
        s = s.slice(1);
        if (!bareItem()) return false;
      }
    }
    return true;
  };
  if (s === '') return { keys, bare };
  for (;;) {
    const key = SF_KEY.exec(s);
    if (key === null) return null;
    s = s.slice(key[0].length);
    if (s.startsWith('=')) keys.push(key[0]);
    else bare.push(key[0]);
    if (s.startsWith('=')) {
      s = s.slice(1);
      if (s.startsWith('(')) {
        s = s.slice(1);
        for (;;) {
          s = s.replace(/^ +/, '');
          if (s.startsWith(')')) {
            s = s.slice(1);
            break;
          }
          if (!bareItem() || !params()) return null;
          if (!s.startsWith(' ') && !s.startsWith(')')) return null;
        }
        if (!params()) return null;
      } else if (!bareItem() || !params()) return null;
    } else if (!params()) return null;
    s = s.replace(/^[ \t]+/, '');
    if (s === '') return { keys, bare };
    if (!s.startsWith(',')) return null;
    s = s.slice(1).replace(/^[ \t]+/, '');
    if (s === '') return null;
  }
}

/** Structured field: `feature=(allowlist)`, comma separated. A value that does not parse, or only retired features, restricts nothing. */
export function checkPermissionsPolicy(value: string | undefined, featurePolicy: string | undefined): HeaderCheck {
  if (value !== undefined && value.trim() !== '') {
    const policy = value.replace(/\n/g, ', ').trim();
    const parsed = parseSfDictionaryKeys(policy);
    if (parsed === null) return check('permissions-policy', 'permissions-policy', 'invalid', policy, 'not-structured-field');
    const keys = parsed.keys;
    const ignored = [...keys.filter((k) => RETIRED_FEATURES.has(k)), ...parsed.bare];
    if (keys.every((k) => RETIRED_FEATURES.has(k)))
      return check('permissions-policy', 'permissions-policy', 'invalid', policy, keys.length === 0 ? 'no-feature' : `only retired features: ${ignored.join(', ')}`);
    return check('permissions-policy', 'permissions-policy', 'present', policy, ignored.length > 0 ? `ignored: ${ignored.join(', ')}` : null);
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
    // Session fix-a2: a page that sends the browser on to https:// (Refresh header, meta refresh) is no
    // missing redirect; the visitor ends on https. A neutral note that the server itself does not redirect.
    case 'redirects-in-page':
      return { result: 'info', textId: 'security-http-redirect-in-page' };
    case 'unavailable':
      return { result: 'info', textId: 'security-http-unavailable' };
    case 'http-error':
    case 'timeout':
    case 'too-many-redirects':
    case 'stopped':
    // A script that may redirect is decided only in a browser, and a refresh to another http:// address
    // leads to a page that was not looked at: unsure means manual check.
    case 'script-may-redirect':
    case 'refresh-to-http':
    case 'page-not-read':
      return { result: 'manual', textId: 'security-http-redirect-manual' };
    case null:
      return { result: 'not-checked', textId: null };
    // An outcome this version does not know (a capture of a later version) is never a finding.
    default:
      return { result: 'manual', textId: 'security-http-redirect-manual' };
  }
}

function protocolOf(url: string | null): string | null {
  try {
    return url === null ? null : new URL(url).protocol;
  } catch {
    return null;
  }
}

/** The host of an address without a leading "www.", or null. */
function hostOfUrl(url: string | null): string | null {
  try {
    return url === null ? null : new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * HTTPS of the page. Session fix-a2: a page that ended on http:// is "ohne HTTPS" only when the scan asked
 * for https:// itself: the address was entered with https:// and the site sent the browser to http://, or
 * the address was entered with http:// and one request to its https:// address (`Capture.httpsProbe`) was
 * refused (nothing listens there) or answered with a redirect back to http://. When https:// answers, the
 * site has HTTPS and only the missing redirect is a finding. Without that request (an older capture), without
 * a clear answer (an error page, no answer in time, a reset or a certificate error: the site may have HTTPS
 * that is broken or protected), or when the page ended on another host than the one that was asked:
 * "bitte manuell prüfen".
 */
function httpsCheck(capture: Capture, protocol: string | null): SecurityAnalysis['https'] {
  const finalUrl = capture.finalUrl;
  if (protocol === 'https:') return { result: 'pass', finalUrl, textId: 'security-https-ok' };
  if (protocol !== 'http:') return { result: 'manual', finalUrl, textId: 'security-https-manual' };
  if (protocolOf(capture.requestedUrl) === 'https:') return { result: 'fail', finalUrl, textId: 'security-https-missing' };
  const probe = capture.httpsProbe ?? null;
  // The request went to the host that was entered; it says nothing about another host the page ended on.
  if (probe === null || hostOfUrl(probe.url) === null || hostOfUrl(probe.url) !== hostOfUrl(finalUrl)) return { result: 'manual', finalUrl, textId: 'security-https-manual' };
  switch (probe.outcome) {
    case 'answers':
      return { result: 'pass', finalUrl, textId: 'security-https-available' };
    case 'refused':
    case 'redirects-to-http':
      return { result: 'fail', finalUrl, textId: 'security-https-missing' };
    default:
      return { result: 'manual', finalUrl, textId: 'security-https-manual' };
  }
}

export function analyzeSecurity(capture: Capture): SecurityAnalysis {
  const protocol = protocolOf(capture.finalUrl);
  const isHttps = protocol === 'https:';
  const https = httpsCheck(capture, protocol);
  const probe = capture.httpProbe ?? null;
  const redirect = redirectResult(probe?.outcome ?? null);
  const h = capture.mainDocument?.headers ?? {};
  // undefined: the page's meta tags were not read (no snapshot, or a capture made before A3).
  const meta = capture.page?.securityMeta;
  const headers = [
    checkHsts(h['strict-transport-security'], isHttps),
    checkCsp(h['content-security-policy'], h['content-security-policy-report-only'], meta === undefined ? undefined : meta.csp),
    checkXcto(h['x-content-type-options']),
    checkReferrerPolicy(h['referrer-policy'], meta === undefined ? undefined : meta.referrer),
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
