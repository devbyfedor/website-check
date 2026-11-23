import { describe, expect, it } from 'vitest';
import type { AxeCapture } from '../src/a11y/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { axeResult, SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Session fix-a2, review finding 20: the Prüfmaß "Bilder mit Beschreibung" counts only images that have a
 * text alternative. The pages are the ones of the review's reproduction, as the axe part of a capture
 * (the same pages run through Chromium in `test/integration/a11y-security.test.ts`).
 */

function report(imageAlt: { violations?: number; incomplete?: number; passes: number }, images: AxeCapture['images'] | undefined): Report {
  const rule = { violations: 0, incomplete: 0, impact: null, examples: [], incompleteExamples: [], ...imageAlt };
  const axe: AxeCapture = { ...axeResult({ 'image-alt': rule }), ...(images === undefined ? {} : { images }) };
  if (images === undefined) delete axe.images;
  const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T09:00:00.000Z', siteUrl: SHOP_URL, mode: 'full', capture: shopCapture({ axe }), rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(built.report)).toEqual([]);
  return built.report;
}

const row = (r: Report) => r.measures.find((m) => m.id === 'images-described');
const imageFindings = (r: Report) => r.findings.filter((f) => f.id.startsWith('a11y:image-alt')).map((f) => [f.id, f.kind, f.risk, f.textId, f.params['count']]);

describe('finding 20: "Bilder mit Beschreibung" counts only described images', () => {
  it('three images with alt="" are no "3 von 3" and no "erfüllt": none has a description', () => {
    const r = report({ passes: 3 }, { described: 0, decorative: 3 });
    expect(row(r)).toEqual({ id: 'images-described', result: 'manual', target: { type: 'all' }, actual: { type: 'of', count: 0, total: 0 } });
    expect(imageFindings(r)).toEqual([['a11y:image-alt:decorative', 'manual', null, 'a11y-image-alt-decorative', 3]]);
  });

  it('8 with a text, 4 with alt="", 5 without alt: "8 von 13", not "12 von 17"', () => {
    const r = report({ violations: 5, passes: 12 }, { described: 8, decorative: 4 });
    expect(row(r)).toMatchObject({ result: 'fail', actual: { type: 'of', count: 8, total: 13 } });
    expect(imageFindings(r)).toEqual([
      ['a11y:image-alt', 'finding', 'medium', 'a11y-image-alt', 5],
      ['a11y:image-alt:decorative', 'manual', null, 'a11y-image-alt-decorative', 4],
    ]);
  });

  it('images with role="presentation" or "none" count as marked decoration too', () => {
    expect(row(report({ passes: 3 }, { described: 0, decorative: 3 }))?.result).toBe('manual');
  });

  it('controls: three described images are "3 von 3" and "erfüllt"; a page without images is "erfüllt"', () => {
    const described = report({ passes: 3 }, { described: 3, decorative: 0 });
    expect(row(described)).toMatchObject({ result: 'pass', actual: { type: 'of', count: 3, total: 3 } });
    expect(imageFindings(described)).toEqual([]);
    const none = report({ passes: 0 }, { described: 0, decorative: 0 });
    expect(row(none)).toMatchObject({ result: 'pass', actual: { type: 'of', count: 0, total: 0 } });
    expect(imageFindings(none)).toEqual([]);
  });

  it('an image axe could not decide keeps the row at "bitte manuell prüfen"', () => {
    const r = report({ passes: 2, incomplete: 1 }, { described: 2, decorative: 0 });
    expect(row(r)).toMatchObject({ result: 'manual', actual: { type: 'of', count: 2, total: 3 } });
  });

  it('a capture saved before the fix does not say how many passing images are described: no count, no "erfüllt"', () => {
    const passing = report({ passes: 12 }, undefined);
    expect(row(passing)).toEqual({ id: 'images-described', result: 'manual', target: { type: 'all' }, actual: null });
    expect(imageFindings(passing)).toEqual([]);
    const failing = report({ violations: 5, passes: 12 }, undefined);
    expect(row(failing)).toMatchObject({ result: 'fail', actual: null });
    // Without any passing image there is nothing to split.
    expect(row(report({ passes: 0 }, undefined))).toMatchObject({ result: 'pass', actual: { type: 'of', count: 0, total: 0 } });
    expect(row(report({ violations: 2, passes: 0 }, undefined))).toMatchObject({ result: 'fail', actual: { type: 'of', count: 0, total: 2 } });
  });
});
