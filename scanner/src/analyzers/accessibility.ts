import type { AxeCapture, AxeContrast, AxeExample, AxeRuleId, AxeRuleResult } from '../a11y/types.ts';
import type { Capture } from '../capture/types.ts';

/**
 * Accessibility analysis (session A3): the six error types of the brief from the axe part of
 * the capture. A pure function, tested without a browser.
 *
 * A type is `fail` when axe reports at least one violation, `manual` when axe could not decide
 * for some elements ("bitte manuell prüfen", for example text over a background image), and
 * `pass` otherwise. When axe did not run, nothing is claimed: the analysis is `not-checked`.
 */

export const ACCESSIBILITY_ANALYSIS_VERSION = 1;

export type A11yCheckId = 'color-contrast' | 'image-alt' | 'label' | 'link-name' | 'button-name' | 'page-language';

export interface A11yCheck {
  id: A11yCheckId;
  /** axe rules behind this error type (page language has two). */
  rules: AxeRuleId[];
  result: 'pass' | 'fail' | 'manual';
  violations: number;
  incomplete: number;
  passes: number;
  /** Id of the draft text in `docs/content-drafts.md`; null for a pass. */
  textId: string | null;
  /** Up to five examples of the violations (or of the undecided elements for `manual`). */
  examples: AxeExample[];
}

export interface AccessibilityAnalysis {
  version: typeof ACCESSIBILITY_ANALYSIS_VERSION;
  status: 'checked' | 'not-checked';
  /** Why axe did not run (`not-checked` only). */
  reason: string | null;
  checks: A11yCheck[];
  counts: { failed: number; manual: number; violations: number };
  /** Images checked by `image-alt`: "Bilder mit Beschreibung {withDescription} von {total}". */
  images: { total: number; withDescription: number } | null;
  /** "Kleinster Textkontrast": the lowest failing element, otherwise the lowest passing one. */
  lowestContrast: (AxeContrast & { result: 'fail' | 'pass' }) | null;
  /** Value of `<html lang>` when the language is invalid, for the text. */
  invalidLang: string | null;
}

const TYPES: { id: A11yCheckId; rules: AxeRuleId[] }[] = [
  { id: 'color-contrast', rules: ['color-contrast'] },
  { id: 'image-alt', rules: ['image-alt'] },
  { id: 'label', rules: ['label'] },
  { id: 'link-name', rules: ['link-name'] },
  { id: 'button-name', rules: ['button-name'] },
  { id: 'page-language', rules: ['html-has-lang', 'html-lang-valid'] },
];

function sum(rules: AxeRuleResult[], key: 'violations' | 'incomplete' | 'passes'): number {
  return rules.reduce((total, rule) => total + rule[key], 0);
}

function textIdOf(id: A11yCheckId, result: A11yCheck['result'], axe: AxeCapture): string | null {
  if (result === 'pass') return null;
  if (result === 'manual') return id === 'color-contrast' ? 'a11y-manual-check-contrast' : 'a11y-manual-check';
  if (id !== 'page-language') return `a11y-${id}`;
  return (axe.rules['html-has-lang']?.violations ?? 0) > 0 ? 'a11y-html-has-lang' : 'a11y-html-lang-valid';
}

export function analyzeAccessibility(capture: Capture): AccessibilityAnalysis {
  const axe = capture.axe ?? null;
  if (axe === null || axe.status !== 'ok') {
    return {
      version: ACCESSIBILITY_ANALYSIS_VERSION,
      status: 'not-checked',
      reason: axe === null ? 'no accessibility data in this capture' : `${axe.status}: ${axe.error ?? 'unknown'}`,
      checks: [],
      counts: { failed: 0, manual: 0, violations: 0 },
      images: null,
      lowestContrast: null,
      invalidLang: null,
    };
  }
  const checks: A11yCheck[] = TYPES.map(({ id, rules }) => {
    const results = rules.map((rule) => axe.rules[rule]).filter((r): r is AxeRuleResult => r !== undefined);
    const violations = sum(results, 'violations');
    const incomplete = sum(results, 'incomplete');
    const result: A11yCheck['result'] = violations > 0 ? 'fail' : incomplete > 0 ? 'manual' : 'pass';
    const examples = result === 'fail' ? results.flatMap((r) => r.examples) : result === 'manual' ? results.flatMap((r) => r.incompleteExamples) : [];
    return { id, rules, result, violations, incomplete, passes: sum(results, 'passes'), textId: textIdOf(id, result, axe), examples: examples.slice(0, 5) };
  });
  const image = axe.rules['image-alt'];
  const lowest = axe.lowestContrast.violation !== null ? { ...axe.lowestContrast.violation, result: 'fail' as const } : axe.lowestContrast.pass !== null ? { ...axe.lowestContrast.pass, result: 'pass' as const } : null;
  const langInvalid = (axe.rules['html-lang-valid']?.violations ?? 0) > 0;
  return {
    version: ACCESSIBILITY_ANALYSIS_VERSION,
    status: 'checked',
    reason: null,
    checks,
    counts: {
      failed: checks.filter((c) => c.result === 'fail').length,
      manual: checks.filter((c) => c.result === 'manual').length,
      violations: checks.reduce((total, c) => total + c.violations, 0),
    },
    images: image === undefined ? null : { total: image.passes + image.violations + image.incomplete, withDescription: image.passes },
    lowestContrast: lowest,
    invalidLang: langInvalid ? (capture.page?.lang ?? null) : null,
  };
}
