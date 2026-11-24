import { describe, expect, it } from 'vitest';
import { analyzeAccessibility } from '../src/analyzers/accessibility.ts';
import { analyzeCapture } from '../src/analyzers/capture.ts';
import { analyzeSecurity, checkCsp, checkHsts, checkPermissionsPolicy, checkReferrerPolicy } from '../src/analyzers/security.ts';
import { classifyMainDocument } from '../src/capture/failure.ts';
import type { Capture } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { firstPartySites } from '../src/domain/site.ts';
import { snapshotFromHtml } from '../src/quick/html-snapshot.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { makeCapture } from './helpers.ts';
import { axeResult, SHOP, SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Session fix-a6: the honesty of the report, review findings 63, 66, 67, 68, 69, 70, 77, 79, 81, 82 and 83. Each
 * case is the scenario of the review's reproduction, on synthetic captures of invented sites (no browser, no network).
 */

function report(capture: Capture, mode: 'full' | 'quick' = 'full'): Report {
  const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP_URL, mode, capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(built.report)).toEqual([]);
  return built.report;
}

const measure = (r: Report, id: string) => r.measures.find((m) => m.id === id);

describe('finding 63: a foreign domain in the redirect chain does not become first party', () => {
  const capture = makeCapture({
    requestedUrl: 'https://www.beispiel-firma.example/',
    finalUrl: 'https://www.beispiel-firma.example/',
    mainDocument: {
      status: 200,
      headers: { 'content-type': 'text/html' },
      redirectChain: [
        { url: 'https://www.beispiel-firma.example/', status: 302 },
        { url: 'https://l.facebook.com/l.php?u=x', status: 302 },
      ],
    },
    requests: [
      { url: 'https://www.beispiel-firma.example/', resourceType: 'document', isNavigation: true },
      { url: 'https://www.facebook.com/tr?id=1&ev=PageView', resourceType: 'image' },
      { url: 'https://www.google.com/maps/embed?pb=x', resourceType: 'document', isMainFrame: false },
    ],
  });

  it('the hop on facebook.com is not the site', () => {
    expect([...firstPartySites(capture)]).toEqual(['beispiel-firma.example']);
  });

  it('the pixel request on facebook.com stays a third-party finding', () => {
    const analysis = analyzeCapture(capture, DEFAULT_RULES);
    const ids = analysis.thirdParty?.services.map((s) => s.serviceId) ?? [];
    expect(ids).toContain('meta-pixel');
    expect(analysis.thirdParty?.services.find((s) => s.serviceId === 'meta-pixel')?.severity).toBe('finding');
  });

  it('control: hops on the site itself stay first party', () => {
    const own = makeCapture({ requestedUrl: 'http://beispiel-firma.example/', finalUrl: 'https://www.beispiel-firma.example/', mainDocument: { status: 200, headers: {}, redirectChain: [{ url: 'http://beispiel-firma.example/', status: 301 }] }, requests: [] });
    expect([...firstPartySites(own)]).toEqual(['beispiel-firma.example']);
  });
});

describe('finding 66: a main document that is not HTML gives no complete report', () => {
  for (const type of ['application/json', 'application/pdf; charset=binary', 'image/png', 'text/plain; charset=utf-8']) {
    it(`${type} is a failed capture "not-html"`, () => {
      expect(classifyMainDocument(200, { 'content-type': type }, '')?.reason).toBe('not-html');
      const r = report(shopCapture({ mainDocument: { status: 200, headers: { 'content-type': type }, redirectChain: [] } }));
      expect(r.state).toBe('failed');
      expect(r.failure?.reason).toBe('not-html');
      expect(r.findings).toEqual([]);
      expect(r.priorities).toEqual([]);
    });
  }

  it('controls: HTML, XHTML and a missing content type are pages', () => {
    expect(classifyMainDocument(200, { 'content-type': 'text/html; charset=utf-8' }, 'Start')).toBeNull();
    expect(classifyMainDocument(200, { 'content-type': 'application/xhtml+xml' }, 'Start')).toBeNull();
    expect(classifyMainDocument(200, {}, 'Start')).toBeNull();
  });
});

