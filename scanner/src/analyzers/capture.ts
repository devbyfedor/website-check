import { almostEmptyReason, pageEvidenceOf, recheckCapture } from '../capture/failure.ts';
import { limitCapture } from '../capture/limits.ts';
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
  /**
   * Session fix-a1: set when the analysed page shows almost nothing (the sizes of a check page) and has
   * no link to an Impressum or a Datenschutzerklärung: it may be a page of bot protection that no rule
   * names. The sizes, for the log. The report then claims nothing from what the page lacks.
   */
  almostEmpty: string | null;
  /**
   * Session fix-a4: analyses that threw. Each is null above and its part of the report is "nicht geprüft";
   * the other parts stand. The text of the error, for the log. Missing when none threw.
   */
  errors?: Partial<Record<AnalysisPart, string>>;
}

export type AnalysisPart = 'thirdParty' | 'accessibility' | 'security' | 'legal' | 'platform';

function almostEmptyOf(capture: Capture, legal: LegalAnalysis): string | null {
  const evidence = pageEvidenceOf(capture.page, capture.requests.length);
  if (evidence === undefined || legal.links.impressum !== null || legal.links.datenschutz !== null) return null;
  return almostEmptyReason(evidence);
}

export function analyzeCapture(capture: Capture, rules: CompiledRules): CaptureAnalysis {
  // Session fix-a4: whatever adapter made the capture, and whenever, it is analysed within the limits.
  const checked = recheckCapture(limitCapture(capture));
  if (!checked.ok) {
    const failure = checked.failure ?? { reason: 'other' as const, message: 'capture not ok' };
    return { state: failure.reason === 'blocked' ? 'blocked' : 'failed', failure, thirdParty: null, accessibility: null, security: null, legal: null, platform: null, almostEmpty: null };
  }
  // One analysis that throws does not end the scan: its part is not checked, the others stand (review finding 51).
  const errors: Partial<Record<AnalysisPart, string>> = {};
  const run = <T>(part: AnalysisPart, work: () => T): T | null => {
    try {
      return work();
    } catch (error) {
      errors[part] = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200);
      return null;
    }
  };
  const legal = run('legal', () => analyzeLegal(checked));
  const analysis: CaptureAnalysis = {
    state: 'analyzed',
    failure: null,
    thirdParty: run('thirdParty', () => analyzeThirdParty(checked, rules)),
    accessibility: run('accessibility', () => analyzeAccessibility(checked)),
    security: run('security', () => analyzeSecurity(checked)),
    legal,
    platform: run('platform', () => analyzePlatform(checked)),
    almostEmpty: legal === null ? null : almostEmptyOf(checked, legal),
  };
  if (Object.keys(errors).length > 0) analysis.errors = errors;
  return analysis;
}
