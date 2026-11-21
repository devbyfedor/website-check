import { describe, expect, it } from 'vitest';
import { AXE_REPORTER, AXE_RUN_EXPRESSION, AXE_TIME, axeBudgetMs, axeCaptureFrom, axeNotRun } from '../src/a11y/axe-script.ts';
import { AXE_RULES } from '../src/a11y/types.ts';

/**
 * The in-page script runs here against a fake `window.axe` that behaves like axe-core's API:
 * `addReporter`, `run` with a custom reporter, and `utils.aggregateResult` (same grouping as
 * axe-core 4.14: a rule result goes into every group that has nodes). The real axe-core runs
 * on the fixture pages in the integration test.
 */

interface FakeNode {
  node: { selector: unknown; source: string };
  any?: unknown[];
  all?: unknown[];
  none?: unknown[];
}

interface FakeRule {
  id: string;
  impact?: string | null;
  error?: unknown;
  passes?: FakeNode[];
  violations?: FakeNode[];
  incomplete?: FakeNode[];
  inapplicable?: FakeNode[];
}

const GROUPS = ['passes', 'violations', 'incomplete', 'inapplicable'] as const;

function aggregateResult(results: FakeRule[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = { passes: [], violations: [], incomplete: [], inapplicable: [] };
  for (const rule of results) {
    for (const group of GROUPS) {
      const nodes = rule[group];
      if (Array.isArray(nodes) && nodes.length > 0) {
        const copy: Record<string, unknown> = { ...rule, nodes: [...nodes] };
        for (const g of GROUPS) delete copy[g];
        out[group]?.push(copy);
      }
    }
  }
  return out;
}

function fakeAxe(raw: FakeRule[], overrides: Record<string, unknown> = {}) {
  const reporters = new Map<string, (r: unknown, o: unknown, cb: (v: unknown) => void) => void>();
  const calls: unknown[] = [];
  const axe = {
    version: '4.14.1',
    utils: { aggregateResult },
    addReporter(name: string, fn: (r: unknown, o: unknown, cb: (v: unknown) => void) => void) {
      reporters.set(name, fn);
    },
    run(context: unknown, options: { reporter: string }) {
      calls.push({ context, options });
      return new Promise((resolve) => reporters.get(options.reporter)?.(raw, options, resolve));
    },
    ...overrides,
  };
  return { axe, calls };
}

async function runInPage(axe: unknown): Promise<Record<string, unknown>> {
  const document = { title: 'test' };
  const window = { axe, document };
  const fn = new Function('window', 'document', 'performance', `return ${AXE_RUN_EXPRESSION};`) as (w: unknown, d: unknown, p: unknown) => Promise<Record<string, unknown>>;
  return fn(window, document, performance);
}

const contrast = (ratio: number, extra: Record<string, unknown> = {}) => ({
  id: 'color-contrast',
  data: { contrastRatio: ratio, expectedContrastRatio: '4.5:1', fgColor: '#999999', bgColor: '#ffffff', fontSize: '12.0pt (16px)', fontWeight: 'normal', ...extra },
});

const node = (selector: unknown, source = '<p>x</p>', any: unknown[] = []): FakeNode => ({ node: { selector, source }, any, all: [], none: [] });

describe('AXE_RUN_EXPRESSION in the page', () => {
  it('runs only the seven rules on the top-level document, without iframes and preload, with its own reporter', async () => {
    const { axe, calls } = fakeAxe([]);
    await runInPage(axe);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { options: unknown }).options).toEqual({ runOnly: { type: 'rule', values: [...AXE_RULES] }, iframes: false, preload: false, reporter: AXE_REPORTER });
  });

  it('counts violations, incomplete and passes per rule and keeps at most five examples', async () => {
    const violations = Array.from({ length: 7 }, (_, i) => node([`p:nth-child(${i + 1})`], `<p class="c${i}">Text ${i}</p>`, [contrast(2 + i / 10)]));
    const { axe } = fakeAxe([
      { id: 'color-contrast', impact: 'serious', violations, passes: [node(['h1'], '<h1>', [contrast(21)]), node(['h2'], '<h2>', [contrast(4.6)])], incomplete: [node(['.hero p'], '<p>', [{ id: 'color-contrast', data: { messageKey: 'bgImage' } }])] },
      { id: 'image-alt', impact: 'critical', violations: [node(['img.logo'], '<img class="logo" src="logo.png">')], passes: [node(['img.a']), node(['img.b'])] },
      { id: 'label', passes: [node(['#email'])] },
      { id: 'link-name', inapplicable: [] },
      { id: 'button-name', passes: [node(['button'])] },
      { id: 'html-has-lang', passes: [node(['html'])] },
      { id: 'html-lang-valid', passes: [node(['html'])] },
    ]);
    const result = await runInPage(axe);
    expect(result['status']).toBe('ok');
    expect(result['axeVersion']).toBe('4.14.1');
    const rules = result['rules'] as Record<string, { violations: number; incomplete: number; passes: number; impact: string | null; examples: { target: string[]; html: string; contrast: unknown }[]; incompleteExamples: unknown[] }>;
    expect(Object.keys(rules).sort()).toEqual([...AXE_RULES].sort());
    expect(rules['color-contrast']).toMatchObject({ violations: 7, incomplete: 1, passes: 2, impact: 'serious' });
    expect(rules['color-contrast']?.examples).toHaveLength(5);
    expect(rules['color-contrast']?.examples[0]).toEqual({
      target: ['p:nth-child(1)'],
      html: '<p class="c0">Text 0</p>',
      contrast: { ratio: 2, expected: '4.5:1', fgColor: '#999999', bgColor: '#ffffff', fontSize: '12.0pt (16px)', fontWeight: 'normal', messageKey: null },
    });
    expect(rules['color-contrast']?.incompleteExamples).toEqual([{ target: ['.hero p'], html: '<p>', contrast: { ratio: null, expected: null, fgColor: null, bgColor: null, fontSize: null, fontWeight: null, messageKey: 'bgImage' } }]);
    expect(rules['image-alt']).toMatchObject({ violations: 1, passes: 2, impact: 'critical', examples: [{ target: ['img.logo'], contrast: null }] });
    expect(rules['link-name']).toEqual({ violations: 0, incomplete: 0, passes: 0, impact: null, examples: [], incompleteExamples: [] });
    expect(result['lowestContrast']).toMatchObject({ violation: { ratio: 2 }, pass: { ratio: 4.6 } });
  });

  it('flattens shadow DOM selectors and cuts HTML to 200 characters', async () => {
    const long = `<div class="banner">${'x'.repeat(400)}</div>`;
    const { axe } = fakeAxe([{ id: 'button-name', violations: [node([['consent-box', 'button.close']], long)] }]);
    const rules = (await runInPage(axe))['rules'] as Record<string, { examples: { target: string[]; html: string }[] }>;
    expect(rules['button-name']?.examples[0]?.target).toEqual(['consent-box', 'button.close']);
    expect(rules['button-name']?.examples[0]?.html).toHaveLength(200);
  });

  it('reports rules that threw inside axe', async () => {
    const { axe } = fakeAxe([{ id: 'label', error: { message: 'boom' }, incomplete: [node(['input'])] }]);
    const result = await runInPage(axe);
    expect(result['ruleErrors']).toEqual(['label']);
    expect((result['rules'] as Record<string, { incomplete: number }>)['label']?.incomplete).toBe(1);
  });

  it('returns an error when axe is missing or throws', async () => {
    expect(await runInPage(undefined)).toMatchObject({ status: 'error', error: 'axe-core is not available in the page' });
    const { axe } = fakeAxe([], { run: () => Promise.reject(new Error('Axe is already running')) });
    expect(await runInPage(axe)).toMatchObject({ status: 'error', error: 'Axe is already running', rules: {} });
  });
});

