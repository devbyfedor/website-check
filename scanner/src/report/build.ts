import { analyzeCapture, type AnalysisPart, type CaptureAnalysis } from '../analyzers/capture.ts';
import type { AccessibilityAnalysis, A11yCheck } from '../analyzers/accessibility.ts';
import type { LegalAnalysis } from '../analyzers/legal.ts';
import type { SecurityAnalysis } from '../analyzers/security.ts';
import type { DetectedService, ThirdPartyAnalysis } from '../analyzers/third-party.ts';
import type { AxeExample, AxePositions } from '../a11y/types.ts';
import { limitCapture } from '../capture/limits.ts';
import type { Capture, CapturedRequest } from '../capture/types.ts';
import { firstPartySites, hostOf, siteOfUrl } from '../domain/site.ts';
import type { FieldResult } from '../legal/fields.ts';
import type { CompiledRules } from '../rules/match.ts';
import { SEVERITY_OF_RISK_CLASS, type RiskClass } from '../rules/types.ts';
import { pageAddress } from './page-address.ts';
import { displayHostOf } from './site-address.ts';
import {
  REPORT_LIMITS,
  REPORT_SCHEMA_VERSION,
  type Evidence,
  type FieldState,
  type Finding,
  type FindingArea,
  type FindingKind,
  type FindingRisk,
  type Measure,
  type PageCut,
  type Report,
  type ReportLegal,
  type ReportSecurity,
  type ReportService,
  type ReportState,
  type SectionId,
  type SectionStatus,
  type TextParam,
  type Timeline,
  type TimelineRow,
} from './types.ts';

/**
 * Builds the report JSON of one scan from its capture (session A5). Pure: the same capture and
 * options give the same report. The Durable Object calls it after the scan (part 3); the local
 * tool `npm run report:check` calls it on saved captures.
 *
 * Product rules applied here: every third-party request happened without consent (the scan never
 * clicks), so every service in the list "starts before consent"; banner timing is extra information
 * and decides nothing; whatever the scan cannot decide is `manual` ("bitte manuell prüfen"), never a
 * violation; only a missing Impressum link carries a risk among the mandatory information.
 *
 * Session fix-a1: a service seen only in requests whose document is unknown is a hint to check by hand;
 * a page that shows almost nothing and links to no Impressum or Datenschutzerklärung (it may be a page
 * of bot protection that no rule names) gets a notice, no "erfüllt" row and no risk for the missing link.
 *
 * Session fix-a2 (Fedor, 23.11.2026): such an almost empty page shows no findings at all, only the notice
 * and manual checks. If it is a page of bot protection, what was measured on it describes the protection,
 * not the site: unsure means manual check.
 */

export interface BuildReportOptions {
  id: string;
  /** ISO time when the visitor started the scan. */
  createdAt: string;
  /** Normalized address (`normalizeSiteAddress`). */
  siteUrl: string;
  /** `quick`: the quick check without a browser (part 3); sections that need the browser are not checked. */
  mode: 'full' | 'quick';
  capture: Capture;
  rules: CompiledRules;
  scannerVersion: string;
  rulesUpdated: string;
  /** Where the browser ran (Cloudflare `loc` and `colo`); null when unknown. Default: `capture.visit`. */
  visit?: { country: string | null; colo: string | null };
}

/** One row of the D1 table `network_requests`: the requests of one host, aggregated. */
export interface NetworkHostRow {
  host: string;
  party: 'first' | 'third';
  serviceKey: string | null;
  requestCount: number;
  firstStartMs: number;
  lastEndMs: number | null;
  beforeBanner: boolean | null;
}

export interface BuiltReport {
  report: Report;
  networkHosts: NetworkHostRow[];
  /** Hosts beyond `REPORT_LIMITS.networkHosts` that got no row. */
  networkHostsDropped: number;
  analysis: CaptureAnalysis;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function clip(text: string, max: number = REPORT_LIMITS.textLength): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** An address of the page as the report keeps it (fix-a5, finding 90: no query, fragment or session id), cut to the report's length. */
function clipUrl(url: string, kind: 'request' | 'page' | 'link' = 'request'): string {
  return clip(pageAddress(url, kind), REPORT_LIMITS.urlLength);
}

/** Finding ids allow lower-case letters, digits, dots and hyphens between colons. */
function idPart(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/** FNV-1a, 32 bits: a short, stable suffix that keeps shortened keys apart. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const MAX_KEY = 100;

/**
 * The service key as the report and D1 store it: unchanged up to 100 characters; a longer one (an
 * unknown third party on a very long registrable domain, which the page controls) keeps its start and
 * gets a hash of the whole key, so it stays unique and within the schema's 120 characters.
 */
export function reportServiceKey(key: string): string {
  return key.length <= MAX_KEY ? key : `${key.slice(0, MAX_KEY - 9)}-${fnv1a(key)}`;
}

/** `third-party:google-fonts`, `third-party:unknown:beispiel.example`; at most 112 characters. */
function serviceFindingId(key: string): string {
  return `third-party:${reportServiceKey(key).split(':').map(idPart).join(':')}`;
}

/**
 * Session fix-a4 (review finding 54): values that come from the page go into the report only in the form the
 * schema names. Anything else is left out, so a page cannot turn a scan into an error of ours.
 */
function versionOf(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : null;
}

/** A contrast requirement as axe writes it ("4.5:1"). */
function expectedOf(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^\d{1,2}(?:\.\d{1,2})?:1$/.test(value) ? value : null;
}

/** The id of a consent tool: one of our ids (lower-case letters, digits, hyphens). */
function toolIdOf(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(value) ? value : null;
}

function countOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100_000, Math.round(value))) : 0;
}

function ms(value: number): number {
  return Math.max(0, Math.min(600_000, Math.round(value)));
}

const RISK_OF_CLASS: Record<RiskClass, FindingRisk | null> = {
  precedent: 'high',
  'consent-required': 'high',
  'usually-consent': 'medium',
  'grey-zone': null,
  'not-flagged': null,
};

function finding(
  base: Pick<Finding, 'id' | 'area' | 'kind' | 'textId'> & Partial<Omit<Finding, 'id' | 'area' | 'kind' | 'textId'>>,
): Finding {
  return {
    risk: null,
    params: {},
    field: null,
    serviceKey: null,
    beforeConsent: false,
    evidence: [],
    fixTextId: null,
    ...base,
  };
}

// ---------------------------------------------------------------------------------------------
// Third-party services