describe('finding 67: a confirmed finding shows a request that reached the service', () => {
  it('five aborted requests and a sixth with an answer: the answered one is in the evidence', () => {
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0, endMs: 100 }];
    for (let i = 0; i < 5; i += 1) requests.push({ url: `https://www.google-analytics.com/g/collect?n=${i}`, resourceType: 'fetch', startMs: 200 + i * 10, endMs: 205 + i * 10, status: null, failure: 'net::ERR_ABORTED' } as never);
    requests.push({ url: 'https://www.google-analytics.com/g/collect?n=5', resourceType: 'fetch', startMs: 400, endMs: 420, status: 200 } as never);
    const r = report(shopCapture({ requests: requests as never }));
    const f = r.findings.find((x) => x.serviceKey === 'google-analytics');
    expect(f?.kind).toBe('finding');
    expect(f?.beforeConsent).toBe(true);
    expect(f?.evidence).toHaveLength(5);
    expect(f?.evidence.some((e) => e.type === 'request' && e.reachedServer)).toBe(true);
  });
});

describe('finding 68: a Prüfmaß without a measured value is not "erfüllt"', () => {
  it('no text measured by the contrast rule: "Kleinster Textkontrast" is not checked', () => {
    const axe = axeResult({ 'color-contrast': { violations: 0, incomplete: 0, passes: 0, impact: null, examples: [], incompleteExamples: [] } });
    const r = report(shopCapture({ axe: { ...axe, lowestContrast: { violation: null, pass: null } } }));
    expect(measure(r, 'lowest-contrast')).toMatchObject({ result: 'not-checked', actual: null });
  });

  it('control: a measured passing contrast is "erfüllt" with its value', () => {
    const axe = axeResult({ 'color-contrast': { violations: 0, incomplete: 0, passes: 20, impact: null, examples: [], incompleteExamples: [] } });
    const pass = { ratio: 7.1, expected: '4.5:1', fgColor: '#000', bgColor: '#fff', fontSize: '12pt', fontWeight: 'normal', messageKey: null };
    const r = report(shopCapture({ axe: { ...axe, lowestContrast: { violation: null, pass } } }));
    expect(measure(r, 'lowest-contrast')).toMatchObject({ result: 'pass', actual: { type: 'ratio', ratio: 7.1 } });
  });
});

describe('finding 69: the manual redirect check carries its reason and status', () => {
  const cases: [string, NonNullable<Capture['httpProbe']>['hops'], string, number | null][] = [
    ['timeout', [{ url: 'http://www.roesterei-muster.example/', status: null, location: null, error: 'Timeout' }], 'timeout', null],
    ['http-error', [{ url: 'http://www.roesterei-muster.example/', status: 503, location: null, error: null }], 'http-error', 503],
    ['too-many-redirects', [{ url: 'http://www.roesterei-muster.example/', status: 301, location: 'http://www.roesterei-muster.example/a', error: null }], 'too-many-redirects', 301],
    ['stopped', [{ url: 'http://www.roesterei-muster.example/', status: 302, location: null, error: null }], 'no-location', 302],
    ['stopped', [{ url: 'http://www.roesterei-muster.example/', status: 302, location: 'http://10.0.0.1/', error: null }], 'not-allowed', 302],
  ];
  for (const [outcome, hops, reason, status] of cases) {
    it(`${outcome} gives the reason ${reason}`, () => {
      const r = report(shopCapture({ httpProbe: { url: 'http://www.roesterei-muster.example/', startedAt: '2026-11-24T09:00:00.000Z', outcome: outcome as never, hops, httpsTarget: null, durationMs: 50 } }));
      const f = r.findings.find((x) => x.id === 'security:http-redirect');
      expect(f).toMatchObject({ kind: 'manual', textId: 'security-http-redirect-manual', params: { reason, status } });
    });
  }
});

describe('finding 70: a manual check with a high risk is not pushed out of "Drei Dinge" by lower risks', () => {
  it('no Impressum link (manual, high) comes before contrast, images (medium) and headers (low)', () => {
    const base = shopCapture();
    const r = report(
      shopCapture({
        requests: [{ url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0, endMs: 100 }] as never,
        page: { ...(base.page as NonNullable<Capture['page']>), links: [{ href: `${SHOP}shop/`, text: 'Shop' }, { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }] },
        impressum: undefined,
      }),
    );
    const impressum = r.findings.find((f) => f.id === 'legal:impressum');
    expect(impressum).toMatchObject({ kind: 'manual', risk: 'high' });
    expect(r.priorities[0]).toBe('legal:impressum');
    expect(r.priorities).toHaveLength(3);
    expect(r.priorities).not.toContain('security:headers');
    // The list of findings keeps its order: findings before manual checks.
    expect(r.findings.findIndex((f) => f.id === 'a11y:color-contrast')).toBeLessThan(r.findings.findIndex((f) => f.id === 'legal:impressum'));
  });
});

