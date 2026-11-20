import type { Capture, CapturedRequest } from '../capture/types.ts';
import { firstPartySites, hostOf, siteOfHost, siteOfUrl } from '../domain/site.ts';
import type { CompiledRules, RuleMatch } from '../rules/match.ts';
import {
  INFRASTRUCTURE_CATEGORIES,
  RISK_CLASSES,
  SEVERITY_OF_RISK_CLASS,
  type DataLocation,
  type RiskClass,
  type ServiceCategory,
  type Severity,
} from '../rules/types.ts';

/**
 * Analyzer for third-party services: a pure function from a capture to the list of
 * third-party services the page contacted without any interaction (so before consent).
 *
 * - First party: requests to the registrable domain of the final URL or of a redirect hop.
 * - Every other request is attributed to exactly one service:
 *   1. A request made inside a third-party iframe belongs to the service of the outermost
 *      third-party iframe (an embedded YouTube video owns everything it loads).
 *   2. A request that a script or stylesheet of an embedded product (map, video, chat,
 *      reviews, analytics, …, see INFRASTRUCTURE_CATEGORIES) triggers in the page belongs to
 *      that product only if it goes to the same provider, e.g. Google Fonts loaded by the
 *      Google Maps script belongs to Google Maps. A request to another provider is a service
 *      of its own (Google Fonts loaded by a newsletter app is Google Fonts); its evidence
 *      names the initiator. Infrastructure (fonts, CDNs, platforms, consent tools, tag
 *      managers) and unknown scripts are looked through: the chain continues upwards.
 *   3. Otherwise the request belongs to the service whose host pattern matches its URL, or
 *      to an unknown third party grouped by registrable domain.
 * - Risk class comes from the rules data. Unknown third parties are grey-zone hints.
 * - A service is a finding only if at least one of its requests reached the server (a
 *   response arrived). Requests that all failed (for example a dead domain) make it a hint.
 */

export const THIRD_PARTY_ANALYSIS_VERSION = 1;
const MAX_EVIDENCE = 20;
const MAX_URL_LENGTH = 500;
const MAX_INITIATOR_DEPTH = 10;

export interface Via {
  kind: 'frame' | 'initiator';
  /** URL of the iframe or of the script/stylesheet that caused the request */
  url: string;
}

export interface ThirdPartyEvidence {
  url: string;
  startMs: number;
  resourceType: string;
  status: number | null;
  failure: string | null;
  /** True if a response arrived, so the request certainly reached the server */
  reachedServer: boolean;
  /** Set when the request was attributed to this service through an iframe or an initiator */
  via: Via | null;
  /** The service the request's own host belongs to, if it differs from this service */
  ownServiceId: string | null;
  /** Document, stylesheet or script that triggered the request, if known (best effort) */
  initiatorUrl: string | null;
}

export interface DetectedService {
  /** Rules id, or `unknown:<registrable domain>` */
  key: string;
  known: boolean;
  serviceId: string | null;
  name: string;
  provider: string | null;
  category: ServiceCategory | 'unknown';
  riskClass: RiskClass;
  dataLocation: DataLocation;
  sources: string[];
  /** finding (precedent, consent-required, usually-consent), hint (grey-zone or unconfirmed) or none */
  severity: Severity;
  /** At least one request reached the server */
  confirmed: boolean;
  hosts: string[];
  requestCount: number;
  firstStartMs: number;
  /** Null when the banner time is unknown. Extra information only, never the basis of a finding. */
  startsBeforeBanner: boolean | null;
  /** Other known services whose requests were attributed to this one */
  includes: { serviceId: string; requestCount: number }[];
  evidence: ThirdPartyEvidence[];
  evidenceTruncated: boolean;
}

export interface ThirdPartyAnalysis {
  analyzer: 'third-party';
  version: typeof THIRD_PARTY_ANALYSIS_VERSION;
  requestedUrl: string;
  finalUrl: string | null;
  firstPartySites: string[];
  bannerVisibleAtMs: number | null;
  counts: {
    requests: number;
    firstPartyRequests: number;
    thirdPartyRequests: number;
    /** Requests without an http(s) host (data:, blob:, …) */
    ignoredRequests: number;
    services: number;
    findings: number;
    hints: number;
    byRiskClass: Record<RiskClass, number>;
  };
  /** Sorted: findings first (by risk class), then hints, then the rest; each by start time */
  services: DetectedService[];
}

type Owner =
  | { kind: 'service'; key: string; match: RuleMatch }
  | { kind: 'unknown'; key: string; site: string };