/** No request of the service got an answer: nothing is known to have reached it. */
function unreached(service: DetectedService): boolean {
  return !service.confirmed;
}

/**
 * Session fix-a1: a service that would be a finding, seen only in requests whose document the adapter
 * does not know. It may belong to an embedded third-party page, so it is "bitte manuell prüfen".
 */
function unplaced(service: DetectedService): boolean {
  return service.frameUnknown && service.severity === 'hint' && SEVERITY_OF_RISK_CLASS[service.riskClass] === 'finding';
}

function consentOf(service: DetectedService, almostEmpty: boolean): ReportService['consent'] {
  // On an almost empty page nothing is "fehlt": the requests may be those of a page of bot protection.
  if (service.severity === 'finding') return almostEmpty ? 'manual' : 'missing';
  if (unreached(service) && service.riskClass !== 'not-flagged') return 'not-reached';
  if (unplaced(service)) return 'manual';
  return service.severity === 'hint' ? 'grey-zone' : 'not-needed';
}

function serviceTextId(service: DetectedService): string {
  if (service.severity === 'finding') return `third-party-${service.riskClass}`;
  if (unplaced(service)) return 'third-party-frame-unknown';
  if (!service.known) return 'third-party-unknown';
  if (service.riskClass === 'grey-zone') return 'third-party-grey-zone';
  return 'third-party-unconfirmed';
}

/**
 * The requests shown as evidence, in the order they started. Session fix-a6 (review finding 67): when the first
 * five got no answer but a later one did, the earliest answered request takes the place of the fifth, so a
 * confirmed finding always shows a request that reached the service.
 */
function shownEvidence<T extends { reachedServer: boolean }>(list: readonly T[]): T[] {
  const max = REPORT_LIMITS.evidencePerFinding;
  const first = list.slice(0, max);
  if (first.some((e) => e.reachedServer)) return first;
  const reached = list.find((e) => e.reachedServer);
  return reached === undefined ? first : [...first.slice(0, max - 1), reached];
}

/**
 * Session fix-a6 ("Feld B2"): the field of the plan where the page shows an element that loads a file of the service
 * (an image, an iframe, a video): the first such element of its first host that has one. Null when none has a box
 * (a script or a font loaded from the head has none) or the capture has no positions.
 */
function serviceField(service: DetectedService, positions: AxePositions | null): string | null {
  if (positions === null) return null;
  for (const host of service.hosts) {
    const field = positions.hosts[host]?.[0];
    if (field !== undefined) return field;
  }
  return null;
}

/** Session fix-a6 ("Feld B2"): the field of the first example element that has one. */
function exampleField(examples: readonly AxeExample[]): string | null {
  for (const e of examples) if (typeof e.field === 'string' && /^[A-D][1-3]$/.test(e.field)) return e.field;
  return null;
}

function thirdPartyFindings(analysis: ThirdPartyAnalysis, positions: AxePositions | null = null): Finding[] {
  const out: Finding[] = [];
  for (const service of analysis.services) {
    if (service.severity === 'none') continue;
    const kind: FindingKind = service.severity === 'finding' ? 'finding' : 'hint';
    const evidence: Evidence[] = shownEvidence(service.evidence).map((e) => ({
      type: 'request',
      url: clipUrl(e.url),
      startMs: ms(e.startMs),
      status: e.status,
      reachedServer: e.reachedServer,
      beforeBanner: analysis.bannerVisibleAtMs === null ? null : e.startMs < analysis.bannerVisibleAtMs,
      via: e.via === null ? (e.initiatorUrl === null ? null : clipUrl(e.initiatorUrl)) : clipUrl(e.via.url),
    }));
    out.push(
      finding({
        id: serviceFindingId(service.key),
        area: 'privacy',
        kind,
        risk: kind === 'finding' ? RISK_OF_CLASS[service.riskClass] : null,
        textId: serviceTextId(service),
        params: {
          service: clip(service.name, 120),
          provider: service.provider === null ? null : clip(service.provider, 120),
          category: service.category,
          count: service.requestCount,
          firstStartMs: ms(service.firstStartMs),
          beforeBanner: service.startsBeforeBanner,
        },
        serviceKey: reportServiceKey(service.key),
        field: serviceField(service, positions),
        // Only a request that got an answer certainly sent data to the third party (review of A5 part 2).
        beforeConsent: service.confirmed,
        evidence,
        fixTextId: service.known && kind === 'finding' && service.serviceId !== null ? `fix-${idPart(service.serviceId)}` : null,
      }),
    );
  }
  return out;
}

