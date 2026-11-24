import { analyzeAccessibility, type A11yCheckId } from '../analyzers/accessibility.ts';
import { analyzeLegal, type ImpressumState } from '../analyzers/legal.ts';
import { analyzePlatform } from '../analyzers/platform.ts';
import { IMPRESSUM_FIELDS, type ImpressumFieldId } from '../legal/fields.ts';
import { analyzeSecurity, SECURITY_HEADERS, type CheckResult, type SecurityHeaderKey } from '../analyzers/security.ts';
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
  /** Session A3: axe on the captured pages (captures without axe data count as not checked). */
  accessibility: {
    checked: number;
    notChecked: { label: string; reason: string }[];
    /** Per error type: sites with at least one violation, and violations per checked page. */
    byType: Record<A11yCheckId, { sites: number; median: number | null; max: number | null; total: number }>;
    sitesWithAnyViolation: number;
    sitesWithManualOnly: number;
    axeTotalMs: { median: number | null; max: number | null };
    axeRunMs: { median: number | null; max: number | null };
    axeInjectMs: { median: number | null; max: number | null };
  };
  /** Session A3: HTTPS, the http redirect check and the five headers. */
  security: {
    https: Record<'pass' | 'fail' | 'manual', number>;
    httpRedirect: Record<CheckResult, number>;
    probeOutcomes: Record<string, number>;
    probeMs: { median: number | null; max: number | null };
    headerPresent: Record<SecurityHeaderKey, number>;
    headerStatus: Record<SecurityHeaderKey, Record<string, number>>;
    headersPresentPerSite: { median: number | null; min: number | null; max: number | null };
  };
  /** Session A4: legal links, the Impressum tab, the fields, and the detected system. */
  legal: {
    /** `found` counts only certain links; `unsure`: an accessibility link that names only the topic (manual check). */
    links: Record<'impressum' | 'datenschutz' | 'accessibilityStatement', { found: number; unsure: number; footer: number; byHref: number }>;
    impressumStates: Partial<Record<ImpressumState, number>>;
    crossSite: number;
    /** Browser time of the Impressum tab (open to close), over the tabs that were opened. */
    impressumMs: { opened: number; median: number | null; max: number | null; mean: number | null };
    impressumStop: Record<string, number>;
    /** Fields found, over the Impressum texts that were searched. */
    fieldsFound: Record<ImpressumFieldId, number>;
    searched: number;
    courtMissing: number;
    emailForms: Record<string, number>;
    systems: Record<string, number>;
    woocommerce: number;
    conflicts: number;
  };
}

/** Free text from browsers and axe can name the site ("… at https://www.x.de/"): replace addresses and host names. */
export function redactText(text: string): string {
  return text
    .replace(/\b(?:https?|wss?):\/\/\S+/gi, '<url>')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:de|com|net|org|eu|info|biz|shop|store|online|bayern|io|at|ch|co|uk|app|dev|site|website)\b/gi, '<host>')
    .slice(0, 160);
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
      .map((r) => ({ label: r.label, reason: r.capture.failure?.reason ?? 'other', message: redactText(r.capture.failure?.message ?? '') })),
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
    accessibility: summarizeAccessibility(ok),
    security: summarizeSecurity(ok),
    legal: summarizeLegal(ok),
  };
}

const A11Y_TYPES: A11yCheckId[] = ['color-contrast', 'image-alt', 'label', 'link-name', 'button-name', 'page-language'];