describe('finding 77: a header that has no effect or weakens the protection does not count', () => {
  it('Referrer-Policy unsafe-url and no-referrer-when-downgrade', () => {
    expect(checkReferrerPolicy('unsafe-url', null)).toMatchObject({ status: 'invalid', counts: false, textId: 'security-header-referrer-policy-weak' });
    expect(checkReferrerPolicy('no-referrer-when-downgrade', null)).toMatchObject({ status: 'invalid', counts: false });
    expect(checkReferrerPolicy('strict-origin, unsafe-url', null)).toMatchObject({ status: 'invalid', counts: false });
    // A meta element is applied after the header and decides.
    expect(checkReferrerPolicy('strict-origin', 'unsafe-url')).toMatchObject({ status: 'invalid', counts: false });
    expect(checkReferrerPolicy('strict-origin-when-cross-origin', null)).toMatchObject({ status: 'present', counts: true });
  });

  it('Permissions-Policy that allows every feature everywhere', () => {
    expect(checkPermissionsPolicy('geolocation=*, camera=*, microphone=*', undefined)).toMatchObject({ status: 'invalid', counts: false, textId: 'security-header-permissions-policy-open' });
    expect(checkPermissionsPolicy('camera=(*)', undefined)).toMatchObject({ status: 'invalid', counts: false });
    expect(checkPermissionsPolicy('camera=(), fullscreen=*', undefined)).toMatchObject({ status: 'present', counts: true });
  });

  it('CSP without any directive', () => {
    expect(checkCsp(';', undefined, null)).toMatchObject({ status: 'invalid', counts: false, textId: 'security-header-csp-invalid' });
    expect(checkCsp(' , ', undefined, null)).toMatchObject({ status: 'invalid', counts: false });
    expect(checkCsp(';', undefined, "default-src 'self'")).toMatchObject({ status: 'meta', counts: true });
    expect(checkCsp("default-src 'self'", undefined, null)).toMatchObject({ status: 'present', counts: true });
  });

  it('HSTS with a repeated directive', () => {
    expect(checkHsts('max-age=31536000; max-age=0', true)).toMatchObject({ status: 'invalid', counts: false, textId: 'security-header-hsts-duplicate' });
    expect(checkHsts('max-age=31536000; includeSubDomains; includeSubDomains', true)).toMatchObject({ status: 'invalid', counts: false });
    expect(checkHsts('max-age=31536000; includeSubDomains', true)).toMatchObject({ status: 'present', counts: true });
  });

  it('the review scenario: unsafe-url, camera=*, CSP ";" and a repeated max-age count 0 of 5 instead of 4', () => {
    const headers = { 'strict-transport-security': 'max-age=31536000; max-age=0', 'content-security-policy': ';', 'x-content-type-options': 'nosniff', 'referrer-policy': 'unsafe-url', 'permissions-policy': 'camera=*' };
    const s = analyzeSecurity(shopCapture({ mainDocument: { status: 200, headers, redirectChain: [] } }));
    expect(s.headersPresent).toBe(1);
  });

  it('the quick check reads a CSP meta element only as a child of <head>', () => {
    const inBody = snapshotFromHtml('<!doctype html><html><head><title>x</title></head><body><p>Hallo</p><meta http-equiv="Content-Security-Policy" content="img-src \'none\'"></body></html>', 'https://www.beispiel.example/');
    expect(inBody.securityMeta?.csp ?? null).toBeNull();
    const inHead = snapshotFromHtml('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="img-src \'none\'"><title>x</title></head><body><p>Hallo</p></body></html>', 'https://www.beispiel.example/');
    expect(inHead.securityMeta?.csp).toBe("img-src 'none'");
  });
});