interface Attribution {
  owner: Owner;
  via: Via | null;
}

function reachedServer(request: CapturedRequest): boolean {
  if (request.status !== null) return true;
  return request.failure !== null && /ERR_BLOCKED_BY_(?:RESPONSE|ORB)/.test(request.failure);
}

function truncate(url: string): string {
  return url.length <= MAX_URL_LENGTH ? url : `${url.slice(0, MAX_URL_LENGTH - 1)}…`;
}

function isProduct(owner: Owner): boolean {
  return owner.kind === 'service' && !INFRASTRUCTURE_CATEGORIES.has(owner.match.rule.category);
}

/** Both are known services of the same provider (e.g. Google Maps and Google Fonts). */
function sameProvider(a: Owner, b: Owner): boolean {
  return a.kind === 'service' && b.kind === 'service' && a.match.rule.provider.trim().toLowerCase() === b.match.rule.provider.trim().toLowerCase();
}

export function analyzeThirdParty(capture: Capture, rules: CompiledRules): ThirdPartyAnalysis {
  const firstParty = firstPartySites(capture);
  const isFirstPartyUrl = (url: string): boolean => {
    const site = siteOfUrl(url);
    return site !== null && firstParty.has(site);
  };
  const ownerOfUrl = (url: string): Owner | null => {
    const host = hostOf(url);
    if (host === null) return null;
    const match = rules.match(url);
    if (match !== null) return { kind: 'service', key: match.rule.id, match };
    const site = siteOfHost(host);
    return { kind: 'unknown', key: `unknown:${site}`, site };
  };

  const requests = [...capture.requests].sort((a, b) => a.seq - b.seq);
  const attributions = new Map<number, Attribution>();
  const latestBySeqUrl = new Map<string, CapturedRequest[]>();
  let firstPartyRequests = 0;
  let ignoredRequests = 0;

  const findInitiatorRequest = (url: string, beforeSeq: number): CapturedRequest | null => {
    const candidates = latestBySeqUrl.get(url);
    if (candidates === undefined) return null;
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = candidates[i];
      if (candidate !== undefined && candidate.seq < beforeSeq) return candidate;
    }
    return null;
  };

  /** Attribution through the initiator chain, or null if the request stands on its own. */
  const attributeByInitiator = (request: CapturedRequest, own: Owner): Attribution | null => {
    let current: CapturedRequest = request;
    for (let depth = 0; depth < MAX_INITIATOR_DEPTH; depth += 1) {
      const initiatorUrl = current.initiator?.url ?? null;
      if (initiatorUrl === null || isFirstPartyUrl(initiatorUrl)) return null;
      const initiatorRequest = findInitiatorRequest(initiatorUrl, current.seq);
      if (initiatorRequest !== null) {
        const inherited = attributions.get(initiatorRequest.seq);
        if (inherited !== undefined && inherited.via !== null) {
          if (inherited.owner.key === own.key || !sameProvider(inherited.owner, own)) return null;
          return { owner: inherited.owner, via: { kind: 'initiator', url: initiatorUrl } };
        }
      }
      const initiatorOwner = ownerOfUrl(initiatorUrl);
      if (initiatorOwner === null || initiatorOwner.key === own.key) return null;
      if (isProduct(initiatorOwner)) {
        // An embedded product owns what it loads from its own provider, nothing else.
        return sameProvider(initiatorOwner, own) ? { owner: initiatorOwner, via: { kind: 'initiator', url: initiatorUrl } } : null;
      }
      // Infrastructure or an unknown third party: look one step further up the chain.
      if (initiatorRequest === null) return null;
      current = initiatorRequest;
    }
    return null;
  };

  for (const request of requests) {
    const list = latestBySeqUrl.get(request.url) ?? [];
    list.push(request);
    latestBySeqUrl.set(request.url, list);

    const own = ownerOfUrl(request.url);
    if (own === null) {
      ignoredRequests += 1;
      continue;
    }
    if (isFirstPartyUrl(request.url)) {
      firstPartyRequests += 1;
      continue;
    }
    // 1. Inside a third-party iframe: the outermost third-party frame owns the request.
    let attribution: Attribution | null = null;
    for (let i = request.frameUrls.length - 1; i >= 0; i -= 1) {
      const frameUrl = request.frameUrls[i];
      if (frameUrl === undefined || isFirstPartyUrl(frameUrl)) continue;
      const frameOwner = ownerOfUrl(frameUrl);
      if (frameOwner !== null) {
        attribution = frameOwner.key === own.key ? { owner: own, via: null } : { owner: frameOwner, via: { kind: 'frame', url: frameUrl } };
      }
      break;
    }
    // 2. Triggered by an embedded product, 3. otherwise its own host.
    attribution ??= attributeByInitiator(request, own) ?? { owner: own, via: null };
    attributions.set(request.seq, attribution);
  }

  const bannerAt = capture.consentBanner.detected ? capture.consentBanner.visibleAtMs : null;
  const groups = new Map<string, { owner: Owner; items: { request: CapturedRequest; via: Via | null; own: Owner }[] }>();
  for (const request of requests) {
    const attribution = attributions.get(request.seq);
    if (attribution === undefined) continue;
    const own = ownerOfUrl(request.url);
    if (own === null) continue;
    const group = groups.get(attribution.owner.key) ?? { owner: attribution.owner, items: [] };
    group.items.push({ request, via: attribution.via, own });
    groups.set(attribution.owner.key, group);
  }

  const services: DetectedService[] = [];
  for (const { owner, items } of groups.values()) {
    items.sort((a, b) => a.request.startMs - b.request.startMs || a.request.seq - b.request.seq);
    const confirmed = items.some((item) => reachedServer(item.request));
    const rule = owner.kind === 'service' ? owner.match.rule : null;
    const riskClass: RiskClass = rule?.riskClass ?? 'grey-zone';
    const baseSeverity = SEVERITY_OF_RISK_CLASS[riskClass];
    const severity: Severity = baseSeverity === 'finding' && !confirmed ? 'hint' : baseSeverity;
    const includes = new Map<string, number>();
    for (const item of items) {
      if (item.own.kind === 'service' && item.own.key !== owner.key) {
        includes.set(item.own.key, (includes.get(item.own.key) ?? 0) + 1);
      }
    }
    const firstStartMs = items[0]?.request.startMs ?? 0;
    services.push({
      key: owner.key,
      known: rule !== null,
      serviceId: rule?.id ?? null,
      name: rule?.name ?? (owner.kind === 'unknown' ? owner.site : owner.key),
      provider: rule?.provider ?? null,
      category: rule?.category ?? 'unknown',
      riskClass,
      dataLocation: rule?.dataLocation ?? 'unknown',
      sources: rule?.sources ?? [],
      severity,
      confirmed,
      hosts: [...new Set(items.map((item) => hostOf(item.request.url) ?? ''))].filter((h) => h !== '').sort(),
      requestCount: items.length,
      firstStartMs,
      startsBeforeBanner: bannerAt === null ? null : firstStartMs < bannerAt,
      includes: [...includes.entries()].map(([serviceId, requestCount]) => ({ serviceId, requestCount })).sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
      evidence: items.slice(0, MAX_EVIDENCE).map(({ request, via, own }) => ({
        url: truncate(request.url),
        startMs: request.startMs,
        resourceType: request.resourceType,
        status: request.status,
        failure: request.failure,
        reachedServer: reachedServer(request),
        via: via === null ? null : { kind: via.kind, url: truncate(via.url) },
        ownServiceId: own.kind === 'service' && own.key !== owner.key ? own.key : null,
        initiatorUrl: request.initiator?.url ? truncate(request.initiator.url) : null,
      })),
      evidenceTruncated: items.length > MAX_EVIDENCE,
    });
  }

  const severityRank: Record<Severity, number> = { finding: 0, hint: 1, none: 2 };
  services.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      RISK_CLASSES.indexOf(a.riskClass) - RISK_CLASSES.indexOf(b.riskClass) ||
      a.firstStartMs - b.firstStartMs ||
      a.key.localeCompare(b.key),
  );

  const byRiskClass = Object.fromEntries(RISK_CLASSES.map((rc) => [rc, 0])) as Record<RiskClass, number>;
  for (const service of services) byRiskClass[service.riskClass] += 1;
  const thirdPartyRequests = attributions.size;

  return {
    analyzer: 'third-party',
    version: THIRD_PARTY_ANALYSIS_VERSION,
    requestedUrl: capture.requestedUrl,
    finalUrl: capture.finalUrl,
    firstPartySites: [...firstParty].sort(),
    bannerVisibleAtMs: bannerAt,
    counts: {
      requests: requests.length,
      firstPartyRequests,
      thirdPartyRequests,
      ignoredRequests,
      services: services.length,
      findings: services.filter((s) => s.severity === 'finding').length,
      hints: services.filter((s) => s.severity === 'hint').length,
      byRiskClass,
    },
    services,
  };
}
