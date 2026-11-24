import { describe, expect, it } from 'vitest';
import { axeCaptureFrom, positionsOf } from '../src/a11y/axe-script.ts';
import { AXE_RULES } from '../src/a11y/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { axeResult, SHOP_URL, shopCapture } from './report-helpers.ts';

/** Session fix-a6, "Feld B2": the field of the plan for the findings, from the positions in the capture. */

describe('"Feld B2" in the report', () => {
  it('an accessibility finding takes the field of its first example, a service the field of its first element', () => {
    const axe = axeResult();
    const contrast = axe.rules['color-contrast'];
    const image = axe.rules['image-alt'];
    if (contrast === undefined || image === undefined) throw new Error('fixture');
    const withFields = {
      ...axe,
      rules: { ...axe.rules, 'color-contrast': { ...contrast, examples: contrast.examples.map((e) => ({ ...e, field: 'A2' })) }, 'image-alt': { ...image, examples: image.examples.map((e) => ({ ...e, field: null })) } },
      positions: { hosts: { 'widgets.kaffeeklatsch.example': ['C3', 'D3'], 'fonts.googleapis.com': [] } },
    };
    const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP_URL, mode: 'full', capture: shopCapture({ axe: withFields }), rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
    expect(validateReport(built.report)).toEqual([]);
    const field = (id: string) => built.report.findings.find((f) => f.id === id)?.field;
    expect(field('a11y:color-contrast')).toBe('A2');
    expect(field('a11y:image-alt')).toBeNull();
    expect(field('third-party:unknown:kaffeeklatsch.example')).toBe('C3');
    // Google Fonts loads from the head: no element with a box, no field.
    expect(field('third-party:google-fonts')).toBeNull();
  });

  it('a capture without positions (made before the session) gives null everywhere', () => {
    const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP_URL, mode: 'full', capture: shopCapture(), rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
    expect(built.report.findings.every((f) => f.field === null)).toBe(true);
  });

  it('only fields of the grid and host names are kept from what the page script returned', () => {
    expect(positionsOf({ hosts: { 'cdn.example': ['B2', 'E9', 'b2', 7, 'A1'], 'bad host"': ['A1'], '=1+1': ['A1'], 'x.example': 'A1' } })).toEqual({ hosts: { 'cdn.example': ['B2', 'A1'] } });
    expect(positionsOf(null)).toBeNull();
    const rules = Object.fromEntries(AXE_RULES.map((id) => [id, { violations: 1, incomplete: 0, passes: 0, impact: null, examples: [{ target: ['img'], html: '<img>', contrast: null, field: '<b>' }], incompleteExamples: [] }]));
    const capture = axeCaptureFrom({ status: 'ok', error: null, axeVersion: '4.14.1', rules, ruleErrors: [], lowestContrast: { violation: null, pass: null }, runMs: 1 }, { injectMs: 1, totalMs: 2 });
    expect(capture.rules['image-alt']?.examples[0]?.field ?? null).toBeNull();
  });
});