describe('finding 79: the redirect is not "erfüllt" when the final page opened on http', () => {
  it('http -> https -> http: HTTPS fails and the redirect is a manual check', () => {
    const capture = shopCapture({
      requestedUrl: 'https://www.roesterei-muster.example/',
      finalUrl: 'http://www.roesterei-muster.example/',
      httpProbe: { url: 'http://roesterei-muster.example/', startedAt: '2026-11-24T09:00:00.000Z', outcome: 'redirects-to-https', hops: [{ url: 'http://roesterei-muster.example/', status: 301, location: 'https://roesterei-muster.example/', error: null }], httpsTarget: 'https://roesterei-muster.example/', durationMs: 50 },
    });
    const s = analyzeSecurity(capture);
    expect(s.https.result).toBe('fail');
    expect(s.httpRedirect).toMatchObject({ result: 'manual', textId: 'security-http-redirect-manual', reason: 'final-http' });
  });
});

describe('finding 81: "Sicherheits-Header" is not "0 von 5" when two headers are undecided', () => {
  it('no page snapshot: CSP and Referrer-Policy manual, the Prüfmaß is manual', () => {
    const r = report(shopCapture({ page: null, mainDocument: { status: 200, headers: { 'content-type': 'text/html' }, redirectChain: [] } }));
    expect(r.security?.headers.map((h) => h.status)).toEqual(['missing', 'manual', 'missing', 'manual', 'missing']);
    expect(measure(r, 'security-headers')).toMatchObject({ result: 'manual', actual: { type: 'of', count: 0, total: 5 } });
  });

  it('controls: all missing is "nicht erfüllt", some present is "teilweise"', () => {
    const none = report(shopCapture({ mainDocument: { status: 200, headers: {}, redirectChain: [] } }));
    expect(measure(none, 'security-headers')?.result).toBe('fail');
    const some = report(shopCapture());
    expect(measure(some, 'security-headers')?.result).toBe('partial');
  });
});

describe('finding 82: the report says when the page was still loading at the limit', () => {
  it('stopReason max-wait is in the report', () => {
    const base = shopCapture();
    const r = report(shopCapture({ timings: { ...base.timings, stopReason: 'max-wait', endMs: 15_000 } }));
    expect(r.scan.stopReason).toBe('max-wait');
    expect(report(shopCapture()).scan.stopReason).toBe('network-quiet');
  });
});

describe('finding 83: a page where almost nothing was checked because of a frame gets no pass', () => {
  const empty = { violations: 0, incomplete: 0, passes: 0, impact: null, examples: [], incompleteExamples: [] };
  it('one iframe over 78 % of the window and 0 checked elements: not checked', () => {
    const axe = { ...axeResult({ 'color-contrast': empty, 'image-alt': empty, label: empty, 'link-name': empty, 'button-name': empty }), scope: { frameset: false, frames: 1, largestFrameShare: 0.78 }, images: { described: 0, decorative: 0 }, lowestContrast: { violation: null, pass: null } };
    expect(analyzeAccessibility(shopCapture({ axe })).status).toBe('not-checked');
    const r = report(shopCapture({ axe }));
    expect(r.sections.accessibility.status).toBe('not-checked');
    expect(r.measures.filter((m) => m.id === 'lowest-contrast' || m.id === 'images-described').map((m) => m.result)).toEqual(['not-checked', 'not-checked']);
  });

  it('an iframe over 96 % with three links in the header: no row "erfüllt", and a manual check for the frame', () => {
    const pass = { ratio: 12, expected: '4.5:1', fgColor: '#000', bgColor: '#fff', fontSize: '12pt', fontWeight: 'normal', messageKey: null };
    const axe = { ...axeResult({ 'color-contrast': { ...empty, passes: 3 }, 'image-alt': empty, label: empty, 'link-name': { ...empty, passes: 3 }, 'button-name': empty }), scope: { frameset: false, frames: 1, largestFrameShare: 0.96 }, images: { described: 0, decorative: 0 }, lowestContrast: { violation: null, pass } };
    const r = report(shopCapture({ axe }));
    expect(r.sections.accessibility.status).toBe('checked');
    expect(measure(r, 'lowest-contrast')?.result).not.toBe('pass');
    expect(measure(r, 'images-described')?.result).not.toBe('pass');
    expect(r.findings.find((f) => f.id === 'a11y:frame-content')).toMatchObject({ kind: 'manual', textId: 'a11y-frame-not-checked', params: { share: 96 } });
  });

  it('control: a small embed does not change anything', () => {
    const axe = { ...axeResult(), scope: { frameset: false, frames: 1, largestFrameShare: 0.2 } };
    const r = report(shopCapture({ axe }));
    expect(r.findings.some((f) => f.id === 'a11y:frame-content')).toBe(false);
  });
});
