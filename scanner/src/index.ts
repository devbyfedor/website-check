/**
 * Scan core of Website-Check DE.
 *
 * Everything exported from here runs both in Node (local runner, tests) and in a
 * Cloudflare Worker. The Playwright capture adapter is Node-only and is exported
 * separately from `@website-check/scanner/local`.
 */
export const SCANNER_VERSION = '0.1.0';

export * from './capture/types.ts';
export {
  almostEmptyReason,
  checkPageReason,
  classifyMainDocument,
  classifyNavigationError,
  interruptedFailure,
  notAllowedCapture,
  pageEvidenceOf,
  recheckCapture,
  type PageEvidence,
} from './capture/failure.ts';
export { frameUnknown } from './capture/frames.ts';
export { CAPTURE_LIMITS, cutText, cutUrl, limitAxe, limitBanner, limitCapture, limitHeaders, limitPageSnapshot, limitRequest, limitSnapshot, pageLimitFailure, RequestBudget, requestChars, type LimitedSnapshot } from './capture/limits.ts';
export { analyzeCapture, type CaptureAnalysis, type CaptureState } from './analyzers/capture.ts';
export * from './a11y/types.ts';
export { AXE_REPORTER, AXE_RUN_EXPRESSION, AXE_RUN_OPTIONS, AXE_TIME, axeBudgetMs, axeCaptureFrom, axeNotRun, type AxeRunOutput } from './a11y/axe-script.ts';
export { analyzeAccessibility, ACCESSIBILITY_ANALYSIS_VERSION, type A11yCheck, type A11yCheckId, type AccessibilityAnalysis } from './analyzers/accessibility.ts';
export * from './security/types.ts';
export { HTTP_PROBE_BODY_LIMIT, HTTP_PROBE_DEFAULTS, httpsVariantOf, httpVariantOf, probeHttpRedirect, probeHttps, type HttpProbeOptions } from './security/http-probe.ts';
export * from './security/address.ts';
export * from './security/ssrf.ts';
export { createDohResolver, DOH_ENDPOINT } from './security/doh.ts';
export { createFetchBudget, FETCH_BUDGET_ERROR, QUICK_CHECK_FETCHES, type FetchBudget } from './security/fetch-budget.ts';
export * from './security/navigation-guard.ts';
export {
  analyzeSecurity,
  checkCsp,
  checkHsts,
  checkPermissionsPolicy,
  checkReferrerPolicy,
  checkXcto,
  SECURITY_ANALYSIS_VERSION,
  SECURITY_HEADERS,
  type CheckResult,
  type HeaderCheck,
  type HeaderStatus,
  type SecurityAnalysis,
  type SecurityHeaderKey,
  type SecurityHeaderName,
} from './analyzers/security.ts';
export { CAPTURE_SETTINGS, chromeVersionOf, desktopChromeUserAgent, LONG_LIVED_RESOURCE_TYPES } from './capture/settings.ts';
export { lowerCaseHeaders, toInitiator, type CdpInitiator, type CdpStack } from './capture/cdp.ts';
export {
  IN_PAGE_COLLECT_EXPRESSION,
  RESOURCE_TIMING_GLOBAL,
  RESOURCE_TIMING_INIT_SCRIPT,
  RESOURCE_TIMING_POLL_EXPRESSION,
  SNAPSHOT_EXPRESSION,
  IMPRESSUM_SNAPSHOT_EXPRESSION,
  TEXT_PROGRESS_EXPRESSION,
  type TextProgress,
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
export { analyzeLegal, LEGAL_ANALYSIS_VERSION, type ImpressumState, type LegalAnalysis } from './analyzers/legal.ts';
export { analyzePlatform, PLATFORM_ANALYSIS_VERSION, type DetectedSystem, type PlatformAnalysis, type PlatformSignal } from './analyzers/platform.ts';
export * from './legal/fields.ts';
export * from './legal/links.ts';
export * from './legal/impressum-capture.ts';
export * from './platform/fingerprints.ts';
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
export * from './report/types.ts';
export { buildReport, type BuildReportOptions, type BuiltReport, type NetworkHostRow } from './report/build.ts';
export { compileSchema, REPORT_SCHEMA_V1, validateReport, type CompiledSchema, type SchemaError } from './report/validate.ts';
export { decodePunycodeLabel, displayHostOf, hostToUnicode, MAX_ADDRESS_INPUT, normalizeSiteAddress, type AddressError, type NormalizedAddress } from './report/site-address.ts';
export { decodeHtml, snapshotFromHtml } from './quick/html-snapshot.ts';
export { fetchFailure, QUICK_ADAPTER, quickCapture, type QuickCaptureOptions } from './quick/quick-capture.ts';