function reportServices(analysis: ThirdPartyAnalysis, findingIds: ReadonlySet<string>, almostEmpty: boolean): ReportService[] {
  return analysis.services.slice(0, REPORT_LIMITS.services).map((service, index) => {
    const id = serviceFindingId(service.key);
    return {
      position: index + 1,
      key: reportServiceKey(service.key),
      known: service.known,
      name: clip(service.name, 120),
      provider: service.provider === null ? null : clip(service.provider, 120),
      category: service.category,
      riskClass: service.riskClass,
      dataLocation: service.dataLocation,
      severity: almostEmpty && service.severity === 'finding' ? 'hint' : service.severity,
      consent: consentOf(service, almostEmpty),
      starts: 'before-consent',
      requestCount: service.requestCount,
      firstStartMs: ms(service.firstStartMs),
      startsBeforeBanner: service.startsBeforeBanner,
      hosts: service.hosts.slice(0, REPORT_LIMITS.hostsPerService).map((h) => clip(h, 253)),
      sources: service.sources.slice(0, 20).map((s) => clip(s, 120)),
      findingId: findingIds.has(id) ? id : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Timeline ("Zeitschnitt A–A") and the network rows

const TIMELINE_WINDOW_MS = 3000;

interface HostGroup {
  host: string;
  party: 'first' | 'third';
  requests: CapturedRequest[];
}

function groupByHost(capture: Capture): HostGroup[] {
  const own = firstPartySites(capture);
  const groups = new Map<string, HostGroup>();
  for (const request of [...capture.requests].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)) {
    const host = hostOf(request.url);
    if (host === null) continue;
    const site = siteOfUrl(request.url);
    const party = site !== null && own.has(site) ? 'first' : 'third';
    const group = groups.get(host) ?? { host, party, requests: [] };
    group.requests.push(request);
    groups.set(host, group);
  }
  return [...groups.values()];
}

/** The first listed service (findings first) that names the host: a host can serve several services. */
function serviceByHost(analysis: ThirdPartyAnalysis | null): Map<string, DetectedService> {
  const map = new Map<string, DetectedService>();
  for (const service of analysis?.services ?? []) for (const host of service.hosts) if (!map.has(host)) map.set(host, service);
  return map;
}

function lastEnd(requests: readonly CapturedRequest[]): number | null {
  let end = 0;
  for (const r of requests) {
    if (r.endMs === null) return null;
    end = Math.max(end, r.endMs);
  }
  return ms(end);
}

/** The common first path part of the site's own files ("wp-content"), when most of them share it. */
function commonFirstSegment(requests: readonly CapturedRequest[]): string | null {
  const counts = new Map<string, number>();
  for (const r of requests) {
    try {
      const segment = new URL(r.url).pathname.split('/')[1] ?? '';
      if (segment !== '' && !segment.includes('.')) counts.set(segment, (counts.get(segment) ?? 0) + 1);
    } catch {
      // not a URL: skipped
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top !== undefined && top[1] * 2 >= requests.length ? top[0] : null;
}

function buildTimeline(capture: Capture, analysis: ThirdPartyAnalysis): Timeline {
  const bannerAt = capture.consentBanner.detected ? capture.consentBanner.visibleAtMs : null;
  const inWindow = (r: CapturedRequest): boolean => r.startMs < TIMELINE_WINDOW_MS;
  const before = (startMs: number): boolean | null => (bannerAt === null ? null : startMs < bannerAt);
  const byHost = serviceByHost(analysis);
  const mainHost = capture.finalUrl === null ? null : hostOf(capture.finalUrl);
  const rows: { row: TimelineRow; rank: number }[] = [];

  const ownRequests = groupByHost(capture)
    .filter((g) => g.party === 'first')
    .flatMap((g) => g.requests)
    .filter(inWindow);
  const documents = ownRequests.filter((r) => r.isMainFrame && r.isNavigation && r.resourceType === 'document');
  const files = ownRequests.filter((r) => !documents.includes(r));
  if (documents.length > 0) {
    const first = documents[0] as CapturedRequest;
    rows.push({
      rank: 0,
      row: { label: clip(hostOf(first.url) ?? mainHost ?? '', 300), party: 'own', kind: 'document', serviceKey: null, provider: null, startMs: ms(first.startMs), endMs: lastEnd(documents), requestCount: documents.length, beforeBanner: before(first.startMs) },
    });
  }
  if (files.length > 0) {
    const host = mainHost ?? hostOf((files[0] as CapturedRequest).url) ?? '';
    const segment = commonFirstSegment(files);
    let start = (files[0] as CapturedRequest).startMs;
    for (const r of files) if (r.startMs < start) start = r.startMs;
    rows.push({
      rank: 1,
      row: { label: clip(segment === null ? host : `${host}/${segment}`, 300), party: 'own', kind: 'files', serviceKey: null, provider: null, startMs: ms(start), endMs: lastEnd(files), requestCount: files.length, beforeBanner: before(start) },
    });
  }
  for (const group of groupByHost(capture)) {
    if (group.party !== 'third') continue;
    const requests = group.requests.filter(inWindow);
    if (requests.length === 0) continue;
    const service = byHost.get(group.host) ?? null;
    const start = (requests[0] as CapturedRequest).startMs;
    rows.push({
      rank: service?.severity === 'finding' ? 2 : service?.severity === 'hint' ? 3 : 4,
      row: {
        label: clip(group.host, 300),
        party: 'third',
        kind: service?.category === 'consent' ? 'consent-tool' : 'service',
        serviceKey: service === null ? null : reportServiceKey(service.key),
        provider: service?.provider === null || service === null ? null : clip(service.provider, 120),
        startMs: ms(start),
        endMs: lastEnd(requests),
        requestCount: requests.length,
        beforeBanner: before(start),
      },
    });
  }
  const chosen = [...rows].sort((a, b) => a.rank - b.rank || a.row.startMs - b.row.startMs).slice(0, REPORT_LIMITS.timelineRows);
  chosen.sort((a, b) => (a.rank === 0 ? -1 : b.rank === 0 ? 1 : a.row.startMs - b.row.startMs || a.rank - b.rank));
  return {
    windowMs: TIMELINE_WINDOW_MS,
    bannerVisibleAtMs: bannerAt === null ? null : ms(bannerAt),
    bannerToolId: capture.consentBanner.detected ? toolIdOf(capture.consentBanner.toolId) : null,
    rows: chosen.map((c) => c.row),
    rowsTruncated: rows.length > chosen.length,
  };
}

function networkHosts(capture: Capture, analysis: ThirdPartyAnalysis | null): { rows: NetworkHostRow[]; dropped: number } {
  const bannerAt = capture.consentBanner.detected ? capture.consentBanner.visibleAtMs : null;
  const byHost = serviceByHost(analysis);
  const all = groupByHost(capture).map((group): NetworkHostRow => {
    const first = (group.requests[0] as CapturedRequest).startMs;
    const service = group.party === 'third' ? (byHost.get(group.host) ?? null) : null;
    return {
      host: clip(group.host, 253),
      party: group.party,
      serviceKey: service === null ? null : reportServiceKey(service.key),
      requestCount: group.requests.length,
      firstStartMs: ms(first),
      lastEndMs: lastEnd(group.requests),
      beforeBanner: bannerAt === null ? null : first < bannerAt,
    };
  });
  return { rows: all.slice(0, REPORT_LIMITS.networkHosts), dropped: Math.max(0, all.length - REPORT_LIMITS.networkHosts) };
}

// ---------------------------------------------------------------------------------------------
// Accessibility

const A11Y_CHECK_NAMES: Record<A11yCheck['id'], string> = {
  'color-contrast': 'color-contrast',
  'image-alt': 'image-alt',
  label: 'label',
  'link-name': 'link-name',
  'button-name': 'button-name',
  'page-language': 'page-language',
};

function elementEvidence(examples: readonly AxeExample[]): Evidence[] {
  return examples.slice(0, REPORT_LIMITS.evidencePerFinding).map((e) => ({
    type: 'element',
    target: e.target.slice(0, 10).map((t) => clip(t, 300)),
    html: clip(e.html, REPORT_LIMITS.htmlLength),
    ratio: e.contrast?.ratio != null && e.contrast.ratio >= 1 ? Math.min(21, e.contrast.ratio) : null,
    expected: expectedOf(e.contrast?.expected),
  }));
}

function accessibilityFindings(a11y: AccessibilityAnalysis): Finding[] {
  if (a11y.status === 'not-checked') {
    return [finding({ id: 'a11y:not-checked', area: 'accessibility', kind: 'not-checked', textId: 'a11y-not-checked', params: { reason: clip(a11y.reason ?? 'unknown', 300) } })];
  }
  const out: Finding[] = [];
  // Session fix-a6 (review finding 83): a large iframe was not checked; say so next to what was checked.
  if (a11y.framedContent != null) out.push(finding({ id: 'a11y:frame-content', area: 'accessibility', kind: 'manual', textId: 'a11y-frame-not-checked', params: { share: Math.round(a11y.framedContent * 100) } }));
  for (const check of a11y.checks) {
    const name = A11Y_CHECK_NAMES[check.id];
    if (check.result === 'not-checked') {
      out.push(finding({ id: `a11y:${name}`, area: 'accessibility', kind: 'not-checked', textId: 'a11y-check-not-checked', params: { check: name } }));
      continue;
    }
    if (check.result === 'fail') {
      const params: Record<string, TextParam> = { count: check.violations };
      if (check.id === 'color-contrast' && a11y.lowestContrast?.result === 'fail') {
        params.ratio = a11y.lowestContrast.ratio;
        params.expected = a11y.lowestContrast.expected;
      }
      if (check.id === 'page-language') params.value = a11y.invalidLang === null ? null : clip(a11y.invalidLang, 100);
      out.push(finding({ id: `a11y:${name}`, area: 'accessibility', kind: 'finding', risk: 'medium', textId: check.textId ?? `a11y-${name}`, params, field: exampleField(check.examples), evidence: elementEvidence(check.examples) }));
    }
    // Session fix-a2: images marked as decoration pass the axe rule without a description; whether the mark
    // is right is a manual check, next to whatever else the check found. It does not change the Prüfmaß
    // (session fix-a3: the row follows axe, where an empty alt is no error).
    if (check.id === 'image-alt' && (a11y.images?.decorative ?? 0) > 0) {
      out.push(finding({ id: 'a11y:image-alt:decorative', area: 'accessibility', kind: 'manual', textId: 'a11y-image-alt-decorative', params: { check: name, count: a11y.images?.decorative ?? 0 } }));
    }
    if (check.manual !== null) {
      out.push(
        finding({
          id: check.result === 'fail' ? `a11y:${name}:manual` : `a11y:${name}`,
          area: 'accessibility',
          kind: 'manual',
          textId: check.manual.textId,
          params: { check: name, count: check.manual.count },
          field: exampleField(check.manual.examples),
          evidence: elementEvidence(check.manual.examples),
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Security

function securityFindings(security: SecurityAnalysis): Finding[] {
  const out: Finding[] = [];
  if (security.https.result === 'fail') out.push(finding({ id: 'security:https', area: 'security', kind: 'finding', risk: 'high', textId: security.https.textId }));
  if (security.https.result === 'manual') out.push(finding({ id: 'security:https', area: 'security', kind: 'manual', textId: security.https.textId }));
  const redirect = security.httpRedirect;
  if (redirect.result === 'fail') out.push(finding({ id: 'security:http-redirect', area: 'security', kind: 'finding', risk: 'medium', textId: redirect.textId ?? 'security-http-no-redirect' }));
  // Session fix-a6 (review finding 69): the reason and the last status, for "(Grund: …)" of the text.
  else if (redirect.result === 'manual') out.push(finding({ id: 'security:http-redirect', area: 'security', kind: 'manual', textId: redirect.textId ?? 'security-http-redirect-manual', params: { reason: redirect.reason ?? 'unknown', status: redirect.status ?? null } }));
  else if (redirect.result === 'info') out.push(finding({ id: 'security:http-redirect', area: 'security', kind: 'hint', textId: redirect.textId ?? 'security-http-unavailable' }));
  else if (redirect.result === 'not-checked') out.push(finding({ id: 'security:http-redirect', area: 'security', kind: 'not-checked', textId: 'security-http-redirect-not-checked' }));
  if (security.headersPresent < security.headersTotal) {
    const open = security.headers.filter((h) => !h.counts);
    const onlyManual = open.every((h) => h.status === 'manual');
    out.push(
      finding({
        id: 'security:headers',
        area: 'security',
        kind: onlyManual ? 'manual' : 'finding',
        risk: onlyManual ? null : 'low',
        textId: 'security-headers',
        params: { present: security.headersPresent, total: security.headersTotal },
        evidence: open.slice(0, REPORT_LIMITS.evidencePerFinding).map((h) => ({ type: 'header', name: h.header, status: h.status, value: h.value === null ? null : clip(h.value, 300) })),
      }),
    );
  }
  return out;
}

function reportSecurity(security: SecurityAnalysis): ReportSecurity {
  return {
    https: security.https.result,
    httpRedirect: security.httpRedirect.result,
    headers: security.headers.map((h) => ({ key: h.key, header: h.header, status: h.status, counts: h.counts, value: h.value === null ? null : clip(h.value, 300), textId: h.textId })),
    headersPresent: security.headersPresent,
    headersTotal: security.headersTotal,
  };
}

// ---------------------------------------------------------------------------------------------
// Mandatory information

const FIELD_IDS = ['address', 'email', 'handelsregister', 'ustId'] as const;

function fieldState(field: FieldResult<unknown>): FieldState {
  return field.status === 'found' ? { status: 'found', quote: clip(field.quote, 300) } : { status: 'not-found', reason: field.reason };
}

function isShop(analysis: CaptureAnalysis): boolean | null {
  const platform = analysis.platform;
  if (platform === null) return null;
  if (platform.system === 'shopify' || platform.system === 'shopware') return true;
  if (platform.system === 'wordpress' && platform.woocommerce) return true;
  return null;
}

function legalFindings(legal: LegalAnalysis, shop: boolean | null, almostEmpty: boolean, mode: 'full' | 'quick', linksCut = false): Finding[] {
  if (!legal.homepageRead) return [finding({ id: 'legal:not-checked', area: 'mandatory-information', kind: 'not-checked', textId: 'legal-not-checked' })];
  const out: Finding[] = [];
  const impressumTexts: Record<Exclude<LegalAnalysis['impressum']['state'], 'analyzed'>, { kind: FindingKind; textId: string; risk: FindingRisk | null }> = {
    // On a page that shows almost nothing (perhaps a page of bot protection) a missing link says nothing about the site: no risk.
    // Session fix-a2: the quick check reads only the HTML source. A link that a script builds in the browser
    // is not in it, so a link it does not find is a limit of the method: no risk, never in "Drei Dinge".
    // Session fix-a4: the scan did not read every link of the page (more links than the cap, or links left out
    // at a limit), so the link may be among those it did not read: no risk.
    'no-link': almostEmpty
      ? { kind: 'manual', textId: 'legal-impressum-no-link-empty-page', risk: null }
      : linksCut
        ? { kind: 'manual', textId: 'legal-impressum-no-link-links-cut', risk: null }
        : mode === 'quick'
          ? { kind: 'manual', textId: 'legal-impressum-no-link-quick', risk: null }
          : { kind: 'manual', textId: 'legal-impressum-no-link', risk: 'high' },
    'same-page': { kind: 'manual', textId: 'legal-impressum-same-page', risk: null },
    pdf: { kind: 'manual', textId: 'legal-impressum-pdf', risk: null },
    failed: { kind: 'manual', textId: 'legal-impressum-failed', risk: null },
    'not-captured': { kind: 'not-checked', textId: 'legal-impressum-not-checked', risk: null },
  };
  const state = legal.impressum.state;
  if (state !== 'analyzed') {
    const t = impressumTexts[state];
    out.push(finding({ id: 'legal:impressum', area: 'mandatory-information', kind: t.kind, risk: t.risk, textId: t.textId }));
  } else {
    for (const id of FIELD_IDS) {
      const field = legal.fields[id];
      if (field.status === 'not-found') out.push(finding({ id: `legal:field:${id.toLowerCase()}`, area: 'mandatory-information', kind: 'manual', textId: 'legal-field-not-found', params: { field: id } }));
    }
  }
  const privacy = legal.links.datenschutz;
  if (privacy === null) out.push(finding({ id: 'legal:datenschutz', area: 'mandatory-information', kind: 'manual', textId: 'legal-datenschutz-no-link' }));
  // Session fix-a3 (review finding 14): a link to another site (the policy of a captcha or payment provider)
  // or to an anchor of the homepage (the button of a consent tool) is not "the link is there".
  else if (!privacy.certain) out.push(finding({ id: 'legal:datenschutz', area: 'mandatory-information', kind: 'manual', textId: 'legal-datenschutz-uncertain', params: { reason: privacy.uncertain ?? 'other-site' } }));
  const statement = legal.accessibilityStatement;
  if (statement !== null && !statement.certain) {
    out.push(finding({ id: 'legal:accessibility-statement', area: 'mandatory-information', kind: 'manual', textId: 'legal-accessibility-statement-uncertain', params: { page: statement.page } }));
  } else if (statement === null && shop === true) {
    out.push(finding({ id: 'legal:accessibility-statement', area: 'mandatory-information', kind: 'manual', textId: 'legal-accessibility-statement-not-found' }));
  }
  return out;
}

function reportLegal(legal: LegalAnalysis): ReportLegal {
  const link = (l: { href: string; text: string } | null): { href: string; text: string } | null => (l === null ? null : { href: clipUrl(l.href, 'link'), text: clip(l.text, 300) });
  const statement = legal.accessibilityStatement;
  return {
    impressumLink: link(legal.links.impressum),
    // Only a link the scan is sure of; an uncertain one is the manual check `legal-datenschutz-uncertain`.
    datenschutzLink: link(legal.links.datenschutz?.certain === true ? legal.links.datenschutz : null),
    accessibilityStatement: statement === null ? null : { href: clipUrl(statement.href, 'link'), text: clip(statement.text, 300), certain: statement.certain, page: statement.page },
    impressum: { state: legal.impressum.state, url: legal.impressum.url === null ? null : clipUrl(legal.impressum.url, 'link'), crossSite: legal.impressum.crossSite },
    fields: {
      address: fieldState(legal.fields.address),
      email: fieldState(legal.fields.email),
      handelsregister: fieldState(legal.fields.handelsregister),
      ustId: fieldState(legal.fields.ustId),
    },
  };
}

const AREA_OF_PART: Record<AnalysisPart, FindingArea | null> = { thirdParty: 'privacy', legal: 'mandatory-information', accessibility: 'accessibility', security: 'security', platform: null };

/** Session fix-a4: one "nicht geprüft" item for each part of the analysis that threw. */
function analyzerErrorFindings(analysis: CaptureAnalysis): Finding[] {
  const out: Finding[] = [];
  for (const part of Object.keys(analysis.errors ?? {}) as AnalysisPart[]) {
    const area = AREA_OF_PART[part];
    if (area !== null) out.push(finding({ id: `scan:not-analysed:${idPart(part)}`, area, kind: 'not-checked', textId: 'section-not-analysed', params: { section: part } }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Measures ("Prüfmaße")

function a11yResult(a11y: AccessibilityAnalysis | null, id: A11yCheck['id']): Measure['result'] {
  if (a11y === null || a11y.status === 'not-checked') return 'not-checked';
  const check = a11y.checks.find((c) => c.id === id);
  if (check === undefined || check.result === 'not-checked') return 'not-checked';
  // Session fix-a6 (review finding 83): what a large iframe shows was not checked, so nothing is "erfüllt".
  if (check.result === 'pass' && a11y.framedContent != null) return 'manual';
  return check.result;
}

/**
 * Session fix-a1: on a page that shows almost nothing no row is "erfüllt": what such a page lacks (no
 * third-party request, no image without a description, …) may be the emptiness of a check page.
 * Session fix-a2: no row is "nicht erfüllt" either, and no measured value is shown: what the page has may
 * be the protection, not the site. Every row that was checked becomes "bitte manuell prüfen".
 */
function manualOnly(measures: Measure[]): Measure[] {
  return measures.map((m) => (m.result === 'not-checked' ? m : { ...m, result: 'manual', actual: null }));
}

/** Session fix-a2: what stays of the findings of an almost empty page: manual checks and checks that did not run. */
function withoutFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.kind === 'manual' || f.kind === 'not-checked');
}

/**
 * "Bilder mit Beschreibung" (session fix-a2): `actual` counts only images with a text alternative, of the
 * images that have one, lack one or are undecided. Images marked as decoration are in neither number.
 *
 * The result follows axe (the owner's answer of 24.11.2026, session fix-a3): an empty alt marks a
 * decorative image and is no error. The row is "nicht erfüllt" when an image lacks a description,
 * "erfüllt" when none does, and "bitte manuell prüfen" for an image axe could not decide or a capture
 * that does not say how the passing images split. Images marked as decoration do not change the row:
 * they are the separate manual check `a11y:image-alt:decorative` with their count.
 */
function imagesMeasure(a11y: AccessibilityAnalysis | null): Measure {
  const target: Measure['target'] = { type: 'all' };
  const check = a11yResult(a11y, 'image-alt');
  const images = a11y?.images ?? null;
  if (check === 'not-checked' || images === null) return { id: 'images-described', result: 'not-checked', target, actual: null };
  const actual: Measure['actual'] = images.described === null || images.total === null ? null : { type: 'of', count: countOf(images.described), total: countOf(images.total) };
  if (check === 'fail') return { id: 'images-described', result: 'fail', target, actual };
  // Review finding 68 ("0 von 0" is "erfüllt") is not changed here: the row follows axe by the owner's answer of
  // 24.11.2026, and axe passes a page without images. Question for Fedor (session fix-a6), `docs/backlog.md`.
  const sure = check === 'pass' && images.described !== null;
  return { id: 'images-described', result: sure ? 'pass' : 'manual', target, actual };
}

function buildMeasures(analysis: CaptureAnalysis, sections: Record<SectionId, SectionStatus>): Measure[] {
  const tp = sections.thirdParty.status === 'checked' ? analysis.thirdParty : null;
  const a11y = sections.accessibility.status === 'checked' ? analysis.accessibility : null;
  const legal = sections.legal.status === 'checked' ? analysis.legal : null;
  const security = sections.security.status === 'checked' ? analysis.security : null;
  const measures: Measure[] = [];

  const findings = tp === null ? null : tp.services.filter((s) => s.severity === 'finding').length;
  measures.push({ id: 'third-party-before-consent', result: findings === null ? 'not-checked' : findings > 0 ? 'fail' : 'pass', target: { type: 'count', count: 0 }, actual: findings === null ? null : { type: 'count', count: findings } });

  if (legal === null || !legal.homepageRead || legal.impressum.state === 'not-captured') {
    measures.push({ id: 'impressum-fields', result: 'not-checked', target: { type: 'of', count: 4, total: 4 }, actual: null });
  } else if (legal.impressum.state !== 'analyzed') {
    measures.push({ id: 'impressum-fields', result: 'manual', target: { type: 'of', count: 4, total: 4 }, actual: null });
  } else {
    const found = FIELD_IDS.filter((id) => legal.fields[id].status === 'found').length;
    measures.push({ id: 'impressum-fields', result: found === 4 ? 'pass' : 'manual', target: { type: 'of', count: 4, total: 4 }, actual: { type: 'of', count: found, total: 4 } });
  }

  const contrast = a11yResult(a11y, 'color-contrast');
  const lowest = a11y?.lowestContrast ?? null;
  const ratio: Measure['actual'] = contrast === 'not-checked' || lowest === null || lowest.ratio === null || lowest.ratio < 1 ? null : { type: 'ratio', ratio: Math.min(21, lowest.ratio), expected: expectedOf(lowest.expected) };
  // Session fix-a6 (review finding 68): "erfüllt" needs a measured contrast; a page where axe measured no text is not checked.
  measures.push({ id: 'lowest-contrast', result: contrast === 'pass' && ratio === null ? 'not-checked' : contrast, target: { type: 'ratio', ratio: 4.5, expected: '4.5:1' }, actual: ratio });

  measures.push(imagesMeasure(a11y));

  if (legal === null || !legal.homepageRead) {
    measures.push({ id: 'accessibility-statement', result: 'not-checked', target: { type: 'state', state: 'present' }, actual: null });
  } else {
    const statement = legal.accessibilityStatement;
    const state = statement === null ? 'not-found' : statement.certain ? 'found' : 'uncertain';
    // Unsure means manual check: a statement the scan did not find is never "fehlt" (product rule 3).
    measures.push({ id: 'accessibility-statement', result: state === 'found' ? 'pass' : 'manual', target: { type: 'state', state: 'present' }, actual: { type: 'state', state } });
  }

  if (security === null) {
    measures.push({ id: 'https', result: 'not-checked', target: { type: 'state', state: 'https' }, actual: null });
    measures.push({ id: 'security-headers', result: 'not-checked', target: { type: 'of', count: 5, total: 5 }, actual: null });
  } else {
    const https = security.https.result;
    measures.push({ id: 'https', result: https, target: { type: 'state', state: 'https' }, actual: { type: 'state', state: https === 'pass' ? 'https' : https === 'fail' ? 'http' : 'unknown' } });
    const present = security.headersPresent;
    const total = security.headersTotal;
    // Session fix-a6 (review findings 81 and 68): a header the scan could not decide (`manual`: the meta tags were
    // not read, or the value was too long) may be there, so neither "0 von 5" nor "teilweise" is certain.
    const undecided = security.headers.some((h) => !h.counts && h.status === 'manual');
    const result: Measure['result'] = present === total ? 'pass' : undecided ? 'manual' : present === 0 ? 'fail' : 'partial';
    measures.push({ id: 'security-headers', result, target: { type: 'of', count: total, total }, actual: { type: 'of', count: present, total } });
  }
  return measures;
}

// ---------------------------------------------------------------------------------------------
// Ordering

const KIND_RANK: Record<FindingKind, number> = { finding: 0, manual: 1, hint: 2, 'not-checked': 3 };
const RISK_RANK: Record<FindingRisk, number> = { high: 0, medium: 1, low: 2 };
const AREA_RANK: Record<FindingArea, number> = { privacy: 0, 'mandatory-information': 1, accessibility: 2, security: 3 };

function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((f, index) => ({ f, index }))
    .sort(
      (a, b) =>
        KIND_RANK[a.f.kind] - KIND_RANK[b.f.kind] ||
        (a.f.risk === null ? 3 : RISK_RANK[a.f.risk]) - (b.f.risk === null ? 3 : RISK_RANK[b.f.risk]) ||
        AREA_RANK[a.f.area] - AREA_RANK[b.f.area] ||
        a.index - b.index,
    )
    .map((x) => x.f);
}

/**
 * "Drei Dinge sollten Sie zuerst beheben": the first three items with a risk. Session fix-a6 (review finding 70):
 * chosen by risk first, then findings before manual checks, then area and the order of the analysis, so a manual
 * check with a high risk (no Impressum link found) never gives way to a finding with a lower risk. The list of
 * findings itself keeps its order (findings before manual checks, confirmed by Fedor on 23.11.2026).
 */
function prioritiesOf(findings: readonly Finding[]): string[] {
  return findings
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.risk !== null && (f.kind === 'finding' || f.kind === 'manual'))
    .sort((a, b) => RISK_RANK[a.f.risk as FindingRisk] - RISK_RANK[b.f.risk as FindingRisk] || KIND_RANK[a.f.kind] - KIND_RANK[b.f.kind] || a.index - b.index)
    .slice(0, 3)
    .map(({ f }) => f.id);
}

// ---------------------------------------------------------------------------------------------
// The report

function stateOf(analysis: CaptureAnalysis, mode: 'full' | 'quick'): ReportState {
  if (analysis.state === 'blocked') return 'blocked';
  if (analysis.state === 'failed') return analysis.failure?.reason === 'not-allowed' ? 'not-allowed' : 'failed';
  return mode === 'quick' ? 'quick' : 'complete';
}

function rejectionOf(message: string): string | null {
  const match = /^not allowed: ([a-z-]+)/.exec(message);
  return match?.[1] ?? null;
}

function noticeOf(state: ReportState, analysis: CaptureAnalysis, mode: 'full' | 'quick'): Report['notice'] {
  switch (state) {
    case 'complete':
      return analysis.almostEmpty === null ? null : { textId: 'report-page-almost-empty', params: {} };
    case 'quick':
      return { textId: 'report-quick-incomplete', params: analysis.almostEmpty === null ? {} : { pageAlmostEmpty: true } };
    case 'blocked':
      // Session fix-a2: a block met by the quick check says nothing about the full check with the browser,
      // which is possible again the next day (and such a report is not reused from the 24-hour cache).
      return { textId: 'report-blocked', params: { status: analysis.failure?.status ?? null, ...(mode === 'quick' ? { quickCheck: true } : {}) } };
    case 'not-allowed':
      return { textId: 'report-not-allowed', params: { rejection: rejectionOf(analysis.failure?.message ?? '') } };
    case 'failed':
      return { textId: 'report-failed', params: { reason: analysis.failure?.reason ?? 'other', status: analysis.failure?.status ?? null } };
  }
}

/**
 * Session fix-a2: the HTML source the quick check read holds no text and no link (the shell of a page that a
 * script fills in the browser, or a page that only sets a cookie and reloads). Nothing can be said about
 * links, Impressum or the system from it.
 */
function emptySource(capture: Capture): boolean {
  const page = capture.page;
  return page !== null && page.text.trim() === '' && page.links.length === 0;
}

function sectionsOf(state: ReportState, analysis: CaptureAnalysis, capture: Capture): Record<SectionId, SectionStatus> {
  return withAnalyzerErrors(sectionsBefore(state, analysis, capture), state, analysis);
}

/** Session fix-a4: a part whose analysis threw is "nicht geprüft" with the reason `analyzer-error`. */
function withAnalyzerErrors(sections: Record<SectionId, SectionStatus>, state: ReportState, analysis: CaptureAnalysis): Record<SectionId, SectionStatus> {
  if ((state !== 'complete' && state !== 'quick') || analysis.errors === undefined) return sections;
  const out = { ...sections };
  for (const part of Object.keys(analysis.errors) as AnalysisPart[]) if (out[part].status === 'checked') out[part] = { status: 'not-checked', reason: 'analyzer-error' };
  return out;
}

function sectionsBefore(state: ReportState, analysis: CaptureAnalysis, capture: Capture): Record<SectionId, SectionStatus> {
  const checked: SectionStatus = { status: 'checked', reason: null };
  if (state === 'blocked' || state === 'not-allowed' || state === 'failed') {
    const off: SectionStatus = { status: 'not-checked', reason: 'page-not-loaded' };
    return { thirdParty: off, accessibility: off, security: off, legal: off, platform: off };
  }
  const quick: SectionStatus = { status: 'not-checked', reason: 'quick-check' };
  const a11y = analysis.accessibility;
  const nothingRead = state === 'quick' && emptySource(capture);
  if (nothingRead) return { thirdParty: quick, accessibility: quick, security: { status: 'checked', reason: null }, legal: quick, platform: quick };
  return {
    thirdParty: state === 'quick' ? quick : checked,
    accessibility: state === 'quick' ? quick : a11y === null || a11y.status === 'not-checked' ? { status: 'not-checked', reason: clip(a11y?.reason ?? 'no accessibility data', 300) } : checked,
    security: checked,
    // A loaded page whose text and links could not be read: no link counts as missing (review of A5 part 2).
    legal: analysis.legal !== null && !analysis.legal.homepageRead ? { status: 'not-checked', reason: 'page-not-read' } : checked,
    platform: checked,
  };
}

function countryOf(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^[A-Z]{2}$/.test(value) ? value : null;
}

function coloOf(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^[A-Z]{3}$/.test(value) ? value : null;
}

export function buildReport(options: BuildReportOptions): BuiltReport {
  // Session fix-a4: the report is built from the capture within its limits, as the analysis is.
  const capture = limitCapture(options.capture);
  const analysis = analyzeCapture(capture, options.rules);
  const state = stateOf(analysis, options.mode);
  const sections = sectionsOf(state, analysis, capture);
  const loaded = state === 'complete' || state === 'quick';
  const host = new URL(options.siteUrl).hostname;
  const shop = loaded && sections.platform.status === 'checked' ? isShop(analysis) : null;

  const tp = sections.thirdParty.status === 'checked' ? analysis.thirdParty : null;
  const all: Finding[] = [];
  if (tp !== null) all.push(...thirdPartyFindings(tp, capture.axe?.status === 'ok' ? (capture.axe.positions ?? null) : null));
  const almostEmpty = analysis.almostEmpty !== null;
  const linksCut = capture.page?.linksTruncated === true;
  if (loaded && sections.legal.status === 'checked' && analysis.legal !== null) all.push(...legalFindings(analysis.legal, shop, almostEmpty, options.mode, linksCut));
  if (loaded && analysis.accessibility !== null) {
    if (sections.accessibility.status === 'checked' || sections.accessibility.reason !== 'quick-check') all.push(...accessibilityFindings(analysis.accessibility));
  }
  if (loaded && sections.security.status === 'checked' && analysis.security !== null) all.push(...securityFindings(analysis.security));
  if (loaded) all.push(...analyzerErrorFindings(analysis));
  // An almost empty page shows no finding and no hint: only the notice and manual checks (session fix-a2).
  if (almostEmpty) all.splice(0, all.length, ...withoutFindings(all));
  const sorted = sortFindings(all);
  const findings = sorted.slice(0, REPORT_LIMITS.findings);
  const findingIds = new Set(findings.map((f) => f.id));
  const priorities = prioritiesOf(findings);
  const services = tp === null ? [] : reportServices(tp, findingIds, almostEmpty);
  const impressum = capture.impressum ?? null;
  const durationMs = loaded ? Math.max(capture.timings.endMs, impressum === null ? 0 : impressum.timings.openedAtMs + impressum.timings.totalMs) : null;
  const network = loaded ? networkHosts(capture, tp) : { rows: [], dropped: 0 };
  const platform = loaded && sections.platform.status === 'checked' && analysis.platform !== null ? analysis.platform : null;

  const report: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    id: options.id,
    createdAt: options.createdAt,
    state,
    site: { url: options.siteUrl, host, displayHost: displayHostOf(host), finalUrl: loaded && capture.finalUrl !== null ? clipUrl(capture.finalUrl, 'page') : null },
    scan: {
      mode: options.mode,
      scannedAt: capture.startedAt,
      durationMs: durationMs === null ? null : ms(durationMs),
      scannerVersion: options.scannerVersion,
      rulesUpdated: options.rulesUpdated,
      axeVersion: versionOf(capture.axe?.axeVersion),
      // Session fix-a6 (review finding 82): a page captured at the limit of 15 seconds was still loading.
      stopReason: loaded && capture.timings.stopReason !== 'error' ? capture.timings.stopReason : null,
    },
    visit: {
      country: countryOf((options.visit ?? capture.visit)?.country),
      colo: coloOf((options.visit ?? capture.visit)?.colo),
      adapter: capture.adapter,
      browser: options.mode === 'quick' ? null : clip(capture.environment.browser, 80),
      locale: capture.environment.locale,
      timezone: capture.environment.timezoneId,
      viewport: capture.environment.viewport,
    },
    notice: noticeOf(state, analysis, options.mode),
    failure: analysis.failure === null ? null : { reason: analysis.failure.reason, status: analysis.failure.status ?? null },
    pages: { homepage: loaded ? 'checked' : 'not-checked', impressum: loaded && analysis.legal?.impressum.state === 'analyzed' ? 'checked' : 'not-checked' },
    revision: { letter: 'A', kind: 'initial' },
    sections,
    platform: platform === null ? null : { system: platform.system, woocommerce: platform.woocommerce, shopwareVersion: platform.shopwareVersion, shop },
    measures: !loaded ? [] : almostEmpty ? manualOnly(buildMeasures(analysis, sections)) : buildMeasures(analysis, sections),
    findings,
    priorities,
    services,
    timeline: tp === null ? null : buildTimeline(capture, tp),
    legal: loaded && sections.legal.status === 'checked' && analysis.legal !== null ? reportLegal(analysis.legal) : null,
    // An almost empty page shows no measured state of HTTPS and the headers either (session fix-a2).
    security: loaded && !almostEmpty && analysis.security !== null ? reportSecurity(analysis.security) : null,
    counts: {
      findings: countOf(all.filter((f) => f.kind === 'finding').length),
      manual: countOf(all.filter((f) => f.kind === 'manual').length),
      hints: countOf(all.filter((f) => f.kind === 'hint').length),
      notChecked: countOf(all.filter((f) => f.kind === 'not-checked').length),
      services: countOf(tp === null ? 0 : tp.services.length),
    },
    truncated: {
      findings: sorted.length > findings.length,
      services: tp !== null && tp.services.length > services.length,
      page: loaded ? pageCuts(capture, analysis) : [],
    },
  };
  return { report: fitReport(report), networkHosts: network.rows, networkHostsDropped: network.dropped, analysis };
}

/**
 * Session fix-a4: what the scan read of the page only up to a limit (`CAPTURE_LIMITS`), so the report can
 * say so: the text of a page (100,000 characters), its links (1,500 and those naming a legal page; links
 * with an address over the limit), a header with a value over the limit.
 */
function pageCuts(capture: Capture, analysis: CaptureAnalysis): PageCut[] {
  const cuts: PageCut[] = [];
  if (capture.page?.textTruncated === true) cuts.push('homepage-text');
  if (capture.page?.linksTruncated === true) cuts.push('homepage-links');
  const impressum = analysis.legal?.impressum.state === 'analyzed' ? (capture.impressum?.page ?? null) : null;
  if (impressum?.textTruncated === true) cuts.push('impressum-text');
  if (impressum?.linksTruncated === true) cuts.push('impressum-links');
  if ((capture.mainDocument?.headersCut ?? []).length > 0) cuts.push('headers');
  return cuts;
}

/**
 * Session fix-a4 (review finding 54): a report larger than `maxReportChars` is made smaller, never thrown
 * away. First the examples go (one piece of evidence per finding, two hosts and sources per service), then
 * the list of services and after it the list of findings is halved until the report fits; `truncated` says
 * that they were cut, `counts` keeps the full numbers.
 */
function fitReport(report: Report): Report {
  const fits = (r: Report): boolean => JSON.stringify(r).length <= REPORT_LIMITS.maxReportChars;
  if (fits(report)) return report;
  let r: Report = {
    ...report,
    findings: report.findings.map((f) => ({ ...f, evidence: f.evidence.slice(0, 1) })),
    services: report.services.map((s) => ({ ...s, hosts: s.hosts.slice(0, 2), sources: s.sources.slice(0, 2) })),
  };
  for (let step = 0; step < 16 && !fits(r); step += 1) {
    const services = r.services.slice(0, Math.floor(r.services.length / 2));
    const findings = r.services.length > 0 ? r.findings : r.findings.slice(0, Math.floor(r.findings.length / 2));
    const ids = new Set(findings.map((f) => f.id));
    r = {
      ...r,
      findings,
      priorities: r.priorities.filter((id) => ids.has(id)),
      services: services.map((s) => (s.findingId !== null && !ids.has(s.findingId) ? { ...s, findingId: null } : s)),
      truncated: { ...r.truncated, services: r.truncated.services || services.length < r.services.length, findings: r.truncated.findings || findings.length < r.findings.length },
    };
  }
  return r;
}
