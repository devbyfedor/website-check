import { analyzeCapture } from '../analyzers/capture.ts';
import type { ThirdPartyAnalysis } from '../analyzers/third-party.ts';
import { recheckCapture } from '../capture/failure.ts';
import type { Capture, CapturedRequest } from '../capture/types.ts';
import { firstPartySites, hostOf, siteOfUrl } from '../domain/site.ts';
import type { CompiledRules } from '../rules/match.ts';

/**
 * Compares two captures of the same page (for session A2: the local Playwright run and a
 * Cloudflare run). Pure function; the result holds host names and service ids of one site,
 * so it stays in `local/` like every per-site result.
 *
 * CORS preflight requests (`OPTIONS` before a cross-origin request) are left out of counts,
 * hosts and completeness: Puppeteer reports them as requests of their own, Playwright does not,
 * and the request they prepare is in both captures. They are counted separately, and so are
 * `data:` and `blob:` URLs, which are no network requests (Puppeteer reports `data:`, Playwright
 * does not). Hosts on
 * Google's country domains count as the same host on google.com (`rules.canonicalHost`): the
 * Cloudflare browser runs in different EU countries and Google answers it on www.google.it.
 */

export interface CaptureSide {
  ok: boolean;
  failure: string | null;
  /** Requests without CORS preflights */
  requests: number;
  thirdPartyRequests: number;
  /** CORS preflight requests (left out of the other numbers) */
  preflights: number;
  /** data:, blob: and other URLs that are not network requests (left out; Playwright never reports data:) */
  nonNetwork: number;
  stopReason: string;
  endMs: number;
  banner: { detected: boolean; toolId: string | null; visibleAtMs: number | null };
  toolsInDom: string[];
  signals: unknown;
  /** Service keys with severity "finding", "hint" */
  findings: string[];
  hints: string[];
}

export interface SetDiff {
  both: string[];
  onlyLocal: string[];
  onlyCloud: string[];
}

export interface CaptureComparison {
  local: CaptureSide;
  cloud: CaptureSide;
  /** Third-party host names (all requests are before consent: the scan never clicks). */
  thirdPartyHosts: SetDiff;
  services: SetDiff;
  findings: SetDiff;
  /**
   * Share of the local capture's requests (by host and path, without query) that the cloud
   * capture also has, in percent. Dynamic query strings differ between two visits anyway.
   */
  completenessPct: number;
  /** Requests of the cloud capture (by host and path) that the local capture does not have */
  onlyCloudRequests: number;
  /** The cloud capture has a third-party host, service or finding that the local one lacks, or no banner where the local one has one. */
  needsReview: boolean;
}

/**
 * A CORS preflight: an OPTIONS request with initiator type `preflight`. The method matters: the
 * local adapter pairs initiators with requests by URL, so a real POST can carry the initiator of
 * its own preflight.
 */
export function isPreflight(request: CapturedRequest): boolean {
  return request.method === 'OPTIONS' && request.initiator?.type === 'preflight';
}

/** Network requests that both adapters report: http(s) and ws(s), without preflights. */
function requestsOf(capture: Capture): CapturedRequest[] {
  return capture.requests.filter((r) => hostOf(r.url) !== null && !isPreflight(r));
}

function side(capture: Capture, analysis: ThirdPartyAnalysis | null): CaptureSide {
  const firstParty = firstPartySites(capture);
  const requests = requestsOf(capture);
  const thirdParty = requests.filter((r) => {
    const site = siteOfUrl(r.url);
    return site !== null && !firstParty.has(site);
  });
  return {
    ok: capture.ok,
    failure: capture.failure === null ? null : `${capture.failure.reason}: ${capture.failure.message.slice(0, 120)}`,
    requests: requests.length,
    thirdPartyRequests: thirdParty.length,
    preflights: capture.requests.filter((r) => hostOf(r.url) !== null && isPreflight(r)).length,
    nonNetwork: capture.requests.filter((r) => hostOf(r.url) === null).length,
    stopReason: capture.timings.stopReason,
    endMs: capture.timings.endMs,
    banner: { detected: capture.consentBanner.detected, toolId: capture.consentBanner.toolId, visibleAtMs: capture.consentBanner.visibleAtMs },
    toolsInDom: capture.consentBanner.toolsInDom,
    signals: capture.consentBanner.signals ?? null,
    findings: (analysis?.services ?? []).filter((s) => s.severity === 'finding').map((s) => s.key).sort(),
    hints: (analysis?.services ?? []).filter((s) => s.severity === 'hint').map((s) => s.key).sort(),
  };
}

function thirdPartyHosts(capture: Capture, canonicalHost: (host: string) => string): Set<string> {
  const firstParty = firstPartySites(capture);
  const hosts = new Set<string>();
  for (const request of requestsOf(capture)) {
    const site = siteOfUrl(request.url);
    const host = hostOf(request.url);
    if (site !== null && host !== null && !firstParty.has(site)) hosts.add(canonicalHost(host));
  }
  return hosts;
}

function diff(local: Iterable<string>, cloud: Iterable<string>): SetDiff {
  const a = new Set(local);
  const b = new Set(cloud);
  return {
    both: [...a].filter((x) => b.has(x)).sort(),
    onlyLocal: [...a].filter((x) => !b.has(x)).sort(),
    onlyCloud: [...b].filter((x) => !a.has(x)).sort(),
  };
}

function hostPath(url: string, canonicalHost: (host: string) => string): string | null {
  try {
    const parsed = new URL(url);
    const host = hostOf(url);
    return `${host === null ? parsed.host : canonicalHost(host)}${parsed.port === '' ? '' : `:${parsed.port}`}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export function compareCaptures(localCapture: Capture, cloudCapture: Capture, rules: CompiledRules): CaptureComparison {
  // Both sides decided again, so a check page saved as a normal page before A2 part 2 counts as blocked.
  const local = recheckCapture(localCapture);
  const cloud = recheckCapture(cloudCapture);
  const localAnalysis = analyzeCapture(local, rules).thirdParty;
  const cloudAnalysis = analyzeCapture(cloud, rules).thirdParty;
  const localSide = side(local, localAnalysis);
  const cloudSide = side(cloud, cloudAnalysis);
  const pathsOf = (capture: Capture): string[] =>
    requestsOf(capture).map((r) => hostPath(r.url, rules.canonicalHost)).filter((x): x is string => x !== null);
  const cloudPathList = pathsOf(cloud);
  const cloudPaths = new Set(cloudPathList);
  const localPaths = pathsOf(local);
  const localPathSet = new Set(localPaths);
  const matched = localPaths.filter((p) => cloudPaths.has(p)).length;
  const hosts = diff(thirdPartyHosts(local, rules.canonicalHost), thirdPartyHosts(cloud, rules.canonicalHost));
  const services = diff([...localSide.findings, ...localSide.hints], [...cloudSide.findings, ...cloudSide.hints]);
  const findings = diff(localSide.findings, cloudSide.findings);
  return {
    local: localSide,
    cloud: cloudSide,
    thirdPartyHosts: hosts,
    services,
    findings,
    completenessPct: localPaths.length === 0 ? 100 : Math.round((matched / localPaths.length) * 1000) / 10,
    onlyCloudRequests: cloudPathList.filter((p) => !localPathSet.has(p)).length,
    needsReview:
      hosts.onlyCloud.length > 0 || services.onlyCloud.length > 0 || findings.onlyCloud.length > 0 || (localSide.banner.detected && !cloudSide.banner.detected),
  };
}