function minimum(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function summarizeAccessibility(ok: readonly SiteRunResult[]): RunSummary['accessibility'] {
  const byType = Object.fromEntries(A11Y_TYPES.map((id) => [id, { sites: 0, median: null, max: null, total: 0 }])) as RunSummary['accessibility']['byType'];
  const perType: Record<string, number[]> = {};
  const notChecked: { label: string; reason: string }[] = [];
  let checked = 0;
  let sitesWithAnyViolation = 0;
  let sitesWithManualOnly = 0;
  const total: number[] = [];
  const run: number[] = [];
  const inject: number[] = [];
  for (const result of ok) {
    const axe = result.capture.axe ?? null;
    if (axe !== null) {
      total.push(axe.timing.totalMs);
      if (axe.timing.runMs !== null) run.push(axe.timing.runMs);
      if (axe.timing.injectMs !== null) inject.push(axe.timing.injectMs);
    }
    const analysis = analyzeAccessibility(result.capture);
    if (analysis.status !== 'checked') {
      notChecked.push({ label: result.label, reason: redactText(analysis.reason ?? 'unknown') });
      continue;
    }
    checked += 1;
    if (analysis.counts.failed > 0) sitesWithAnyViolation += 1;
    else if (analysis.counts.manual > 0) sitesWithManualOnly += 1;
    for (const check of analysis.checks) {
      (perType[check.id] ??= []).push(check.violations);
      const entry = byType[check.id];
      entry.total += check.violations;
      if (check.violations > 0) entry.sites += 1;
    }
  }
  for (const id of A11Y_TYPES) {
    byType[id].median = median(perType[id] ?? []);
    byType[id].max = max(perType[id] ?? []);
  }
  return {
    checked,
    notChecked,
    byType,
    sitesWithAnyViolation,
    sitesWithManualOnly,
    axeTotalMs: { median: median(total), max: max(total) },
    axeRunMs: { median: median(run), max: max(run) },
    axeInjectMs: { median: median(inject), max: max(inject) },
  };
}

function summarizeSecurity(ok: readonly SiteRunResult[]): RunSummary['security'] {
  const https: RunSummary['security']['https'] = { pass: 0, fail: 0, manual: 0 };
  const httpRedirect: Record<CheckResult, number> = { pass: 0, fail: 0, manual: 0, info: 0, 'not-checked': 0 };
  const probeOutcomes: Record<string, number> = {};
  const probeMs: number[] = [];
  const headerPresent = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, 0])) as Record<SecurityHeaderKey, number>;
  const headerStatus = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, {}])) as Record<SecurityHeaderKey, Record<string, number>>;
  const present: number[] = [];
  for (const result of ok) {
    const analysis = analyzeSecurity(result.capture);
    https[analysis.https.result] += 1;
    httpRedirect[analysis.httpRedirect.result] += 1;
    const probe = result.capture.httpProbe ?? null;
    increment(probeOutcomes, probe?.outcome ?? 'none');
    if (probe !== null) probeMs.push(probe.durationMs);
    for (const header of analysis.headers) {
      if (header.counts) headerPresent[header.key] += 1;
      increment(headerStatus[header.key], header.status);
    }
    present.push(analysis.headersPresent);
  }
  return {
    https,
    httpRedirect,
    probeOutcomes,
    probeMs: { median: median(probeMs), max: max(probeMs) },
    headerPresent,
    headerStatus,
    headersPresentPerSite: { median: median(present), min: minimum(present), max: max(present) },
  };
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function summarizeLegal(ok: readonly SiteRunResult[]): RunSummary['legal'] {
  const kinds = ['impressum', 'datenschutz', 'accessibilityStatement'] as const;
  const links = Object.fromEntries(kinds.map((k) => [k, { found: 0, unsure: 0, footer: 0, byHref: 0 }])) as RunSummary['legal']['links'];
  const impressumStates: Partial<Record<ImpressumState, number>> = {};
  const fieldsFound = Object.fromEntries(IMPRESSUM_FIELDS.map((f) => [f, 0])) as Record<ImpressumFieldId, number>;
  const emailForms: Record<string, number> = {};
  const systems: Record<string, number> = {};
  const impressumStop: Record<string, number> = {};
  const tabMs: number[] = [];
  let crossSite = 0;
  let searched = 0;
  let courtMissing = 0;
  let woocommerce = 0;
  let conflicts = 0;
  for (const result of ok) {
    const legal = analyzeLegal(result.capture);
    for (const kind of kinds) {
      const link = kind === 'accessibilityStatement' ? legal.accessibilityStatement : legal.links[kind];
      if (link === null) continue;
      if (!link.certain) {
        links[kind].unsure += 1;
        continue;
      }
      links[kind].found += 1;
      if (link.footer) links[kind].footer += 1;
      if (link.matchedBy === 'href') links[kind].byHref += 1;
    }
    impressumStates[legal.impressum.state] = (impressumStates[legal.impressum.state] ?? 0) + 1;
    if (legal.impressum.crossSite) crossSite += 1;
    const tab = result.capture.impressum ?? null;
    if (tab !== null) {
      tabMs.push(tab.timings.totalMs);
      increment(impressumStop, tab.timings.stopReason);
    }
    if (legal.impressum.state === 'analyzed' || legal.impressum.state === 'same-page') {
      searched += 1;
      for (const field of IMPRESSUM_FIELDS) if (legal.fields[field].status === 'found') fieldsFound[field] += 1;
      const register = legal.fields.handelsregister;
      if (register.status === 'found' && register.value.court === null) courtMissing += 1;
      const email = legal.fields.email;
      if (email.status === 'found') increment(emailForms, email.value.form);
    }
    const platform = analyzePlatform(result.capture);
    increment(systems, platform.system);
    if (platform.woocommerce) woocommerce += 1;
    if (platform.conflict) conflicts += 1;
  }
  return {
    links,
    impressumStates,
    crossSite,
    impressumMs: { opened: tabMs.length, median: median(tabMs), max: max(tabMs), mean: mean(tabMs) },
    impressumStop,
    fieldsFound,
    searched,
    courtMissing,
    emailForms,
    systems,
    woocommerce,
    conflicts,
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
  const a = summary.accessibility;
  lines.push(`- Accessibility (axe): checked on ${a.checked} of ${summary.captured} captured pages; at least one violation on ${a.sitesWithAnyViolation}; only undecided elements (manual check) on ${a.sitesWithManualOnly}.`);
  for (const n of a.notChecked) lines.push(`  - ${n.label}: not checked (${n.reason.slice(0, 120)})`);
  lines.push(
    `- Violations per error type (sites with any; per checked page median / max; total): ${A11Y_TYPES.map((id) => `${id} ${a.byType[id].sites} sites, ${a.byType[id].median ?? 'n/a'} / ${a.byType[id].max ?? 'n/a'}, ${a.byType[id].total}`).join('; ')}.`,
  );
  lines.push(
    `- Time for axe per page: median ${seconds(a.axeTotalMs.median)}, max ${seconds(a.axeTotalMs.max)} (injection median ${a.axeInjectMs.median ?? 'n/a'} ms, axe.run median ${a.axeRunMs.median ?? 'n/a'} ms, max ${a.axeRunMs.max ?? 'n/a'} ms).`,
  );
  const sec = summary.security;
  lines.push(`- HTTPS: pass ${sec.https.pass}, fail ${sec.https.fail}, manual ${sec.https.manual}. Redirect http to https: ${Object.entries(sec.httpRedirect).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ')} (probe outcomes: ${Object.entries(sec.probeOutcomes).map(([k, v]) => `${k} ${v}`).join(', ')}; probe time median ${sec.probeMs.median ?? 'n/a'} ms, max ${sec.probeMs.max ?? 'n/a'} ms).`);
  lines.push(
    `- Security headers present (of ${summary.captured} sites): ${SECURITY_HEADERS.map((h) => `${h.key} ${sec.headerPresent[h.key]}`).join(', ')}; per site median ${sec.headersPresentPerSite.median ?? 'n/a'} of 5, min ${sec.headersPresentPerSite.min ?? 'n/a'}, max ${sec.headersPresentPerSite.max ?? 'n/a'}.`,
  );
  lines.push(
    `- Header states: ${SECURITY_HEADERS.map((h) => `${h.key} (${Object.entries(sec.headerStatus[h.key]).map(([k, v]) => `${k} ${v}`).join(', ')})`).join('; ')}.`,
  );
  const l = summary.legal;
  const linkLine = (k: keyof typeof l.links): string => `${l.links[k].found} (footer ${l.links[k].footer}, by address only ${l.links[k].byHref}${k === 'datenschutz' && l.links[k].unsure > 0 ? `, not certain ${l.links[k].unsure}` : ''})`;
  lines.push(`- Links on the homepage (of ${summary.captured}): Impressum ${linkLine('impressum')}, Datenschutz ${linkLine('datenschutz')}, Erklärung zur Barrierefreiheit ${linkLine('accessibilityStatement')}, plus ${l.links.accessibilityStatement.unsure} links that name only the topic (manual check) (homepage or Impressum page).`);
  lines.push(`- Impressum: ${Object.entries(l.impressumStates).map(([k, v]) => `${k} ${v}`).join(', ')}; on another site: ${l.crossSite}. Second tab opened ${l.impressumMs.opened} times, browser time per tab median ${seconds(l.impressumMs.median)}, mean ${seconds(l.impressumMs.mean)}, max ${seconds(l.impressumMs.max)} (stop: ${Object.entries(l.impressumStop).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}).`);
  lines.push(`- Impressum fields found (of ${l.searched} texts searched): address ${l.fieldsFound.address}, e-mail ${l.fieldsFound.email} (${Object.entries(l.emailForms).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), Handelsregister ${l.fieldsFound.handelsregister} (without court ${l.courtMissing}), USt-IdNr ${l.fieldsFound.ustId}.`);
  lines.push(`- System: ${Object.entries(l.systems).map(([k, v]) => `${k} ${v}`).join(', ')}; WooCommerce ${l.woocommerce}; strong signals of two systems ${l.conflicts}.`);
  return `${lines.join('\n')}\n`;
}
