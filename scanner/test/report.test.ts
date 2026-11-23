import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { notAllowedCapture } from '../src/capture/failure.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { buildReport, type BuildReportOptions } from '../src/report/build.ts';
import { REPORT_LIMITS, type Report } from '../src/report/types.ts';
import { compileSchema, REPORT_SCHEMA_V1, validateReport } from '../src/report/validate.ts';
import { SCANNER_ROOT, makeCapture } from './helpers.ts';
import { axeResult, SHOP, SHOP_URL, shopCapture } from './report-helpers.ts';

const ID = 'abcdefghijklmnopqrstuvwxyz';

function build(overrides: Partial<BuildReportOptions> = {}) {
  return buildReport({
    id: ID,
    createdAt: '2026-11-20T11:59:58.000Z',
    siteUrl: SHOP_URL,
    mode: 'full',
    capture: shopCapture(),
    rules: DEFAULT_RULES,
    scannerVersion: SCANNER_VERSION,
    rulesUpdated: RULES_FILE.updated,
    visit: { country: 'IT', colo: 'MXP' },
    ...overrides,
  });
}

function expectValid(report: unknown): void {
  expect(validateReport(report)).toEqual([]);
}

describe('report schema v1', () => {
  it('is the file in scanner/schema and compiles with the supported keywords only', () => {
    const file = JSON.parse(readFileSync(resolve(SCANNER_ROOT, 'schema/report.v1.schema.json'), 'utf8')) as unknown;
    expect(file).toEqual(REPORT_SCHEMA_V1);
    expect(() => compileSchema(file)).not.toThrow();
  });

  it('refuses a schema with a keyword the validator does not implement', () => {
    expect(() => compileSchema({ type: 'object', properties: { a: { type: 'string', format: 'email' } } })).toThrow(/format/);
    expect(() => compileSchema({ $ref: '#/$defs/missing' })).toThrow(/missing/);
  });

  it('checks types, required and extra properties, enums, patterns, lengths in code points, oneOf and anyOf', () => {
    const schema = compileSchema({
      type: 'object',
      additionalProperties: false,
      required: ['a', 'v'],
      properties: {
        a: { type: 'string', maxLength: 3, pattern: '^[a-zä]+$' },
        n: { type: ['integer', 'null'], minimum: 1 },
        e: { enum: ['x', null] },
        v: { oneOf: [{ type: 'object', required: ['k'], properties: { k: { const: 1 } } }, { type: 'object', required: ['k'], properties: { k: { const: 2 } } }] },
        u: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    });
    expect(schema.validate({ a: 'äbc', v: { k: 1 } })).toEqual([]);
    expect(schema.validate({ a: 'äbcd', v: { k: 1 } }).map((e) => e.path)).toEqual(['/a']);
    expect(schema.validate({ a: 'ab', v: { k: 3 } }).map((e) => e.path)).toEqual(['/v']);
    expect(schema.validate({ a: 'AB', v: { k: 1 }, n: 1.5, e: 'y', u: 3, extra: true }).map((e) => e.path).sort()).toEqual(['/', '/a', '/e', '/n', '/u']);
    expect(schema.validate({ v: { k: 2 } })[0]?.message).toMatch(/missing property "a"/);
  });
});

describe('buildReport: a complete scan', () => {
  const { report, networkHosts } = build();

  it('validates against the schema', () => {
    expectValid(report);
    expect(report.state).toBe('complete');
    expect(report.notice).toBeNull();
  });

  it('fills the head: host for display, date, system, pages, revision, country of the visit', () => {
    expect(report.site).toEqual({ url: SHOP_URL, host: 'www.roesterei-muster.example', displayHost: 'roesterei-muster.example', finalUrl: SHOP });
    expect(report.scan.scannedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(report.scan.durationMs).toBe(5400);
    expect(report.platform).toEqual({ system: 'wordpress', woocommerce: true, shopwareVersion: null, shop: true });
    expect(report.pages).toEqual({ homepage: 'checked', impressum: 'checked' });
    expect(report.revision).toEqual({ letter: 'A', kind: 'initial' });
    expect(report.visit.country).toBe('IT');
    expect(report.visit.colo).toBe('MXP');
  });

  it('gives the Prüfmaße rows in the order of the design', () => {
    expect(report.measures.map((m) => [m.id, m.result])).toEqual([
      ['third-party-before-consent', 'fail'],
      ['impressum-fields', 'pass'],
      ['lowest-contrast', 'fail'],
      ['images-described', 'fail'],
      ['accessibility-statement', 'manual'],
      ['https', 'pass'],
      ['security-headers', 'partial'],
    ]);
    const byId = new Map(report.measures.map((m) => [m.id, m]));
    expect(byId.get('third-party-before-consent')?.actual).toEqual({ type: 'count', count: 3 });
    expect(byId.get('impressum-fields')?.actual).toEqual({ type: 'of', count: 4, total: 4 });
    expect(byId.get('lowest-contrast')?.actual).toEqual({ type: 'ratio', ratio: 2.9, expected: '4.5:1' });
    expect(byId.get('images-described')?.actual).toEqual({ type: 'of', count: 12, total: 17 });
    // Not found is never "fehlt": the statement can be linked elsewhere (product rule 3).
    expect(byId.get('accessibility-statement')?.actual).toEqual({ type: 'state', state: 'not-found' });
    expect(byId.get('security-headers')?.actual).toEqual({ type: 'of', count: 2, total: 5 });
  });

  it('puts the three findings with the highest risk into the plan', () => {
    expect(report.priorities).toEqual(['third-party:google-fonts', 'third-party:google-tag-manager', 'third-party:google-analytics']);
    const fonts = report.findings.find((f) => f.id === 'third-party:google-fonts');
    expect(fonts).toMatchObject({ area: 'privacy', kind: 'finding', risk: 'high', textId: 'third-party-precedent', beforeConsent: true, serviceKey: 'google-fonts', fixTextId: 'fix-google-fonts', field: null });
    expect(fonts?.params).toMatchObject({ service: 'Google Fonts', provider: 'Google', count: 2, firstStartMs: 310, beforeBanner: true });
    expect(fonts?.evidence[0]).toMatchObject({ type: 'request', url: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700', reachedServer: true, beforeBanner: true });
  });

  it('gives services of the class usually-consent (maps, video, chat, reviews) a medium risk, never a high one (Fedor, 23.11.2026)', () => {
    const base = shopCapture();
    const capture = shopCapture({
      requests: [
        ...base.requests.map(({ seq: _seq, ...r }) => r),
        { url: 'https://maps.googleapis.com/maps/api/js?key=TEST', resourceType: 'script', startMs: 900, endMs: 1100 },
      ],
    });
    const maps = build({ capture }).report.findings.find((f) => f.id === 'third-party:google-maps');
    expect(maps).toMatchObject({ area: 'privacy', kind: 'finding', risk: 'medium', textId: 'third-party-usually-consent', beforeConsent: true });
    // Precedent and consent-required stay high.
    const fonts = build({ capture }).report.findings.find((f) => f.id === 'third-party:google-fonts');
    expect(fonts?.risk).toBe('high');
  });

  it('lists hints and manual checks without a risk, and never a third-party service of the site itself', () => {
    const kinds = new Map(report.findings.map((f) => [f.id, [f.kind, f.risk]]));
    expect(kinds.get('third-party:jsdelivr')).toEqual(['hint', null]);
    expect(kinds.get('third-party:unknown:kaffeeklatsch.example')).toEqual(['hint', null]);
    expect(kinds.get('legal:accessibility-statement')).toEqual(['manual', null]);
    expect(kinds.get('a11y:color-contrast')).toEqual(['finding', 'medium']);
    expect(kinds.get('a11y:image-alt')).toEqual(['finding', 'medium']);
    expect(kinds.get('security:headers')).toEqual(['finding', 'low']);
    expect(kinds.has('third-party:usercentrics')).toBe(false);
    expect(report.findings.some((f) => f.id.includes('roesterei-muster'))).toBe(false);
    expect(report.counts).toEqual({ findings: 6, manual: 1, hints: 2, notChecked: 0, services: 6 });
  });

  it('fills the Stückliste with every third-party service and its consent tag', () => {
    expect(report.services.map((s) => [s.position, s.key, s.consent])).toEqual([
      [1, 'google-fonts', 'missing'],
      [2, 'google-tag-manager', 'missing'],
      [3, 'google-analytics', 'missing'],
      [4, 'jsdelivr', 'grey-zone'],
      [5, 'unknown:kaffeeklatsch.example', 'grey-zone'],
      [6, 'usercentrics', 'not-needed'],
    ]);
    expect(report.services.every((s) => s.starts === 'before-consent')).toBe(true);
    expect(report.services[0]?.hosts).toEqual(['fonts.googleapis.com', 'fonts.gstatic.com']);
  });

  it('draws the Zeitschnitt for the first three seconds with the banner as the cut', () => {
    const timeline = report.timeline;
    expect(timeline?.windowMs).toBe(3000);
    expect(timeline?.bannerVisibleAtMs).toBe(1400);
    expect(timeline?.rows.map((r) => [r.label, r.kind, r.beforeBanner])).toEqual([
      ['www.roesterei-muster.example', 'document', true],
      ['www.roesterei-muster.example/wp-content', 'files', true],
      ['fonts.googleapis.com', 'service', true],
      ['fonts.gstatic.com', 'service', true],
      ['cdn.jsdelivr.net', 'service', true],
      ['www.googletagmanager.com', 'service', true],
      ['app.usercentrics.eu', 'consent-tool', true],
      ['region1.google-analytics.com', 'service', true],
    ]);
    // The unknown widget and the hero image start after three seconds.
    expect(timeline?.rows.some((r) => r.label.startsWith('widgets.'))).toBe(false);
  });

  it('keeps the mandatory information with exact quotes and the security headers', () => {
    expect(report.legal?.impressum).toEqual({ state: 'analyzed', url: `${SHOP}impressum/`, crossSite: false });
    expect(report.legal?.fields.ustId).toEqual({ status: 'found', quote: 'DE123456789' });
    expect(report.security?.headers.filter((h) => h.counts).map((h) => h.key)).toEqual(['hsts', 'xcto']);
  });

  it('gives one network row per host for D1', () => {
    expect(networkHosts.map((h) => [h.host, h.party, h.serviceKey, h.requestCount])).toEqual([
      ['www.roesterei-muster.example', 'first', null, 4],
      ['fonts.googleapis.com', 'third', 'google-fonts', 1],
      ['fonts.gstatic.com', 'third', 'google-fonts', 1],
      ['cdn.jsdelivr.net', 'third', 'jsdelivr', 1],
      ['www.googletagmanager.com', 'third', 'google-tag-manager', 1],
      ['app.usercentrics.eu', 'third', 'usercentrics', 1],
      ['region1.google-analytics.com', 'third', 'google-analytics', 1],
      ['widgets.kaffeeklatsch.example', 'third', 'unknown:kaffeeklatsch.example', 1],
    ]);
  });
});

describe('buildReport: states without a full check', () => {
  it('blocked: no findings, no measures, the notice says so', () => {
    const { report, networkHosts } = build({ capture: shopCapture({ ok: false, failure: { reason: 'blocked', message: 'check page', status: 403 } }) });
    expectValid(report);
    expect(report.state).toBe('blocked');
    expect(report.notice).toEqual({ textId: 'report-blocked', params: { status: 403 } });
    expect(report.findings).toEqual([]);
    expect(report.measures).toEqual([]);
    expect(report.services).toEqual([]);
    expect(report.timeline).toBeNull();
    expect(report.pages.homepage).toBe('not-checked');
    expect(Object.values(report.sections).every((s) => s.status === 'not-checked')).toBe(true);
    expect(networkHosts).toEqual([]);
  });

  it('not-allowed: refused before the browser, with the rule that refused it', () => {
    const capture = notAllowedCapture('cloudflare-browser-run', shopCapture().environment, 'https://intern.example/', 'not allowed: address (intern.example resolves to a loopback address (127.0.0.1))');
    const { report } = build({ capture });
    expectValid(report);
    expect(report.state).toBe('not-allowed');
    expect(report.notice).toEqual({ textId: 'report-not-allowed', params: { rejection: 'address' } });
    expect(report.failure).toEqual({ reason: 'not-allowed', status: null });
  });

  it('failed: a timeout gives the state failed and no findings', () => {
    const { report } = build({ capture: makeCapture({ requests: [], ok: false, failure: { reason: 'timeout', message: 'no answer' }, finalUrl: null, mainDocument: null }) });
    expectValid(report);
    expect(report.state).toBe('failed');
    expect(report.notice).toEqual({ textId: 'report-failed', params: { reason: 'timeout', status: null } });
    expect(report.findings).toEqual([]);
  });

  it('quick: incomplete, no third-party list and no accessibility check without a browser', () => {
    const { report } = build({ mode: 'quick' });
    expectValid(report);
    expect(report.state).toBe('quick');
    expect(report.scan.mode).toBe('quick');
    expect(report.notice).toEqual({ textId: 'report-quick-incomplete', params: {} });
    expect(report.sections.thirdParty).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(report.sections.accessibility).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(report.services).toEqual([]);
    expect(report.timeline).toBeNull();
    expect(report.findings.some((f) => f.area === 'privacy' || f.area === 'accessibility')).toBe(false);
    expect(report.measures.find((m) => m.id === 'third-party-before-consent')).toMatchObject({ result: 'not-checked', actual: null });
    expect(report.measures.find((m) => m.id === 'lowest-contrast')).toMatchObject({ result: 'not-checked', actual: null });
    expect(report.measures.find((m) => m.id === 'https')?.result).toBe('pass');
  });
});

describe('buildReport: unsure cases', () => {
  it('a missing Impressum link is a manual check with a high risk, never a violation', () => {
    const capture = shopCapture();
    const page = capture.page;
    if (page === null) throw new Error('page missing');
    const { report } = build({ capture: { ...capture, page: { ...page, links: page.links.filter((l) => l.text !== 'Impressum') }, impressum: null } });
    expectValid(report);
    expect(report.findings.find((f) => f.id === 'legal:impressum')).toMatchObject({ kind: 'manual', risk: 'high', textId: 'legal-impressum-no-link' });
    expect(report.measures.find((m) => m.id === 'impressum-fields')).toMatchObject({ result: 'manual', actual: null });
    expect(report.pages.impressum).toBe('not-checked');
    expect(report.priorities).toHaveLength(3);
  });

  it('without a banner there is no cut and no "before the banner"', () => {
    const { report } = build({ capture: shopCapture({ consentBanner: { detected: false, toolId: null, method: null, selector: null, visibleAtMs: null, toolsInDom: [] } }) });
    expectValid(report);
    expect(report.timeline?.bannerVisibleAtMs).toBeNull();
    expect(report.timeline?.rows.every((r) => r.beforeBanner === null)).toBe(true);
    // The findings stay: every request happened without consent, the banner time decides nothing.
    expect(report.counts.findings).toBe(6);
  });

  it('axe that did not run gives "not checked", never "no barriers"', () => {
    const { report } = build({ capture: shopCapture({ axe: { ...axeResult(), status: 'timeout', error: 'no time left', rules: {} } }) });
    expectValid(report);
    expect(report.sections.accessibility.status).toBe('not-checked');
    expect(report.findings.find((f) => f.id === 'a11y:not-checked')?.kind).toBe('not-checked');
    expect(report.measures.find((m) => m.id === 'images-described')?.result).toBe('not-checked');
  });

  it('a country that is not a two-letter code is dropped', () => {
    expect(build({ visit: { country: 'Italy', colo: 'mxp' } }).report.visit).toMatchObject({ country: null, colo: null });
    expect(build({ visit: undefined }).report.visit.country).toBeNull();
  });

  it('a third party on a very long domain keeps a short, unique key and the report validates (review)', () => {
    const bucket = 'b'.repeat(63);
    const capture = shopCapture();
    const requests = [
      ...capture.requests,
      { ...capture.requests[1], seq: 100, url: `https://${bucket}.s3.dualstack.eu-central-1.amazonaws.com/w.js`, startMs: 900 },
      { ...capture.requests[1], seq: 101, url: `https://${'c'.repeat(63)}.s3.dualstack.eu-central-1.amazonaws.com/w.js`, startMs: 910 },
      { ...capture.requests[1], seq: 102, url: `https://${'d'.repeat(110)}.example/x.js`, startMs: 920, status: null, failure: 'net::ERR_NAME_NOT_RESOLVED' },
    ] as typeof capture.requests;
    const built = build({ capture: { ...capture, requests } });
    expectValid(built.report);
    const long = built.report.services.filter((s) => s.key.length >= 90);
    expect(long).toHaveLength(3);
    expect(new Set(long.map((s) => s.key)).size).toBe(3);
    for (const s of long) expect(s.key.length).toBeLessThanOrEqual(100);
    expect(built.report.findings.filter((f) => f.serviceKey !== null).every((f) => built.report.services.some((s) => s.key === f.serviceKey))).toBe(true);
    expect(built.networkHosts.filter((h) => h.serviceKey !== null).every((h) => (h.serviceKey ?? '').length <= 100)).toBe(true);
  });

  it('a service whose requests never got an answer sent no data: no "before consent", tag not-reached (review)', () => {
    const capture = shopCapture();
    const requests = capture.requests.map((r) => (r.url.includes('fonts.g') ? { ...r, status: null, failure: 'net::ERR_CONNECTION_RESET' } : r));
    const { report } = build({ capture: { ...capture, requests } });
    expectValid(report);
    expect(report.findings.find((f) => f.id === 'third-party:google-fonts')).toMatchObject({ kind: 'hint', risk: null, textId: 'third-party-unconfirmed', beforeConsent: false });
    expect(report.services.find((s) => s.key === 'google-fonts')?.consent).toBe('not-reached');
    expect(report.findings.find((f) => f.id === 'third-party:google-analytics')?.beforeConsent).toBe(true);
    expect(report.priorities).not.toContain('third-party:google-fonts');
  });

  it('a loaded page whose text and links were not read: mandatory information not checked, nothing reported missing (review)', () => {
    const { report } = build({ capture: shopCapture({ page: null }) });
    expectValid(report);
    expect(report.sections.legal).toEqual({ status: 'not-checked', reason: 'page-not-read' });
    expect(report.legal).toBeNull();
    expect(report.findings.some((f) => f.area === 'mandatory-information')).toBe(false);
    expect(report.measures.find((m) => m.id === 'impressum-fields')?.result).toBe('not-checked');
    expect(report.measures.find((m) => m.id === 'accessibility-statement')?.result).toBe('not-checked');
  });

  it('a huge page stays within the caps and still validates', () => {
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0, endMs: 100 }];
    for (let i = 0; i < 2000; i += 1) {
      requests.push({ url: `https://t${i % 300}.tracker${i % 150}.example/${'p'.repeat(600)}?i=${i}`, resourceType: 'script', isNavigation: false, startMs: 100 + i, endMs: 200 + i });
    }
    const built = build({ capture: shopCapture({ requests: makeCapture({ requests }).requests }) });
    expectValid(built.report);
    expect(built.report.services.length).toBe(REPORT_LIMITS.services);
    expect(built.report.findings.length).toBeLessThanOrEqual(REPORT_LIMITS.findings);
    expect(built.report.counts.services).toBe(150);
    expect(built.networkHosts.length).toBe(REPORT_LIMITS.networkHosts);
    expect(built.networkHostsDropped).toBe(201);
    expect(JSON.stringify(built.report).length).toBeLessThan(REPORT_LIMITS.maxReportChars);
  });
});

describe('the validator agrees with Ajv on valid and broken reports', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  const ajvValidate = ajv.compile(REPORT_SCHEMA_V1 as object);
  const base = build().report;
  const samples: [string, unknown][] = [
    ['complete', base],
    ['blocked', build({ capture: shopCapture({ ok: false, failure: { reason: 'blocked', message: 'x', status: 403 } }) }).report],
    ['quick', build({ mode: 'quick' }).report],
  ];
  const broken = (name: string, change: (r: Report & Record<string, unknown>) => void): void => {
    const copy = structuredClone(base) as Report & Record<string, unknown>;
    change(copy);
    samples.push([name, copy]);
  };
  broken('missing state', (r) => delete (r as Partial<Report>).state);
  broken('unknown property', (r) => (r.extra = 1));
  broken('wrong state', (r) => ((r as { state: string }).state = 'done'));
  broken('guessable id', (r) => (r.id = '1'));
  broken('date without zone', (r) => (r.createdAt = '2026-11-20 12:00'));
  broken('risk in German', (r) => ((r.findings[0] as { risk: string }).risk = 'hoch'));
  broken('field outside the plan', (r) => ((r.findings[0] as { field: string }).field = 'E4'));
  broken('measure value of two kinds', (r) => ((r.measures[0] as { target: unknown }).target = { type: 'count', count: 0, total: 4 }));
  broken('too many priorities', (r) => (r.priorities = ['a', 'b', 'c', 'd']));
  broken('long html', (r) => {
    const evidence = r.findings.find((f) => f.id === 'a11y:color-contrast')?.evidence[0] as { html: string };
    evidence.html = 'ä'.repeat(201);
  });
  broken('html of exactly 200 umlauts', (r) => {
    const evidence = r.findings.find((f) => f.id === 'a11y:color-contrast')?.evidence[0] as { html: string };
    evidence.html = 'ä'.repeat(200);
  });
  broken('country in lower case', (r) => (r.visit.country = 'it'));
  broken('param object', (r) => ((r.findings[0] as { params: Record<string, unknown> }).params.x = { a: 1 }));
  broken('timeline null', (r) => (r.timeline = null));

  it.each(samples)('%s', (_name, sample) => {
    const ours = validateReport(sample).length === 0;
    expect(ours).toBe(ajvValidate(sample));
  });

  it('the broken samples are really refused', () => {
    expect(samples.filter(([, s]) => validateReport(s).length > 0).map(([n]) => n)).toEqual([
      'missing state',
      'unknown property',
      'wrong state',
      'guessable id',
      'date without zone',
      'risk in German',
      'field outside the plan',
      'measure value of two kinds',
      'too many priorities',
      'long html',
      'country in lower case',
      'param object',
    ]);
  });
});