describe('axeCaptureFrom', () => {
  const complete = () => Object.fromEntries(AXE_RULES.map((id) => [id, { violations: 0, incomplete: 0, passes: 1, impact: null, examples: [], incompleteExamples: [] }]));

  it('keeps a complete result', () => {
    const capture = axeCaptureFrom({ status: 'ok', error: null, axeVersion: '4.14.1', rules: complete(), ruleErrors: [], lowestContrast: { violation: null, pass: null }, runMs: 120 }, { injectMs: 40, totalMs: 170 });
    expect(capture).toMatchObject({ status: 'ok', axeVersion: '4.14.1', timing: { injectMs: 40, runMs: 120, totalMs: 170 } });
    expect(Object.keys(capture.rules)).toHaveLength(7);
  });

  it('turns an incomplete or foreign result into an error, never into zero problems', () => {
    const rules = complete();
    delete rules['label'];
    expect(axeCaptureFrom({ status: 'ok', rules, runMs: 1 }, { injectMs: 1, totalMs: 2 })).toMatchObject({ status: 'error', error: 'axe result without rule label', rules: {} });
    expect(axeCaptureFrom(null, { injectMs: null, totalMs: 0 })).toMatchObject({ status: 'error', rules: {} });
    expect(axeCaptureFrom({ status: 'error', error: 'x' }, { injectMs: 1, totalMs: 2 })).toMatchObject({ status: 'error', error: 'x' });
    expect(axeCaptureFrom('text', { injectMs: 1, totalMs: 2 }).status).toBe('error');
  });

  it('sanitises counts and examples', () => {
    const rules = complete();
    rules['image-alt'] = { violations: -3, incomplete: 1.5, passes: 'many', impact: 7, examples: [{ target: ['img', 5], html: 'y'.repeat(500), contrast: null }], incompleteExamples: 'none' };
    const capture = axeCaptureFrom({ status: 'ok', rules, runMs: 1 }, { injectMs: 1, totalMs: 2 });
    expect(capture.rules['image-alt']).toEqual({ violations: 0, incomplete: 0, passes: 0, impact: null, examples: [{ target: ['img'], html: 'y'.repeat(200), contrast: null }], incompleteExamples: [] });
  });

  it('axeNotRun has no rules', () => {
    expect(axeNotRun('skipped', 'no time')).toMatchObject({ status: 'skipped', error: 'no time', rules: {}, timing: { totalMs: 0 } });
  });
});

describe('axeBudgetMs', () => {
  it('gives axe at most 8 s and keeps a margin before the hard limit', () => {
    expect(axeBudgetMs(3_000, 20_000)).toBe(AXE_TIME.maxMs);
    expect(axeBudgetMs(15_500, 20_000)).toBe(3_500);
    expect(axeBudgetMs(17_600, 20_000)).toBe(0);
  });
});
