import { recheckCapture } from '../capture/failure.ts';
import type { Capture, CaptureFailure } from '../capture/types.ts';
import type { CompiledRules } from '../rules/match.ts';
import { analyzeAccessibility, type AccessibilityAnalysis } from './accessibility.ts';
import { analyzeLegal, type LegalAnalysis } from './legal.ts';
import { analyzePlatform, type PlatformAnalysis } from './platform.ts';
import { analyzeSecurity, type SecurityAnalysis } from './security.ts';
import { analyzeThirdParty, type ThirdPartyAnalysis } from './third-party.ts';

/**
 * Entry point of the analysis: one capture in, the state of the check and the analyses out.
 *
 * A page that was not captured gives no findings at all. That matters most for blocked pages:
 * a web host's check page ("Einen Moment bitte …") has almost no requests, so analysing it would
 * look like a clean site. The report must say that the check was blocked instead (stage B2).
 * Captures saved before a classification rule existed are decided again (`recheckCapture`).
 */

export type CaptureState =
  /** The page loaded normally; the analyses below describe it. */
  | 'analyzed'
  /** The site refused the scan: bot protection, a check page, 401/403/429. */
  | 'blocked'
  /** Any other failure: timeout, invalid address, unreachable, HTTP error. */
  | 'failed';

export interface CaptureAnalysis {
  state: CaptureState;
  failure: CaptureFailure | null;
  /** Null unless the state is `analyzed`. */
  thirdParty: ThirdPartyAnalysis | null;
  /** Null unless the state is `analyzed`; `not-checked` inside when axe did not run. */
  accessibility: AccessibilityAnalysis | null;
  /** Null unless the state is `analyzed`. */
  security: SecurityAnalysis | null;
  /** Session A4: Impressum and Datenschutz links, Impressum fields, accessibility statement. Null unless `analyzed`. */
  legal: LegalAnalysis | null;
  /** Session A4: the system the site runs on. Null unless `analyzed`. */
  platform: PlatformAnalysis | null;
}

export function analyzeCapture(capture: Capture, rules: CompiledRules): CaptureAnalysis {
  const checked = recheckCapture(capture);
  if (!checked.ok) {
    const failure = checked.failure ?? { reason: 'other' as const, message: 'capture not ok' };
    return { state: failure.reason === 'blocked' ? 'blocked' : 'failed', failure, thirdParty: null, accessibility: null, security: null, legal: null, platform: null };
  }
  return {
    state: 'analyzed',
    failure: null,
    thirdParty: analyzeThirdParty(checked, rules),
    accessibility: analyzeAccessibility(checked),
    security: analyzeSecurity(checked),
    legal: analyzeLegal(checked),
    platform: analyzePlatform(checked),
  };
}
