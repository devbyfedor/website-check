import type { AxeCapture, AxeContrast, AxeExample, AxeRuleResult } from '../a11y/types.ts';
import type { BannerProbeState } from '../consent/probe-script.ts';
import type { HttpProbe, HttpsProbe } from '../security/types.ts';
import type { Capture, CapturedRequest, CaptureFailure, ConsentBannerObservation, ConsentSignals, ImpressumCapture, MainDocument, PageLink, PageSnapshot, PlatformHints, RequestInitiator } from './types.ts';

/**
 * Limits of a capture (session fix-a4). Everything a page controls has a bound here: how many requests
 * are kept, how long an address or any other string of the page may be, how many links are read. The
 * scripts in the page (`page-scripts.ts`), the adapters and the static HTML reader use the same numbers,
 * and `limitCapture` applies them once more to a finished capture, so the analyzers never see more.
 *
 * What happens at a limit:
 * - a string longer than its limit keeps its start (an address stays an address of the same host);
 * - a link whose address is longer than the limit, or that no longer fits the page's budget for links,
 *   is left out and the snapshot says `linksTruncated`;
 * - a header value longer than the limit is not kept and not analysed (`MainDocument.headersCut`);
 * - a page with more requests than `maxRequests`, or with more address text than `requestChars`, is a
 *   failed capture (`page-limit`): the scan stops watching it, and nothing is concluded from a part;
 * - a capture that is still larger than `maxCaptureChars` as JSON is a failed capture too.
 *
 * The numbers leave room above the 287 saved captures of the 30 test sites (session fix-a4): at most
 * 560 requests, 190,000 characters of addresses, 477 links with 46,000 characters, header values up to
 * 3,241 characters, 312,000 characters of JSON per capture.
 */
export const CAPTURE_LIMITS = {
  /** Requests of one page. One more makes the capture fail. */
  maxRequests: 2_000,
  /** One address: of a request, a frame, an initiator, a redirect, a link, the page itself. */
  urlLength: 2_000,
  /** A `data:` or `blob:` address keeps only its start (an inline image can be megabytes long). */
  inlineUrlLength: 200,
  /** All strings of all request records together. */
  requestChars: 500_000,
  /** Frames above a request that are kept (innermost first). */
  frameDepth: 5,
  /** Visible text of a page. */
  textLength: 100_000,
  /** Links of a page, and links beyond them that name a legal page. */
  maxLinks: 1_500,
  extraLinks: 100,
  linkTextLength: 200,
  /** Addresses of all links of one page together (their texts are bounded by the number of links). */
  linkChars: 300_000,
  titleLength: 300,
  langLength: 100,
  metaLength: 1_000,
  /** One header value; a longer one is left out and named in `headersCut`. */
  headerValueLength: 16_000,
  headerNameLength: 100,
  headerCount: 100,
  /** Names and values of all headers together. */
  headerChars: 100_000,
  redirectHops: 20,
  selectorLength: 300,
  toolIdLength: 60,
  toolsInDom: 30,
  /** A CSS selector path of an element (one part per shadow root). */
  axeTargetParts: 5,
  axeTargetLength: 600,
  axeHtmlLength: 200,
  axeExamples: 5,
  shortText: 40,
  messageLength: 500,
  platformEntries: 80,
  platformEntryLength: 200,
  /** The whole capture as JSON. */
  maxCaptureChars: 2_000_000,
} as const;

/** The failure of a page that is larger than the scan records (session fix-a4). */
export function pageLimitFailure(what: 'requests' | 'request-addresses' | 'size' | 'fetches'): CaptureFailure {
  const text = {
    requests: `page-limit: the page made more than ${CAPTURE_LIMITS.maxRequests} requests`,
    'request-addresses': `page-limit: the addresses of the page's requests are longer than ${CAPTURE_LIMITS.requestChars} characters in all`,
    size: `page-limit: the data read from the page is larger than ${CAPTURE_LIMITS.maxCaptureChars} characters`,
    fetches: 'page-limit: the check made more requests than one check may (redirects to new hosts)',
  } as const;
  return { reason: 'page-limit', message: text[what] };
}

