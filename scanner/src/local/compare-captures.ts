import { analyzeCapture } from '../analyzers/capture.ts';
import type { ThirdPartyAnalysis } from '../analyzers/third-party.ts';
import { recheckCapture } from '../capture/failure.ts';
import type { Capture } from '../capture/types.ts';
import { firstPartySites, hostOf, siteOfUrl } from '../domain/site.ts';
import type { CompiledRules } from '../rules/match.ts';

/**
 * Compares two captures of the same page (for session A2: the local Playwright run and a
 * Cloudflare run). Pure function; the result holds host names and service ids of one site,
 * so it stays in `local/` like every per-site result.
 */

export interface CaptureSide {
  ok: boolean;
  failure: string | null;
  requests: number;
  thirdPartyRequests: number;
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
  /** The cloud capture has a third-party host, service or finding that the local one lacks, or no banner where the local one has one. */
  needsReview: boolean;
}

function side(capture: Capture, analysis: ThirdPartyAnalysis | null): CaptureSide {
  const firstParty = firstPartySites(capture);
  const thirdParty = capture.requests.filter((r) => {
    const site = siteOfUrl(r.url);
    return site !== null && !firstParty.has(site);
  });
  return {
    ok: capture.ok,
    failure: capture.failure === null ? null : `${capture.failure.reason}: ${capture.failure.message.slice(0, 120)}`,
    requests: capture.requests.length,
    thirdPartyRequests: thirdParty.length,
    stopReason: capture.timings.stopReason,
    endMs: capture.timings.endMs,
    banner: { detected: capture.consentBanner.detected, toolId: capture.consentBanner.toolId, visibleAtMs: capture.consentBanner.visibleAtMs },
    toolsInDom: capture.consentBanner.toolsInDom,
    signals: capture.consentBanner.signals ?? null,
    findings: (analysis?.services ?? []).filter((s) => s.severity === 'finding').map((s) => s.key).sort(),
    hints: (analysis?.services ?? []).filter((s) => s.severity === 'hint').map((s) => s.key).sort(),
  };
}

function thirdPartyHosts(capture: Capture): Set<string> {
  const firstParty = firstPartySites(capture);
  const hosts = new Set<string>();
  for (const request of capture.requests) {
    const site = siteOfUrl(request.url);
    const host = hostOf(request.url);
    if (site !== null && host !== null && !firstParty.has(site)) hosts.add(host);
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

function hostPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
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
  const cloudPaths = new Set(cloud.requests.map((r) => hostPath(r.url)).filter((x): x is string => x !== null));
  const localPaths = local.requests.map((r) => hostPath(r.url)).filter((x): x is string => x !== null);
  const matched = localPaths.filter((p) => cloudPaths.has(p)).length;
  const hosts = diff(thirdPartyHosts(local), thirdPartyHosts(cloud));
  const services = diff([...localSide.findings, ...localSide.hints], [...cloudSide.findings, ...cloudSide.hints]);
  const findings = diff(localSide.findings, cloudSide.findings);
  return {
    local: localSide,
    cloud: cloudSide,
    thirdPartyHosts: hosts,
    services,
    findings,
    completenessPct: localPaths.length === 0 ? 100 : Math.round((matched / localPaths.length) * 1000) / 10,
    needsReview:
      hosts.onlyCloud.length > 0 || services.onlyCloud.length > 0 || findings.onlyCloud.length > 0 || (localSide.banner.detected && !cloudSide.banner.detected),
  };
}
