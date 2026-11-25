import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { buildReport } from '../src/report/build.ts';
import type { Capture, CapturedRequest } from '../src/capture/types.ts';
import type { Report } from '../src/report/types.ts';
import { REPORT_SCHEMA_V1, validateReport } from '../src/report/validate.ts';
import { SHOP, SHOP_URL, shopCapture } from './report-helpers.ts';

// Session B3 part 2: two optional fields of schema v1. `evidence[].initiatorType` (the browser's initiator type of a
// request, so the mark "im Quelltext" stands only for a request in the served source) and `timeline.rows[].fileTypes`
// (which types the site's own files are, so "Ihre Dateien: Design und Skripte" stands only when it is true).

const build = (capture: Capture): Report =>
  buildReport({ id: 'a'.repeat(26), createdAt: '2026-11-25T10:00:00.000Z', siteUrl: SHOP_URL, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated, visit: { country: null, colo: null } }).report;

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(REPORT_SCHEMA_V1 as object);

/** The shop of the report tests with the initiators of its requests replaced (by address). */
function withInitiators(initiators: Record<string, CapturedRequest['initiator']>, extra: Partial<CapturedRequest>[] = []): Capture {
  const base = shopCapture();
  const requests = [...base.requests, ...extra.map((r, i) => ({ ...base.requests[0]!, isNavigation: false, resourceType: 'other', ...r, seq: base.requests.length + i }) as CapturedRequest)];
  return { ...base, requests: requests.map((r) => (r.url in initiators ? { ...r, initiator: initiators[r.url] ?? null } : r)) };
}

const evidenceOf = (report: Report, findingId: string) => report.findings.find((f) => f.id === findingId)?.evidence ?? [];

describe('evidence: the initiator type of a request (B3 part 2)', () => {
  it('keeps parser, script and the others of the closed list; null when the capture does not say', () => {
    const report = build(
      withInitiators({
        'https://fonts.googleapis.com/css2?family=Lato:wght@400;700': { type: 'parser', url: SHOP },
        'https://www.googletagmanager.com/gtag/js?id=G-TEST123': { type: 'script', url: `${SHOP}wp-content/plugins/tag/loader.js` },
        'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js': { type: 'preload', url: SHOP },
      }),
    );
    const fonts = evidenceOf(report, 'third-party:google-fonts');
    expect(fonts.map((e) => e.type === 'request' && [e.url, e.initiatorType, e.via])).toEqual([
      ['https://fonts.googleapis.com/css2?family=Lato:wght@400;700', 'parser', SHOP],
      ['https://fonts.gstatic.com/s/lato/v24/lato.woff2', 'parser', 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700'],
    ]);
    const tag = evidenceOf(report, 'third-party:google-tag-manager');
    expect(tag.map((e) => e.type === 'request' && e.initiatorType)).toEqual(['script']);
    const cdn = evidenceOf(report, 'third-party:jsdelivr');
    expect(cdn.map((e) => e.type === 'request' && e.initiatorType)).toEqual(['preload']);
    // The shop's Usercentrics request has no initiator in the capture.
    const all = report.findings.flatMap((f) => f.evidence).filter((e) => e.type === 'request');
    expect(all.every((e) => e.type === 'request' && 'initiatorType' in e)).toBe(true);
    expect(validateReport(report)).toEqual([]);
    expect(ajv(report)).toBe(true);
  });

  it('a type the report does not know becomes "other", never the string of the browser', () => {
    const report = build(withInitiators({ 'https://www.googletagmanager.com/gtag/js?id=G-TEST123': { type: 'SignedExchange<script>', url: SHOP } }));
    expect(evidenceOf(report, 'third-party:google-tag-manager').map((e) => e.type === 'request' && e.initiatorType)).toEqual(['other']);
    expect(validateReport(report)).toEqual([]);
  });

  it('the validators refuse a type outside the list, and accept a report without the field (made before)', () => {
    const report = build(shopCapture());
    const broken = structuredClone(report) as unknown as { findings: { evidence: Record<string, unknown>[] }[] };
    const request = broken.findings.flatMap((f) => f.evidence).find((e) => e.type === 'request')!;
    request.initiatorType = 'inline';
    expect(validateReport(broken)).not.toEqual([]);
    expect(ajv(broken)).toBe(false);
    for (const e of broken.findings.flatMap((f) => f.evidence)) delete e.initiatorType;
    expect(validateReport(broken)).toEqual([]);
    expect(ajv(broken)).toBe(true);
  });
});

describe('Zeitschnitt: the types of the own files of the site (B3 part 2)', () => {
  it('the row of the own files names its types in a fixed order, each once; every other row has null', () => {
    const report = build(shopCapture());
    const rows = report.timeline!.rows;
    expect(rows.find((r) => r.kind === 'files')?.fileTypes).toEqual(['stylesheet', 'script']);
    for (const row of rows.filter((r) => r.kind !== 'files')) expect(row.fileTypes, row.label).toBeNull();
    expect(ajv(report)).toBe(true);
  });

  it('fonts, images, data requests and anything else; only the files that start in the window', () => {
    const report = build(
      withInitiators({}, [
        { url: `${SHOP}wp-content/themes/kaffee/fonts/icons.woff2`, resourceType: 'font', startMs: 600, endMs: 800 },
        { url: `${SHOP}wp-content/uploads/logo.png`, resourceType: 'image', startMs: 650, endMs: 900 },
        { url: `${SHOP}wp-admin/admin-ajax.php`, resourceType: 'xhr', startMs: 700, endMs: 760 },
        { url: `${SHOP}wp-content/uploads/film.mp4`, resourceType: 'media', startMs: 710, endMs: 900 },
        { url: `${SHOP}manifest.json`, resourceType: 'manifest', startMs: 720, endMs: 740 },
      ]),
    );
    // The shop's hero.jpg starts at 3.5 s, after the window: it does not make the row "Bilder" by itself; logo.png does.
    expect(report.timeline!.rows.find((r) => r.kind === 'files')?.fileTypes).toEqual(['stylesheet', 'font', 'script', 'image', 'media', 'data', 'other']);
    expect(validateReport(report)).toEqual([]);
    expect(ajv(report)).toBe(true);
  });

  it('a row of scripts only says scripts; a report without the field (made before) stays valid', () => {
    const base = shopCapture();
    const report = build({ ...base, requests: base.requests.filter((r) => !r.url.endsWith('style.css')) });
    expect(report.timeline!.rows.find((r) => r.kind === 'files')?.fileTypes).toEqual(['script']);
    const old = structuredClone(report) as unknown as { timeline: { rows: Record<string, unknown>[] } };
    for (const row of old.timeline.rows) delete row.fileTypes;
    expect(validateReport(old)).toEqual([]);
    expect(ajv(old)).toBe(true);
    (old.timeline.rows[1] as Record<string, unknown>).fileTypes = ['scripts'];
    expect(validateReport(old)).not.toEqual([]);
  });
});