/** Cuts a string at a limit without leaving half of a surrogate pair. */
export function cutText(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

const INLINE_URL = /^(?:data|blob):/i;

/** An address at its limit: the start is kept, so the scheme, the host and the first part of the path stay. */
export function cutUrl(url: string): string {
  return cutText(url, INLINE_URL.test(url.slice(0, 5)) ? CAPTURE_LIMITS.inlineUrlLength : CAPTURE_LIMITS.urlLength);
}

/** Counts what `limitCapture` changed. */
interface Tally {
  strings: number;
}

function str(value: unknown, max: number, tally: Tally): string {
  if (typeof value !== 'string') return '';
  if (value.length <= max) return value;
  tally.strings += 1;
  return cutText(value, max);
}

function strOrNull(value: unknown, max: number, tally: Tally): string | null {
  return typeof value === 'string' ? str(value, max, tally) : null;
}

function url(value: unknown, tally: Tally): string {
  if (typeof value !== 'string') return '';
  const cut = cutUrl(value);
  if (cut.length !== value.length) tally.strings += 1;
  return cut;
}

function urlOrNull(value: unknown, tally: Tally): string | null {
  return typeof value === 'string' ? url(value, tally) : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------------------------
// Requests

function limitInitiator(value: unknown, tally: Tally): RequestInitiator | null {
  const v = record(value);
  if (v === null) return null;
  return { type: str(v['type'], CAPTURE_LIMITS.shortText, tally), url: urlOrNull(v['url'], tally) };
}

/** One request record within the limits; `seq` is given by the caller. */
export function limitRequest(value: CapturedRequest, tally: Tally = { strings: 0 }): CapturedRequest {
  const frames = Array.isArray(value.frameUrls) ? value.frameUrls : [];
  if (frames.length > CAPTURE_LIMITS.frameDepth) tally.strings += 1;
  const out: CapturedRequest = {
    seq: num(value.seq, 0),
    url: url(value.url, tally),
    method: str(value.method, CAPTURE_LIMITS.shortText, tally),
    resourceType: str(value.resourceType, CAPTURE_LIMITS.shortText, tally),
    startMs: num(value.startMs, 0),
    endMs: numOrNull(value.endMs),
    status: numOrNull(value.status),
    failure: strOrNull(value.failure, CAPTURE_LIMITS.selectorLength, tally),
    isMainFrame: value.isMainFrame === true,
    frameUrls: frames.slice(0, CAPTURE_LIMITS.frameDepth).map((frame) => url(frame, tally)),
    isNavigation: value.isNavigation === true,
    initiator: limitInitiator(value.initiator, tally),
    redirectedFrom: urlOrNull(value.redirectedFrom, tally),
  };
  if (typeof value.frameKnown === 'boolean') out.frameKnown = value.frameKnown;
  return out;
}

/** The characters a request record adds to the page's budget for addresses. */
export function requestChars(request: CapturedRequest): number {
  let chars = request.url.length + request.method.length + request.resourceType.length + (request.failure?.length ?? 0) + (request.redirectedFrom?.length ?? 0);
  chars += (request.initiator?.url?.length ?? 0) + (request.initiator?.type.length ?? 0);
  for (const frame of request.frameUrls) chars += frame.length;
  return chars;
}

/**
 * Counts the requests of a page while an adapter records them. `add` returns false once the page is over
 * a limit: the adapter then keeps nothing more and stops watching the page.
 */
export class RequestBudget {
  count = 0;
  chars = 0;
  exceeded: 'requests' | 'request-addresses' | null = null;

  add(request: CapturedRequest): boolean {
    if (this.exceeded !== null) return false;
    this.count += 1;
    this.chars += requestChars(request);
    if (this.count > CAPTURE_LIMITS.maxRequests) this.exceeded = 'requests';
    else if (this.chars > CAPTURE_LIMITS.requestChars) this.exceeded = 'request-addresses';
    return this.exceeded === null;
  }
}

// ---------------------------------------------------------------------------------------------
// The page snapshot

function limitPlatform(value: unknown, tally: Tally): PlatformHints | undefined {
  const v = record(value);
  if (v === null) return undefined;
  const list = (raw: unknown, max: number, length: number): string[] =>
    (Array.isArray(raw) ? raw : [])
      .filter((item): item is string => typeof item === 'string')
      .slice(0, max)
      .map((item) => str(item, length, tally));
  return { generators: list(v['generators'], 5, 120), globals: list(v['globals'], CAPTURE_LIMITS.platformEntries, CAPTURE_LIMITS.platformEntryLength), selectors: list(v['selectors'], CAPTURE_LIMITS.platformEntries, CAPTURE_LIMITS.platformEntryLength) };
}

/**
 * A page snapshot within the limits, from whatever a script in the page returned: wrong types become empty
 * values, long strings are cut, links with an address over the limit or beyond the page's budget are left
 * out (`linksTruncated`). Null when the value is no snapshot at all.
 */
export function limitPageSnapshot(value: unknown, tally: Tally = { strings: 0 }): PageSnapshot | null {
  const v = record(value);
  if (v === null) return null;
  const rawText = typeof v['text'] === 'string' ? v['text'] : '';
  const rawLinks = Array.isArray(v['links']) ? v['links'] : [];
  const links: PageLink[] = [];
  let linksTruncated = v['linksTruncated'] === true || rawLinks.length > CAPTURE_LIMITS.maxLinks + CAPTURE_LIMITS.extraLinks;
  let chars = 0;
  for (const raw of rawLinks.slice(0, CAPTURE_LIMITS.maxLinks + CAPTURE_LIMITS.extraLinks)) {
    const link = record(raw);
    if (link === null || typeof link['href'] !== 'string') continue;
    const href = link['href'];
    const text = str(link['text'], CAPTURE_LIMITS.linkTextLength, tally);
    if (href.length > CAPTURE_LIMITS.urlLength || chars + href.length > CAPTURE_LIMITS.linkChars) {
      linksTruncated = true;
      continue;
    }
    chars += href.length;
    links.push(typeof link['footer'] === 'boolean' ? { href, text, footer: link['footer'] } : { href, text });
  }
  const page: PageSnapshot = {
    title: str(v['title'], CAPTURE_LIMITS.titleLength, tally),
    lang: strOrNull(v['lang'], CAPTURE_LIMITS.langLength, tally),
    text: rawText.length > CAPTURE_LIMITS.textLength ? cutText(rawText, CAPTURE_LIMITS.textLength) : rawText,
    textTruncated: v['textTruncated'] === true || rawText.length > CAPTURE_LIMITS.textLength,
    links,
    linksTruncated,
  };
  if (typeof v['url'] === 'string' && v['url'] !== '') page.url = url(v['url'], tally);
  const meta = record(v['securityMeta']);
  if (meta !== null) page.securityMeta = { csp: strOrNull(meta['csp'], CAPTURE_LIMITS.metaLength, tally), referrer: strOrNull(meta['referrer'], CAPTURE_LIMITS.metaLength, tally) };
  const platform = limitPlatform(v['platform'], tally);
  if (platform !== undefined) page.platform = platform;
  return page;
}

/**
 * What `SNAPSHOT_EXPRESSION` returned, within the limits: the page snapshot, the state of the banner probe
 * (only its known fields), the consent signals and the time origin. Null when the value is no snapshot.
 */
export function limitSnapshot(value: unknown): LimitedSnapshot | null {
  const tally: Tally = { strings: 0 };
  const page = limitPageSnapshot(value, tally);
  const v = record(value);
  if (page === null || v === null) return null;
  const rawProbe = record(v['probe']);
  let probe: BannerProbeState | null = null;
  if (rawProbe !== null) {
    const f = record(rawProbe['found']);
    const present: Record<string, number> = {};
    let count = 0;
    for (const [key, at] of Object.entries(record(rawProbe['present']) ?? {})) {
      if (count >= CAPTURE_LIMITS.toolsInDom) break;
      if (key.length > CAPTURE_LIMITS.toolIdLength) continue;
      present[key] = num(at, 0);
      count += 1;
    }
    probe = {
      found: f === null ? null : { toolId: str(f['toolId'], CAPTURE_LIMITS.toolIdLength, tally), selector: str(f['selector'], CAPTURE_LIMITS.selectorLength, tally), method: f['method'] === 'selector' ? 'selector' : 'heuristic', at: num(f['at'], 0) },
      present,
    };
  }
  const out: LimitedSnapshot = { ...page, probe, signals: limitSignals(v['signals'], tally) ?? null };
  if (typeof v['timeOrigin'] === 'number' && Number.isFinite(v['timeOrigin']) && v['timeOrigin'] > 0) out.timeOrigin = v['timeOrigin'];
  return out;
}

export interface LimitedSnapshot extends PageSnapshot {
  probe: BannerProbeState | null;
  signals: ConsentSignals | null;
  timeOrigin?: number;
}

function limitSignals(value: unknown, tally: Tally): ConsentSignals | undefined {
  const v = record(value);
  if (v === null) return undefined;
  const cookiebot = record(v['cookiebot']);
  const usercentrics = record(v['usercentrics']);
  return {
    cookiebot: cookiebot === null ? null : { consented: cookiebot['consented'] === true, declined: cookiebot['declined'] === true, method: strOrNull(cookiebot['method'], CAPTURE_LIMITS.shortText, tally) },
    usercentrics: usercentrics === null ? null : { allAccepted: usercentrics['allAccepted'] === true },
  };
}

/** The banner observation within the limits (tool ids, the selector and the list of tools come from the page). */
export function limitBanner(value: unknown, tally: Tally = { strings: 0 }): ConsentBannerObservation {
  const v = record(value) ?? {};
  const method = v['method'] === 'selector' || v['method'] === 'heuristic' ? v['method'] : null;
  const tools = (Array.isArray(v['toolsInDom']) ? v['toolsInDom'] : []).filter((item): item is string => typeof item === 'string' && item.length <= CAPTURE_LIMITS.toolIdLength);
  if (Array.isArray(v['toolsInDom']) && tools.length !== v['toolsInDom'].length) tally.strings += 1;
  const signals = limitSignals(v['signals'], tally);
  return {
    detected: v['detected'] === true,
    toolId: strOrNull(v['toolId'], CAPTURE_LIMITS.toolIdLength, tally),
    method,
    selector: strOrNull(v['selector'], CAPTURE_LIMITS.selectorLength, tally),
    visibleAtMs: numOrNull(v['visibleAtMs']),
    toolsInDom: tools.slice(0, CAPTURE_LIMITS.toolsInDom),
    ...(signals !== undefined ? { signals } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Headers

/** Headers the analyzers read: kept first when a response has more header text than the budget. */
const HEADERS_FIRST = [
  'strict-transport-security',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'feature-policy',
  'cf-mitigated',
  'content-type',
  'refresh',
  'location',
];

/** Response headers within the limits, and the names of the headers that were left out. */
export function limitHeaders(value: unknown): { headers: Record<string, string>; cut: string[] } {
  const raw = record(value) ?? {};
  const headers: Record<string, string> = {};
  const cut: string[] = [];
  let chars = 0;
  let count = 0;
  const names = Object.keys(raw);
  const ordered = [...HEADERS_FIRST.filter((name) => Object.hasOwn(raw, name)), ...names.filter((name) => !HEADERS_FIRST.includes(name))];
  for (const name of ordered) {
    const item = raw[name];
    if (typeof item !== 'string' || name.length > CAPTURE_LIMITS.headerNameLength) continue;
    if (item.length > CAPTURE_LIMITS.headerValueLength || count >= CAPTURE_LIMITS.headerCount || chars + name.length + item.length > CAPTURE_LIMITS.headerChars) {
      cut.push(name);
      continue;
    }
    headers[name] = item;
    chars += name.length + item.length;
    count += 1;
  }
  return { headers, cut: cut.slice(0, CAPTURE_LIMITS.headerCount) };
}

function limitMainDocument(value: MainDocument | null, tally: Tally): MainDocument | null {
  if (value === null || record(value) === null) return null;
  const { headers, cut } = limitHeaders(value.headers);
  const earlier = Array.isArray(value.headersCut) ? value.headersCut.filter((name): name is string => typeof name === 'string' && name.length <= CAPTURE_LIMITS.headerNameLength) : [];
  const allCut = [...new Set([...earlier, ...cut])].slice(0, CAPTURE_LIMITS.headerCount);
  const hops = Array.isArray(value.redirectChain) ? value.redirectChain : [];
  return {
    status: num(value.status, 0),
    headers,
    redirectChain: hops.slice(0, CAPTURE_LIMITS.redirectHops).map((hop) => ({ url: url(hop?.url, tally), status: num(hop?.status, 0) })),
    ...(allCut.length > 0 ? { headersCut: allCut } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Accessibility

function limitContrast(value: AxeContrast | null | undefined, tally: Tally): AxeContrast | null {
  const v = record(value);
  if (v === null) return null;
  const short = (item: unknown): string | null => strOrNull(item, CAPTURE_LIMITS.shortText, tally);
  return { ratio: numOrNull(v['ratio']), expected: short(v['expected']), fgColor: short(v['fgColor']), bgColor: short(v['bgColor']), fontSize: short(v['fontSize']), fontWeight: short(v['fontWeight']), messageKey: short(v['messageKey']) };
}

function limitExamples(value: unknown, tally: Tally): AxeExample[] {
  return (Array.isArray(value) ? value : []).slice(0, CAPTURE_LIMITS.axeExamples).map((item) => {
    const v = record(item) ?? {};
    const target = (Array.isArray(v['target']) ? v['target'] : []).filter((part): part is string => typeof part === 'string');
    return {
      target: target.slice(0, CAPTURE_LIMITS.axeTargetParts).map((part) => str(part, CAPTURE_LIMITS.axeTargetLength, tally)),
      html: str(v['html'], CAPTURE_LIMITS.axeHtmlLength, tally),
      contrast: limitContrast(v['contrast'] as AxeContrast | null, tally),
    };
  });
}

/** An accessibility result within the limits (selectors, HTML snippets and the version text come from the page). */
export function limitAxe(value: AxeCapture | null, tally: Tally = { strings: 0 }): AxeCapture | null {
  if (value === null || record(value) === null) return null;
  const rules: AxeCapture['rules'] = {};
  for (const [id, raw] of Object.entries(record(value.rules) ?? {}).slice(0, 20)) {
    const rule = record(raw);
    if (rule === null || id.length > CAPTURE_LIMITS.shortText) continue;
    const count = (item: unknown): number => (typeof item === 'number' && Number.isInteger(item) && item >= 0 ? item : 0);
    const limited: AxeRuleResult = {
      violations: count(rule['violations']),
      incomplete: count(rule['incomplete']),
      passes: count(rule['passes']),
      impact: strOrNull(rule['impact'], CAPTURE_LIMITS.shortText, tally),
      examples: limitExamples(rule['examples'], tally),
      incompleteExamples: limitExamples(rule['incompleteExamples'], tally),
    };
    (rules as Record<string, AxeRuleResult>)[id] = limited;
  }
  const lowest = record(value.lowestContrast) ?? {};
  const out: AxeCapture = {
    ...value,
    error: strOrNull(value.error, CAPTURE_LIMITS.selectorLength, tally),
    axeVersion: strOrNull(value.axeVersion, CAPTURE_LIMITS.shortText, tally),
    rules,
    ruleErrors: (Array.isArray(value.ruleErrors) ? value.ruleErrors : []).filter((item): item is string => typeof item === 'string').slice(0, 20).map((item) => str(item, CAPTURE_LIMITS.shortText, tally)),
    lowestContrast: { violation: limitContrast(lowest['violation'] as AxeContrast | null, tally), pass: limitContrast(lowest['pass'] as AxeContrast | null, tally) },
  };
  return out;
}

// ---------------------------------------------------------------------------------------------
// The rest of the capture

function limitFailure(value: CaptureFailure | null, tally: Tally): CaptureFailure | null {
  if (value === null || record(value) === null) return null;
  return { reason: value.reason, message: str(value.message, CAPTURE_LIMITS.messageLength, tally), ...(typeof value.status === 'number' ? { status: value.status } : {}) };
}

function limitImpressum(value: ImpressumCapture, tally: Tally): ImpressumCapture {
  return {
    ...value,
    url: url(value.url, tally),
    failure: limitFailure(value.failure, tally),
    finalUrl: urlOrNull(value.finalUrl, tally),
    page: value.page === null ? null : limitPageSnapshot(value.page, tally),
  };
}

function limitHttpProbe(value: HttpProbe, tally: Tally): HttpProbe {
  const hops = Array.isArray(value.hops) ? value.hops : [];
  return {
    ...value,
    url: url(value.url, tally),
    httpsTarget: urlOrNull(value.httpsTarget, tally),
    hops: hops.slice(0, CAPTURE_LIMITS.redirectHops).map((hop) => ({ url: url(hop.url, tally), status: numOrNull(hop.status), location: urlOrNull(hop.location, tally), error: strOrNull(hop.error, CAPTURE_LIMITS.selectorLength, tally) })),
  };
}

function limitHttpsProbe(value: HttpsProbe, tally: Tally): HttpsProbe {
  return { ...value, url: url(value.url, tally), location: urlOrNull(value.location, tally), error: strOrNull(value.error, CAPTURE_LIMITS.selectorLength, tally) };
}

/** What a capture over a limit keeps: its state and times, none of the page's data. */
function failedForSize(capture: Capture, failure: CaptureFailure): Capture {
  const { impressum: _impressum, ...rest } = capture;
  return {
    ...rest,
    ok: false,
    failure,
    mainDocument: capture.mainDocument === null ? null : { status: capture.mainDocument.status, headers: {}, redirectChain: [] },
    requests: [],
    page: null,
    consentBanner: { detected: false, toolId: null, method: null, selector: null, visibleAtMs: null, toolsInDom: [] },
    axe: null,
    limited: { strings: capture.limited?.strings ?? 0 },
  };
}

/**
 * The capture within the limits (session fix-a4). Adapters call it on what they return, and
 * `analyzeCapture` calls it again, so a capture saved before the limits existed, or one of an adapter
 * that misses a bound, is analysed within them too. Pure; the input is not changed.
 *
 * A capture with more requests or more address text than the limits is failed with `page-limit`, unless
 * the SSRF guard already refused it. `limited.strings` counts the strings that were cut.
 */
export function limitCapture(capture: Capture): Capture {
  const tally: Tally = { strings: 0 };
  const budget = new RequestBudget();
  const requests: CapturedRequest[] = [];
  for (const raw of Array.isArray(capture.requests) ? capture.requests : []) {
    if (record(raw) === null) continue;
    const request = limitRequest(raw, tally);
    if (!budget.add(request)) break;
    requests.push(request);
  }
  const page = capture.page === null ? null : limitPageSnapshot(capture.page, tally);
  const out: Capture = {
    ...capture,
    requestedUrl: url(capture.requestedUrl, tally),
    failure: limitFailure(capture.failure, tally),
    finalUrl: urlOrNull(capture.finalUrl, tally),
    mainDocument: limitMainDocument(capture.mainDocument, tally),
    requests,
    page,
    consentBanner: limitBanner(capture.consentBanner, tally),
    axe: limitAxe(capture.axe, tally),
  };
  if (capture.impressum !== undefined && capture.impressum !== null) out.impressum = limitImpressum(capture.impressum, tally);
  if (capture.httpProbe !== undefined && capture.httpProbe !== null) out.httpProbe = limitHttpProbe(capture.httpProbe, tally);
  if (capture.httpsProbe !== undefined && capture.httpsProbe !== null) out.httpsProbe = limitHttpsProbe(capture.httpsProbe, tally);
  const strings = tally.strings + (capture.limited?.strings ?? 0);
  if (strings > 0) out.limited = { strings };
  else delete out.limited;
  const refused = out.failure?.reason === 'not-allowed';
  if (budget.exceeded !== null && !refused) {
    // The requests kept so far stay for the local log; nothing of the page is analysed.
    return { ...out, ok: false, failure: pageLimitFailure(budget.exceeded), page: null, axe: out.axe === null ? null : { ...out.axe, status: 'skipped', error: 'the page was not captured (page-limit)', rules: {}, ruleErrors: [], lowestContrast: { violation: null, pass: null } } };
  }
  if (JSON.stringify(out).length > CAPTURE_LIMITS.maxCaptureChars) return failedForSize(out, refused && out.failure !== null ? out.failure : pageLimitFailure('size'));
  return out;
}
