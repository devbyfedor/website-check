import { describe, expect, it } from 'vitest';
import { analyzeAccessibility } from '../src/analyzers/accessibility.ts';
import { AXE_RULES, type AxeCapture, type AxeRuleId, type AxeRuleResult } from '../src/a11y/types.ts';
import { makeCapture } from './helpers.ts';

const rule = (input: Partial<AxeRuleResult> = {}): AxeRuleResult => ({ violations: 0, incomplete: 0, passes: 1, impact: null, examples: [], incompleteExamples: [], ...input });

function axe(rules: Partial<Record<AxeRuleId, Partial<AxeRuleResult>>>, extra: Partial<AxeCapture> = {}): AxeCapture {
  return {
    status: 'ok',
    error: null,
    axeVersion: '4.14.1',
    rules: Object.fromEntries(AXE_RULES.map((id) => [id, rule(rules[id])])),
    ruleErrors: [],
    lowestContrast: { violation: null, pass: null },
    timing: { injectMs: 50, runMs: 200, totalMs: 260 },
    ...extra,
  };
}

const example = { target: ['p'], html: '<p>', contrast: null };

describe('analyzeAccessibility', () => {
  it('maps the seven rules to the six error types of the brief', () => {
    const result = analyzeAccessibility(makeCapture({ requests: [], axe: axe({}) }));
    expect(result.status).toBe('checked');
    expect(result.checks.map((c) => [c.id, c.rules])).toEqual([
      ['color-contrast', ['color-contrast']],
      ['image-alt', ['image-alt']],
      ['label', ['label']],
      ['link-name', ['link-name']],
      ['button-name', ['button-name']],
      ['page-language', ['html-has-lang', 'html-lang-valid']],
    ]);
    expect(result.checks.every((c) => c.result === 'pass' && c.textId === null)).toBe(true);
    expect(result.counts).toEqual({ failed: 0, manual: 0, violations: 0 });
  });

  it('a violation is a fail with its text and examples; undecided elements are a manual check', () => {
    const capture = makeCapture({
      requests: [],
      axe: axe({
        'color-contrast': { violations: 14, incomplete: 3, examples: [example], incompleteExamples: [example, example] },
        'image-alt': { violations: 5, passes: 12, incomplete: 0 },
        label: { incomplete: 2, incompleteExamples: [example] },
        'button-name': { violations: 0 },
      }),
    });
    const result = analyzeAccessibility(capture);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId['color-contrast']).toMatchObject({ result: 'fail', violations: 14, incomplete: 3, textId: 'a11y-color-contrast', examples: [example] });
    expect(byId['image-alt']).toMatchObject({ result: 'fail', textId: 'a11y-image-alt' });
    expect(byId['label']).toMatchObject({ result: 'manual', textId: 'a11y-manual-check', examples: [example] });
    expect(result.counts).toEqual({ failed: 2, manual: 1, violations: 19 });
    expect(result.images).toEqual({ total: 17, withDescription: 12 });
  });

  it('undecided contrast gets its own manual-check text', () => {
    const result = analyzeAccessibility(makeCapture({ requests: [], axe: axe({ 'color-contrast': { incomplete: 4, incompleteExamples: [example] } }) }));
    expect(result.checks[0]).toMatchObject({ id: 'color-contrast', result: 'manual', textId: 'a11y-manual-check-contrast', examples: [example] });
  });

  it('names the page-language text by the rule that failed', () => {
    const missing = analyzeAccessibility(makeCapture({ requests: [], axe: axe({ 'html-has-lang': { violations: 1, passes: 0 } }) }));
    expect(missing.checks.at(-1)).toMatchObject({ id: 'page-language', result: 'fail', textId: 'a11y-html-has-lang' });
    expect(missing.invalidLang).toBeNull();
    const invalid = analyzeAccessibility(
      makeCapture({ requests: [], page: { title: '', lang: 'deutsch', text: '', textTruncated: false, links: [], linksTruncated: false }, axe: axe({ 'html-lang-valid': { violations: 1, passes: 0 } }) }),
    );
    expect(invalid.checks.at(-1)).toMatchObject({ result: 'fail', textId: 'a11y-html-lang-valid' });
    expect(invalid.invalidLang).toBe('deutsch');
  });

  it('reports the lowest failing contrast, otherwise the lowest passing one', () => {
    const low = { ratio: 2.9, expected: '4.5:1', fgColor: '#999', bgColor: '#fff', fontSize: null, fontWeight: null, messageKey: null };
    const ok = { ...low, ratio: 4.6 };
    expect(analyzeAccessibility(makeCapture({ requests: [], axe: axe({}, { lowestContrast: { violation: low, pass: ok } }) })).lowestContrast).toMatchObject({ ratio: 2.9, result: 'fail' });
    expect(analyzeAccessibility(makeCapture({ requests: [], axe: axe({}, { lowestContrast: { violation: null, pass: ok } }) })).lowestContrast).toMatchObject({ ratio: 4.6, result: 'pass' });
  });

  it('claims nothing when axe did not run', () => {
    for (const status of ['error', 'timeout', 'skipped'] as const) {
      const result = analyzeAccessibility(makeCapture({ requests: [], axe: { ...axe({}), status, error: 'x', rules: {} } }));
      expect(result).toMatchObject({ status: 'not-checked', checks: [], images: null, reason: `${status}: x` });
    }
    expect(analyzeAccessibility(makeCapture({ requests: [] })).status).toBe('not-checked');
  });
});
