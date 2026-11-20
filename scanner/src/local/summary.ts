import type { ThirdPartyAnalysis } from '../analyzers/third-party.ts';
import type { Capture, CaptureFailureReason } from '../capture/types.ts';
import { RISK_CLASSES, type RiskClass } from '../rules/types.ts';

/**
 * Aggregation of a local run over the test sites. Only anonymous labels ("Site 07") and
 * numbers come out of here, so the Markdown can go into committed docs.
 */

export interface SiteRunResult {
  label: string;
  kind: string | null;
  platform: string | null;
  attempts: number;
  capture: Capture;
  analysis: ThirdPartyAnalysis | null;
}

export interface RunSummary {
  sites: number;
  captured: number;
  failures: { label: string; reason: CaptureFailureReason; message: string }[];
  byKind: Record<string, { sites: number; captured: number }>;
  retried: number;
  captureMs: { median: number | null; max: number | null };
  stopReasons: Record<string, number>;
  requestsPerPage: { median: number | null; max: number | null };
  thirdPartyRequestsPerPage: { median: number | null; max: number | null };
  banner: { detected: number; byTool: Record<string, number>; medianVisibleAtMs: number | null };
  sitesWithFinding: number;
  sitesWithHintOnly: number;
  sitesByRiskClass: Record<RiskClass, number>;
  sitesWithUnknownThirdParty: number;
  sitesWithFindingBeforeBanner: number;
  /** Known services: number of sites where the service was detected (any severity), sorted desc */
  serviceSites: { serviceId: string; sites: number }[];
  /** Labels of sites where Google Fonts is a confirmed finding */
  googleFontsSites: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return value === undefined ? null : Math.round(value);
}

