import type { AxeCapture, AxeContrast, AxeExample, AxeRuleId, AxeRuleResult } from '../a11y/types.ts';
import type { Capture } from '../capture/types.ts';

/**
 * Accessibility analysis (session A3): the six error types of the brief from the axe part of
 * the capture. A pure function, tested without a browser.
 *
 * A type is `fail` when axe reports at least one violation, `manual` when axe found none but could
 * not decide for some elements ("bitte manuell prüfen", for example text over a background image),
 * and `pass` otherwise. Undecided elements are reported in `manual` next to violations too.
 * A type whose axe rule threw is `not-checked` (axe drops that rule's results). When axe did not
 * run, or the page's content sits in a frameset or one large iframe (frames are not checked),
 * nothing is claimed: the whole analysis is `not-checked`.
 */

export const ACCESSIBILITY_ANALYSIS_VERSION = 2;

export type A11yCheckId = 'color-contrast' | 'image-alt' | 'label' | 'link-name' | 'button-name' | 'page-language';

export interface A11yCheck {
  id: A11yCheckId;
  /** axe rules behind this error type (page language has two). */
  rules: AxeRuleId[];
  result: 'pass' | 'fail' | 'manual' | 'not-checked';
  violations: number;
  incomplete: number;
  passes: number;
  /** Id of the draft text in `docs/content-drafts.md`; null for a pass. */
  textId: string | null;
  /** Up to five examples of the violations (or of the undecided elements for `manual`). */
  examples: AxeExample[];
  /** Undecided elements ("bitte manuell prüfen"), also next to violations; null if there are none or the type is not checked. */
  manual: { count: number; textId: 'a11y-manual-check' | 'a11y-manual-check-contrast'; examples: AxeExample[] } | null;
}

export interface AccessibilityAnalysis {
  version: typeof ACCESSIBILITY_ANALYSIS_VERSION;
  status: 'checked' | 'not-checked';
  /** Why axe did not run (`not-checked` only). */
  reason: string | null;
  checks: A11yCheck[];
  /** `manual`: types with undecided elements and no violation; `withManual`: types with any undecided element. */
  counts: { failed: number; manual: number; withManual: number; notChecked: number; violations: number };
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

/** Below this many checked nodes of the content rules, a page that is mostly one iframe was not really checked. */
const FRAME_PAGE_MAX_NODES = 2;
const FRAME_PAGE_MIN_SHARE = 0.8;

function manualTextId(id: A11yCheckId): 'a11y-manual-check' | 'a11y-manual-check-contrast' {
  return id === 'color-contrast' ? 'a11y-manual-check-contrast' : 'a11y-manual-check';
}

function textIdOf(id: A11yCheckId, result: A11yCheck['result'], axe: AxeCapture): string | null {
  if (result === 'pass') return null;
  if (result === 'not-checked') return 'a11y-check-not-checked';
  if (result === 'manual') return manualTextId(id);
  if (id !== 'page-language') return `a11y-${id}`;
  return (axe.rules['html-has-lang']?.violations ?? 0) > 0 ? 'a11y-html-has-lang' : 'a11y-html-lang-valid';
}

function notChecked(reason: string): AccessibilityAnalysis {
  return {
    version: ACCESSIBILITY_ANALYSIS_VERSION,
    status: 'not-checked',
    reason,
    checks: [],
    counts: { failed: 0, manual: 0, withManual: 0, notChecked: 0, violations: 0 },
    images: null,
    lowestContrast: null,
    invalidLang: null,
  };
}

/** The content sits in frames that axe does not check: a frameset, or one iframe over most of the window with almost nothing else. */
function contentInFrames(axe: AxeCapture): boolean {
  const scope = axe.scope ?? null;
  if (scope === null) return false;
  if (scope.frameset) return true;
  if (scope.largestFrameShare < FRAME_PAGE_MIN_SHARE) return false;
  const contentRules: AxeRuleId[] = ['color-contrast', 'image-alt', 'label', 'link-name', 'button-name'];
  const nodes = contentRules.reduce((total, id) => {
    const r = axe.rules[id];
    return total + (r === undefined ? 0 : r.violations + r.incomplete + r.passes);
  }, 0);
  return nodes <= FRAME_PAGE_MAX_NODES;
}

export function analyzeAccessibility(capture: Capture): AccessibilityAnalysis {
  const axe = capture.axe ?? null;
  if (axe === null) return notChecked('no accessibility data in this capture');
  if (axe.status !== 'ok') return notChecked(`${axe.status}: ${axe.error ?? 'unknown'}`);
  if (contentInFrames(axe)) return notChecked('content in frames: the page shows its content in a frameset or one large iframe, which is not checked');
  const errored = new Set(axe.ruleErrors);
  const checks: A11yCheck[] = TYPES.map(({ id, rules }) => {
    const results = rules.map((rule) => axe.rules[rule]).filter((r): r is AxeRuleResult => r !== undefined);
    const violations = sum(results, 'violations');
    const incomplete = sum(results, 'incomplete');
    const passes = sum(results, 'passes');
    if (rules.some((rule) => errored.has(rule))) {
      // axe replaced the rule's whole result with one error node: nothing is known about this type.
      return { id, rules, result: 'not-checked', violations: 0, incomplete: 0, passes: 0, textId: textIdOf(id, 'not-checked', axe), examples: [], manual: null };
    }
    const result: A11yCheck['result'] = violations > 0 ? 'fail' : incomplete > 0 ? 'manual' : 'pass';
    const examples = result === 'fail' ? results.flatMap((r) => r.examples) : result === 'manual' ? results.flatMap((r) => r.incompleteExamples) : [];
    const manual = incomplete > 0 ? { count: incomplete, textId: manualTextId(id), examples: results.flatMap((r) => r.incompleteExamples).slice(0, 5) } : null;
    return { id, rules, result, violations, incomplete, passes, textId: textIdOf(id, result, axe), examples: examples.slice(0, 5), manual };
  });
  const image = errored.has('image-alt') ? undefined : axe.rules['image-alt'];
  const lowest = errored.has('color-contrast') ? null : axe.lowestContrast.violation !== null ? { ...axe.lowestContrast.violation, result: 'fail' as const } : axe.lowestContrast.pass !== null ? { ...axe.lowestContrast.pass, result: 'pass' as const } : null;
  const langInvalid = !errored.has('html-lang-valid') && (axe.rules['html-lang-valid']?.violations ?? 0) > 0;
  return {
    version: ACCESSIBILITY_ANALYSIS_VERSION,
    status: 'checked',
    reason: null,
    checks,
    counts: {
      failed: checks.filter((c) => c.result === 'fail').length,
      manual: checks.filter((c) => c.result === 'manual').length,
      withManual: checks.filter((c) => c.manual !== null).length,
      notChecked: checks.filter((c) => c.result === 'not-checked').length,
      violations: checks.reduce((total, c) => total + c.violations, 0),
    },
    images: image === undefined ? null : { total: image.passes + image.violations + image.incomplete, withDescription: image.passes },
    lowestContrast: lowest,
    invalidLang: langInvalid ? (capture.page?.lang ?? null) : null,
  };
}
