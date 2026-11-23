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
    expect(result.counts).toEqual({ failed: 0, manual: 0, withManual: 0, notChecked: 0, violations: 0 });
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
    // Undecided elements are kept next to the violations.
    expect(byId['color-contrast']?.manual).toEqual({ count: 3, textId: 'a11y-manual-check-contrast', examples: [example, example] });
    expect(byId['image-alt']?.manual).toBeNull();
    expect(byId['image-alt']).toMatchObject({ result: 'fail', textId: 'a11y-image-alt' });
    expect(byId['label']).toMatchObject({ result: 'manual', textId: 'a11y-manual-check', examples: [example], manual: { count: 2, textId: 'a11y-manual-check' } });
    expect(result.counts).toEqual({ failed: 2, manual: 1, withManual: 2, notChecked: 0, violations: 19 });
    // A capture that does not say how the passing images split (made before session fix-a2): no count.
    expect(result.images).toEqual({ total: null, described: null, decorative: null, without: 5, undecided: 0, passes: 12 });
  });

  // Session fix-a2, review finding 20: an image with alt="" or a presentation role passes the axe rule
  // without a description, so it is not counted as an image with a description.
  it('counts only images with a text alternative as described; images marked as decoration are apart', () => {
    const imagesOf = (rule: Partial<AxeRuleResult>, images?: AxeCapture['images']) => analyzeAccessibility(makeCapture({ requests: [], axe: axe({ 'image-alt': rule }, images === undefined ? {} : { images }) })).images;
    // The review's page: 8 images with a text, 4 with alt="", 5 without alt.
    expect(imagesOf({ violations: 5, passes: 12 }, { described: 8, decorative: 4 })).toEqual({ total: 13, described: 8, decorative: 4, without: 5, undecided: 0, passes: 12 });
    // Three images a CMS printed with alt="": no description at all.
    expect(imagesOf({ passes: 3 }, { described: 0, decorative: 3 })).toMatchObject({ total: 0, described: 0, decorative: 3 });
    expect(imagesOf({ passes: 3, incomplete: 1 }, { described: 3, decorative: 0 })).toMatchObject({ total: 4, described: 3, decorative: 0, undecided: 1 });
    // No image passes: nothing to split, also in an older capture.
    expect(imagesOf({ passes: 0, violations: 2 })).toMatchObject({ total: 2, described: 0, decorative: 0 });
    // A split that does not add up to the passes is not believed.
    expect(imagesOf({ passes: 3 }, { described: 3, decorative: 3 })).toMatchObject({ total: null, described: null, decorative: null, passes: 3 });
    expect(imagesOf({ passes: 3 }, null)).toMatchObject({ total: null, described: null });
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

  it('a rule that threw inside axe makes its error type not checked, not one undecided place', () => {
    const result = analyzeAccessibility(makeCapture({ requests: [], axe: axe({ label: { incomplete: 1, incompleteExamples: [example] } }, { ruleErrors: ['label'] }) }));
    const label = result.checks.find((c) => c.id === 'label');
    expect(label).toMatchObject({ result: 'not-checked', textId: 'a11y-check-not-checked', examples: [], manual: null, incomplete: 0 });
    expect(result.counts).toMatchObject({ notChecked: 1, manual: 0, withManual: 0 });
  });

  it('a page whose content is in a frameset or one large iframe is not checked', () => {
    const frameset = analyzeAccessibility(makeCapture({ requests: [], axe: axe({}, { scope: { frameset: true, frames: 2, largestFrameShare: 0 } }) }));
    expect(frameset).toMatchObject({ status: 'not-checked', checks: [] });
    expect(frameset.reason).toMatch(/^content in frames/);
    const empty = Object.fromEntries(['color-contrast', 'image-alt', 'label', 'link-name', 'button-name'].map((id) => [id, { passes: 0 }]));
    const wrapper = analyzeAccessibility(makeCapture({ requests: [], axe: axe(empty, { scope: { frameset: false, frames: 1, largestFrameShare: 0.97 } }) }));
    expect(wrapper.status).toBe('not-checked');
    // A large map or video next to the page's own content is fine.
    const map = analyzeAccessibility(makeCapture({ requests: [], axe: axe({ 'color-contrast': { passes: 40 } }, { scope: { frameset: false, frames: 1, largestFrameShare: 0.9 } }) }));
    expect(map.status).toBe('checked');
  });

  it('claims nothing when axe did not run', () => {
    for (const status of ['error', 'timeout', 'skipped'] as const) {
      const result = analyzeAccessibility(makeCapture({ requests: [], axe: { ...axe({}), status, error: 'x', rules: {} } }));
      expect(result).toMatchObject({ status: 'not-checked', checks: [], images: null, reason: `${status}: x` });
    }
    expect(analyzeAccessibility(makeCapture({ requests: [] })).status).toBe('not-checked');
  });
});
