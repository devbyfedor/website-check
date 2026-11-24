import { describe, expect, it } from 'vitest';
import { analyzePlatform } from '../src/analyzers/platform.ts';
import { analyzeThirdParty, type ThirdPartyAnalysis } from '../src/analyzers/third-party.ts';
import { frameUnknown } from '../src/capture/frames.ts';
import type { Capture } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { makeCapture, type RequestInput } from './helpers.ts';

/**
 * Session fix-a1, review findings 1 and 17: a request whose document the adapter does not know (an
 * iframe whose address was lost, a CORS preflight, a web worker) is never a finding of the site itself.
 * The request shapes are the ones the Cloudflare adapter produced in the review's reproduction, with
 * invented sites and the real rules data.
 */

const SITE = 'https://www.beispiel-handwerk.example/';
const doc: RequestInput = { url: SITE, resourceType: 'document', isNavigation: true };

function cloud(requests: RequestInput[], extra: Partial<Omit<Capture, 'requests'>> = {}): Capture {
  return makeCapture({
    adapter: 'cloudflare-browser-run',
    strategy: 'cdp-events',
    requestedUrl: SITE,
    finalUrl: SITE,
    requests: [doc, ...requests.map((r) => ({ isMainFrame: false, ...r }))],
    ...extra,
  });
}

const list = (analysis: ThirdPartyAnalysis): string[] => analysis.services.map((s) => `${s.key}=${s.severity}`);

function report(capture: Capture) {
  const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T10:00:00.000Z', siteUrl: SITE, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.0.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(built.report)).toEqual([]);
  return built.report;
}

const WIDGET = 'https://forms.widget-anbieter.example/embed';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter';

describe('finding 1: Google Fonts of a third-party widget whose iframe address was lost', () => {
  const widgetDoc: RequestInput = { url: WIDGET, resourceType: 'document', isNavigation: true, frameKnown: true, initiator: { type: 'parser', url: SITE } };

  it('with the iframe address the widget owns its requests: one hint, no finding', () => {
    const analysis = analyzeThirdParty(cloud([widgetDoc, { url: FONTS, resourceType: 'stylesheet', frameUrls: [WIDGET], frameKnown: true }]), DEFAULT_RULES);
    expect(list(analysis)).toEqual(['unknown:widget-anbieter.example=hint']);
  });

  it('without it the request is no finding of the site: a hint to check by hand, no risk, no fix', () => {
    const capture = cloud([widgetDoc, { url: FONTS, resourceType: 'stylesheet', frameUrls: [], frameKnown: false, initiator: { type: 'parser', url: WIDGET } }]);
    const analysis = analyzeThirdParty(capture, DEFAULT_RULES);
    const fonts = analysis.services.find((s) => s.key === 'google-fonts');
    expect(fonts).toMatchObject({ severity: 'hint', confirmed: true, frameUnknown: true, riskClass: 'precedent' });
    expect(fonts?.evidence[0]?.frameKnown).toBe(false);
    expect(analysis.counts.findings).toBe(0);
    const r = report(capture);
    expect(r.findings.find((f) => f.id === 'third-party:google-fonts')).toMatchObject({ kind: 'hint', risk: null, textId: 'third-party-frame-unknown', fixTextId: null });
    expect(r.priorities).not.toContain('third-party:google-fonts');
    expect(r.counts.findings).toBe(r.findings.filter((f) => f.kind === 'finding' && f.area !== 'privacy').length);
    expect(r.services.find((s) => s.key === 'google-fonts')).toMatchObject({ severity: 'hint', consent: 'manual' });
    expect(r.measures.find((m) => m.id === 'third-party-before-consent')).toMatchObject({ actual: { type: 'count', count: 0 } });
  });

  it('a capture saved before the adapter recorded `frameKnown` is read the same way', () => {
    const { frameKnown: _dropped, ...oldWidgetDoc } = widgetDoc;
    const capture = cloud([oldWidgetDoc, { url: FONTS, resourceType: 'stylesheet', frameUrls: [], initiator: { type: 'parser', url: WIDGET } }]);
    expect(capture.requests.map((r) => frameUnknown(capture, r))).toEqual([false, false, true]);
    expect(report(capture).findings.find((f) => f.id === 'third-party:google-fonts')).toMatchObject({ kind: 'hint', risk: null, textId: 'third-party-frame-unknown' });
  });

  it('a request of the page itself stays a finding, and so does a service seen from both', () => {
    const own = cloud([{ url: FONTS, resourceType: 'stylesheet', isMainFrame: true, frameKnown: true }]);
    expect(report(own).findings.find((f) => f.id === 'third-party:google-fonts')).toMatchObject({ kind: 'finding', risk: 'high', textId: 'third-party-precedent' });
    const both = cloud([
      { url: FONTS, resourceType: 'stylesheet', isMainFrame: true, frameKnown: true },
      { url: 'https://fonts.gstatic.com/s/inter/v1/inter.woff2', resourceType: 'font', frameUrls: [], frameKnown: false },
    ]);
    expect(analyzeThirdParty(both, DEFAULT_RULES).services.find((s) => s.key === 'google-fonts')).toMatchObject({ severity: 'finding', frameUnknown: false, requestCount: 2 });
  });

  it('the local adapter is not affected: Playwright names the document of its requests', () => {
    const local = makeCapture({ requestedUrl: SITE, finalUrl: SITE, requests: [doc, { url: FONTS, resourceType: 'stylesheet', isMainFrame: false, frameUrls: [] }] });
    expect(local.requests.map((r) => frameUnknown(local, r))).toEqual([false, false]);
    expect(analyzeThirdParty(local, DEFAULT_RULES).counts.findings).toBe(1);
  });
});

