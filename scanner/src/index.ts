/**
 * Scan core of Website-Check DE.
 *
 * Everything exported from here runs both in Node (local runner, tests) and in a
 * Cloudflare Worker. The Playwright capture adapter is Node-only and is exported
 * separately from `@website-check/scanner/local`.
 */
export const SCANNER_VERSION = '0.1.0';

export * from './capture/types.ts';
export { classifyMainDocument, classifyNavigationError } from './capture/failure.ts';
export { firstPartySites, hostOf, isIpAddress, normalizeHost, siteOfHost, siteOfUrl } from './domain/site.ts';
export * from './rules/types.ts';
export { compileRules, parseHostPattern, parseRulesFile, type CompiledRules, type HostPattern, type RuleMatch } from './rules/match.ts';
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