function max(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function summarizeRun(results: readonly SiteRunResult[]): RunSummary {
  const ok = results.filter((r) => r.capture.ok);
  const analyses = ok.map((r) => r.analysis).filter((a): a is ThirdPartyAnalysis => a !== null);
  const byKind: RunSummary['byKind'] = {};
  for (const result of results) {
    const kind = result.kind ?? 'unknown';
    const entry = byKind[kind] ?? { sites: 0, captured: 0 };
    entry.sites += 1;
    if (result.capture.ok) entry.captured += 1;
    byKind[kind] = entry;
  }
  const stopReasons: Record<string, number> = {};
  for (const result of ok) increment(stopReasons, result.capture.timings.stopReason);
  const bannerByTool: Record<string, number> = {};
  const bannerTimes: number[] = [];
  for (const result of ok) {
    const banner = result.capture.consentBanner;
    if (!banner.detected) continue;
    increment(bannerByTool, banner.toolId ?? 'unknown');
    if (banner.visibleAtMs !== null) bannerTimes.push(banner.visibleAtMs);
  }
  const sitesByRiskClass = Object.fromEntries(RISK_CLASSES.map((rc) => [rc, 0])) as Record<RiskClass, number>;
  const serviceSites: Record<string, number> = {};
  let sitesWithFinding = 0;
  let sitesWithHintOnly = 0;
  let sitesWithUnknownThirdParty = 0;
  let sitesWithFindingBeforeBanner = 0;
  const googleFontsSites: string[] = [];
  for (const result of ok) {
    const analysis = result.analysis;
    if (analysis === null) continue;
    const findings = analysis.services.filter((s) => s.severity === 'finding');
    if (findings.length > 0) sitesWithFinding += 1;
    else if (analysis.services.some((s) => s.severity === 'hint')) sitesWithHintOnly += 1;
    if (findings.some((s) => s.startsBeforeBanner === true)) sitesWithFindingBeforeBanner += 1;
    if (analysis.services.some((s) => !s.known)) sitesWithUnknownThirdParty += 1;
    for (const riskClass of RISK_CLASSES) {
      const present = analysis.services.some(
        (s) => s.riskClass === riskClass && (s.severity === 'finding' || riskClass === 'grey-zone' || riskClass === 'not-flagged'),
      );
      if (present) sitesByRiskClass[riskClass] += 1;
    }
    for (const id of new Set(analysis.services.filter((s) => s.serviceId !== null).map((s) => s.serviceId as string))) {
      increment(serviceSites, id);
    }
    if (findings.some((s) => s.serviceId === 'google-fonts')) googleFontsSites.push(result.label);
  }
  return {
    sites: results.length,
    captured: ok.length,
    failures: results
      .filter((r) => !r.capture.ok)
      .map((r) => ({ label: r.label, reason: r.capture.failure?.reason ?? 'other', message: r.capture.failure?.message ?? '' })),
    byKind,
    retried: results.filter((r) => r.attempts > 1).length,
    captureMs: { median: median(ok.map((r) => r.capture.timings.endMs)), max: max(ok.map((r) => r.capture.timings.endMs)) },
    stopReasons,
    requestsPerPage: { median: median(ok.map((r) => r.capture.requests.length)), max: max(ok.map((r) => r.capture.requests.length)) },
    thirdPartyRequestsPerPage: {
      median: median(analyses.map((a) => a.counts.thirdPartyRequests)),
      max: max(analyses.map((a) => a.counts.thirdPartyRequests)),
    },
    banner: { detected: Object.values(bannerByTool).reduce((a, b) => a + b, 0), byTool: bannerByTool, medianVisibleAtMs: median(bannerTimes) },
    sitesWithFinding,
    sitesWithHintOnly,
    sitesByRiskClass,
    sitesWithUnknownThirdParty,
    sitesWithFindingBeforeBanner,
    serviceSites: Object.entries(serviceSites)
      .map(([serviceId, sites]) => ({ serviceId, sites }))
      .sort((a, b) => b.sites - a.sites || a.serviceId.localeCompare(b.serviceId)),
    googleFontsSites,
  };
}

function seconds(ms: number | null): string {
  return ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`;
}

/** Markdown with aggregated numbers and anonymous labels only. Safe to copy into committed docs. */
export function renderSummaryMarkdown(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`- Sites: ${summary.sites}. Captured: ${summary.captured}. Failed: ${summary.failures.length}. Retried once: ${summary.retried}.`);
  for (const failure of summary.failures) lines.push(`  - ${failure.label}: ${failure.reason} (${failure.message.slice(0, 120)})`);
  lines.push(
    `- By kind: ${Object.entries(summary.byKind)
      .map(([kind, v]) => `${kind} ${v.captured}/${v.sites}`)
      .join(', ')}.`,
  );
  lines.push(
    `- Capture time per page: median ${seconds(summary.captureMs.median)}, max ${seconds(summary.captureMs.max)}. Stop: ${Object.entries(summary.stopReasons)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}.`,
  );
  lines.push(
    `- Requests per page: median ${summary.requestsPerPage.median ?? 'n/a'}, max ${summary.requestsPerPage.max ?? 'n/a'}; third-party requests per page: median ${summary.thirdPartyRequestsPerPage.median ?? 'n/a'}, max ${summary.thirdPartyRequestsPerPage.max ?? 'n/a'}.`,
  );
  lines.push(
    `- Consent banner detected on ${summary.banner.detected} of ${summary.captured} captured sites (${Object.entries(summary.banner.byTool)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none'}); median time until visible ${seconds(summary.banner.medianVisibleAtMs)}.`,
  );
  lines.push(
    `- Sites with at least one finding: ${summary.sitesWithFinding}; with hints only: ${summary.sitesWithHintOnly}; with a finding that starts before the banner is visible: ${summary.sitesWithFindingBeforeBanner}.`,
  );
  lines.push(
    `- Sites per risk class: ${RISK_CLASSES.map((rc) => `${rc} ${summary.sitesByRiskClass[rc]}`).join(', ')}; with unknown third parties: ${summary.sitesWithUnknownThirdParty}.`,
  );
  lines.push(
    `- Most frequent services (sites): ${
      summary.serviceSites
        .slice(0, 15)
        .map((s) => `${s.serviceId} ${s.sites}`)
        .join(', ') || 'none'
    }.`,
  );
  lines.push(`- Google Fonts as a finding: ${summary.googleFontsSites.length} sites (${summary.googleFontsSites.join(', ') || 'none'}).`);
  return `${lines.join('\n')}\n`;
}
