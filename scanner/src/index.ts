/**
 * Scan core of Website-Check DE.
 *
 * Everything exported from here runs both in Node (local runner, tests) and in a
 * Cloudflare Worker. The Playwright capture adapter is Node-only and is exported
 * separately from `@website-check/scanner/local`.
 */
export const SCANNER_VERSION = '0.1.0';

export * from './capture/types.ts';
export { checkPageReason, classifyMainDocument, classifyNavigationError, pageEvidenceOf, recheckCapture, type PageEvidence } from './capture/failure.ts';
export { analyzeCapture, type CaptureAnalysis, type CaptureState } from './analyzers/capture.ts';
export { CAPTURE_SETTINGS, chromeVersionOf, desktopChromeUserAgent, LONG_LIVED_RESOURCE_TYPES } from './capture/settings.ts';
export { lowerCaseHeaders, toInitiator, type CdpInitiator, type CdpStack } from './capture/cdp.ts';
export {
  IN_PAGE_COLLECT_EXPRESSION,
  RESOURCE_TIMING_GLOBAL,
  RESOURCE_TIMING_INIT_SCRIPT,
  RESOURCE_TIMING_POLL_EXPRESSION,
  SNAPSHOT_EXPRESSION,
  type InPageCollectResult,
  type ResourceTimingPoll,
  type SnapshotResult,
} from './capture/page-scripts.ts';
export {
  requestsFromResourceTiming,
  resourceTypeOf,
  type DocumentResponse,
  type NavigationTimingEntry,
  type ResourceTimingData,
  type ResourceTimingEntry,
} from './capture/resource-timing.ts';
export { firstPartySites, hostOf, isIpAddress, normalizeHost, siteOfHost, siteOfUrl } from './domain/site.ts';
export { googleCanonicalHost, parseGoogleDomainsFile, type GoogleDomainsFile } from './domain/google.ts';
export * from './rules/types.ts';
export { compileRules, parseHostPattern, parseRulesFile, type CompileOptions, type CompiledRules, type HostPattern, type RuleMatch } from './rules/match.ts';
export * from './consent/tools.ts';
export { BANNER_PROBE_GLOBAL, buildBannerProbeScript, type BannerProbeState } from './consent/probe-script.ts';
export {
  analyzeThirdParty,
  THIRD_PARTY_ANALYSIS_VERSION,
  type DetectedService,
  type ThirdPartyAnalysis,
  type ThirdPartyEvidence,
  type Via,
} from './analyzers/third-party.ts';
export { CONSENT_TOOLS_FILE, DEFAULT_CONSENT_TOOLS, DEFAULT_RULES, RULES_FILE } from './data.ts';