describe('finding 17: CORS preflight and web worker requests without a frame', () => {
  it('a preflight of a widget iframe is no separate finding (tracker of the rules data)', () => {
    const frame = 'https://widget.termin-anbieter.example/embed/123';
    const post = 'https://a.klaviyo.com/client/events/?company_id=AbC123';
    const frameDoc: RequestInput = { url: frame, resourceType: 'document', isNavigation: true, initiator: { type: 'parser', url: SITE } };
    const real: RequestInput = { url: post, method: 'POST', resourceType: 'fetch', frameUrls: [frame], initiator: { type: 'script', url: frame } };
    const preflight: RequestInput = { url: post, method: 'OPTIONS', resourceType: 'other', status: 204, initiator: { type: 'preflight', url: post } };
    const framed = analyzeThirdParty(cloud([frameDoc, real]), DEFAULT_RULES);
    expect(framed.counts.findings).toBe(0);
    // As the old adapter saved it (no frame for the preflight) and as the new one marks a preflight it cannot place.
    for (const lost of [preflight, { ...preflight, frameKnown: false }]) {
      const analysis = analyzeThirdParty(cloud([frameDoc, real, lost]), DEFAULT_RULES);
      expect(analysis.services.filter((s) => s.severity === 'finding')).toEqual([]);
    }
    // Placed by the adapter (the frame of the request it belongs to): it belongs to the widget like that request.
    const placed = analyzeThirdParty(cloud([{ ...frameDoc, frameKnown: true }, { ...real, frameKnown: true }, { ...preflight, frameUrls: [frame], frameKnown: true }]), DEFAULT_RULES);
    expect(list(placed)).toEqual(list(framed));
  });

  it('a worker of a video iframe that loads Google Fonts gives no Google Fonts finding', () => {
    const frame = 'https://player.vimeo.com/video/1';
    const script = 'https://player.vimeo.com/worker.js';
    const requests = (frameUrls: string[], frameKnown?: boolean): RequestInput[] => [
      { url: frame, resourceType: 'document', isNavigation: true },
      { url: script, resourceType: 'script', frameUrls: [frame] },
      { url: FONTS, resourceType: 'fetch', frameUrls, initiator: { type: 'script', url: script }, ...(frameKnown === undefined ? {} : { frameKnown }) },
    ];
    const kept = analyzeThirdParty(cloud(requests([frame])), DEFAULT_RULES);
    expect(kept.services.find((s) => s.key === 'google-fonts')).toBeUndefined();
    for (const lost of [requests([]), requests([], false)]) {
      const analysis = analyzeThirdParty(cloud(lost), DEFAULT_RULES);
      expect(analysis.services.find((s) => s.key === 'google-fonts')).toMatchObject({ severity: 'hint', frameUnknown: true });
      expect(analysis.counts.findings).toBe(kept.counts.findings);
    }
  });

  it('a preflight alone to a host without a rule stays a hint, and a preflight of the page itself counts for the page', () => {
    const post = 'https://api.video-attest.example/v1/create';
    const lonely = analyzeThirdParty(cloud([{ url: post, method: 'OPTIONS', resourceType: 'other', status: 200, frameKnown: false, initiator: { type: 'preflight', url: post } }]), DEFAULT_RULES);
    expect(list(lonely)).toEqual(['unknown:video-attest.example=hint']);
    const tracker = 'https://region1.google-analytics.com/g/collect?v=2';
    const own = analyzeThirdParty(cloud([{ url: tracker, method: 'OPTIONS', resourceType: 'other', status: 204, isMainFrame: true, frameKnown: true }]), DEFAULT_RULES);
    expect(own.counts.findings).toBe(1);
  });

  it('platform detection ignores a request whose document is unknown', () => {
    const frame = 'https://buchung.fremde-seite.example/';
    const url = 'https://static.parastorage.com/services/wix-thunderbolt/dist/clientWorker.abc.bundle.min.js';
    // Session fix-a6 (review finding 75): two files of the system, since one file alone names no system.
    const second = (request: RequestInput): RequestInput => ({ ...request, url: request.url.replace('clientWorker', 'thunderbolt') });
    const system = (request: RequestInput): string => analyzePlatform(cloud([{ url: frame, resourceType: 'document', isNavigation: true }, request, second(request)])).system;
    expect(system({ url, resourceType: 'script', isMainFrame: true, frameKnown: true })).toBe('wix');
    expect(system({ url, resourceType: 'script', frameUrls: [frame] })).toBe('unknown');
    expect(system({ url, resourceType: 'script', frameUrls: [] })).toBe('unknown');
    expect(system({ url, resourceType: 'script', frameUrls: [], frameKnown: false })).toBe('unknown');
  });
});
