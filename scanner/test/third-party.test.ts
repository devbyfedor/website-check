import { describe, expect, it } from 'vitest';
import { analyzeThirdParty, type DetectedService, type ThirdPartyAnalysis } from '../src/analyzers/third-party.ts';
import type { Capture } from '../src/capture/types.ts';
import { loadTestRules, makeCapture, SITE, type RequestInput } from './helpers.ts';

const rules = loadTestRules();
const doc: RequestInput = { url: SITE, resourceType: 'document', isNavigation: true };

function analyze(requests: RequestInput[], extra: Partial<Omit<Capture, 'requests'>> = {}): ThirdPartyAnalysis {
  return analyzeThirdParty(makeCapture({ requests: [doc, ...requests], ...extra }), rules);
}

function service(analysis: ThirdPartyAnalysis, key: string): DetectedService {
  const found = analysis.services.find((s) => s.key === key);
  if (found === undefined) throw new Error(`service ${key} not found; have ${analysis.services.map((s) => s.key).join(', ')}`);
  return found;
}

const keys = (analysis: ThirdPartyAnalysis): string[] => analysis.services.map((s) => s.key).sort();

describe('first party', () => {
  it('treats the registrable domain and its subdomains as first party', () => {
    const analysis = analyze([
      { url: 'https://www.example.de/wp-content/themes/x/style.css', resourceType: 'stylesheet' },
      { url: 'https://cdn.example.de/img/logo.png', resourceType: 'image' },
      { url: 'https://example.de/favicon.ico', resourceType: 'image' },
    ]);
    expect(analysis.firstPartySites).toEqual(['example.de']);
    expect(analysis.counts.firstPartyRequests).toBe(4);
    expect(analysis.counts.thirdPartyRequests).toBe(0);
    expect(analysis.services).toEqual([]);
  });

  it('treats domains of the redirect chain as first party', () => {
    const analysis = analyzeThirdParty(
      makeCapture({
        requestedUrl: 'http://example-alt.de/',
        mainDocument: { status: 200, headers: {}, redirectChain: [{ url: 'http://example-alt.de/', status: 301 }] },
        requests: [doc, { url: 'https://example-alt.de/img.png', resourceType: 'image' }],
      }),
      rules,
    );
    expect(analysis.firstPartySites).toEqual(['example-alt.de', 'example.de']);
    expect(analysis.counts.firstPartyRequests).toBe(2);
  });

  it('ignores data: and blob: requests', () => {
    const analysis = analyze([{ url: 'data:image/png;base64,AAAA' }, { url: 'blob:https://www.example.de/1' }]);
    expect(analysis.counts.ignoredRequests).toBe(2);
    expect(analysis.services).toEqual([]);
  });
});

describe('Google Fonts (precedent)', () => {
  const css = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap';
  const font = 'https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0B4gaVI.woff2';

  it('is a finding with the address and time of every request as evidence', () => {
    const analysis = analyze([
      { url: css, resourceType: 'stylesheet', startMs: 120, initiator: { type: 'parser', url: SITE } },
      { url: font, resourceType: 'font', startMs: 180, initiator: { type: 'parser', url: css } },
    ]);
    const gf = service(analysis, 'google-fonts');
    expect(gf).toMatchObject({
      known: true,
      name: 'Google Fonts',
      riskClass: 'precedent',
      severity: 'finding',
      confirmed: true,
      requestCount: 2,
      firstStartMs: 120,
      hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
      includes: [],
    });
    expect(gf.evidence.map((e) => [e.url, e.startMs])).toEqual([
      [css, 120],
      [font, 180],
    ]);
    expect(gf.evidence.every((e) => e.via === null && e.reachedServer)).toBe(true);
  });

  it('stays a finding when a first-party stylesheet imports it', () => {
    const theme = 'https://www.example.de/wp-content/themes/x/style.css';
    const analysis = analyze([
      { url: theme, resourceType: 'stylesheet' },
      { url: css, resourceType: 'stylesheet', initiator: { type: 'parser', url: theme } },
    ]);
    expect(service(analysis, 'google-fonts').severity).toBe('finding');
  });

  it('stays a finding when a stylesheet from a public CDN imports it', () => {
    const cdnCss = 'https://cdn.jsdelivr.net/npm/some-theme@1.0.0/dist/style.css';
    const analysis = analyze([
      { url: cdnCss, resourceType: 'stylesheet', initiator: { type: 'parser', url: SITE } },
      { url: css, resourceType: 'stylesheet', initiator: { type: 'parser', url: cdnCss } },
      { url: font, resourceType: 'font', initiator: { type: 'parser', url: css } },
    ]);
    expect(service(analysis, 'google-fonts')).toMatchObject({ severity: 'finding', requestCount: 2 });
    expect(service(analysis, 'jsdelivr')).toMatchObject({ severity: 'hint', riskClass: 'grey-zone', requestCount: 1 });
  });

  it('stays a finding when a stylesheet of an unknown host imports it', () => {
    const theme = 'https://assets.baukasten-cdn.de/theme/main.css';
    const analysis = analyze([
      { url: theme, resourceType: 'stylesheet', initiator: { type: 'parser', url: SITE } },
      { url: css, resourceType: 'stylesheet', initiator: { type: 'parser', url: theme } },
    ]);
    expect(service(analysis, 'google-fonts').severity).toBe('finding');
    expect(service(analysis, 'unknown:baukasten-cdn.de')).toMatchObject({ known: false, severity: 'hint', riskClass: 'grey-zone' });
  });

  it('is part of Google Maps when the Maps script loads it', () => {
    const mapsJs = 'https://maps.googleapis.com/maps/api/js?key=abc&callback=initMap';
    const mapsCss = 'https://fonts.googleapis.com/css?family=Roboto:300,400,500,700|Google+Sans:400,500,700';
    const analysis = analyze([
      { url: mapsJs, resourceType: 'script', startMs: 100, initiator: { type: 'parser', url: SITE } },
      { url: mapsCss, resourceType: 'stylesheet', startMs: 300, initiator: { type: 'script', url: mapsJs } },
      { url: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2', resourceType: 'font', startMs: 350, initiator: { type: 'parser', url: mapsCss } },
      { url: 'https://maps.gstatic.com/mapfiles/openhand_8_8.cur', resourceType: 'other', startMs: 400, initiator: { type: 'script', url: mapsJs } },
    ]);
    expect(keys(analysis)).toEqual(['google-maps']);
    const maps = service(analysis, 'google-maps');
    expect(maps).toMatchObject({ severity: 'finding', riskClass: 'usually-consent', requestCount: 4, includes: [{ serviceId: 'google-fonts', requestCount: 2 }] });
    expect(maps.evidence[1]).toMatchObject({ url: mapsCss, via: { kind: 'initiator', url: mapsJs }, ownServiceId: 'google-fonts' });
    expect(maps.evidence[2]?.via).toEqual({ kind: 'initiator', url: mapsCss });
  });

  it('stays a finding when an app of another provider loads it, and names the app as initiator', () => {
    const klaviyo = 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=AbC123';
    const formCss = 'https://fonts.googleapis.com/css2?family=Cormorant&family=Montserrat';
    const analysis = analyze([
      { url: klaviyo, resourceType: 'script', initiator: { type: 'parser', url: SITE } },
      { url: formCss, resourceType: 'stylesheet', initiator: { type: 'script', url: klaviyo } },
      { url: 'https://fonts.gstatic.com/s/montserrat/v26/x.woff2', resourceType: 'font', initiator: { type: 'parser', url: formCss } },
    ]);
    expect(keys(analysis)).toEqual(['google-fonts', 'klaviyo-onsite']);
    const gf = service(analysis, 'google-fonts');
    expect(gf).toMatchObject({ severity: 'finding', requestCount: 2 });
    expect(gf.evidence[0]).toMatchObject({ url: formCss, via: null, initiatorUrl: klaviyo });
    expect(service(analysis, 'klaviyo-onsite')).toMatchObject({ severity: 'hint', requestCount: 1, includes: [] });
  });

  it('stays a finding when a script of an unknown third party loads it', () => {
    const widget = 'https://widget.bewertungen-beispiel.de/v2/widget.js';
    const widgetCss = 'https://fonts.googleapis.com/css?family=Montserrat';
    const analysis = analyze([
      { url: widget, resourceType: 'script', initiator: { type: 'parser', url: SITE } },
      { url: widgetCss, resourceType: 'stylesheet', initiator: { type: 'script', url: widget } },
      { url: 'https://fonts.gstatic.com/s/montserrat/v26/x.woff2', resourceType: 'font', initiator: { type: 'parser', url: widgetCss } },
    ]);
    expect(keys(analysis)).toEqual(['google-fonts', 'unknown:bewertungen-beispiel.de']);
    expect(service(analysis, 'google-fonts')).toMatchObject({ severity: 'finding', requestCount: 2 });
    expect(service(analysis, 'unknown:bewertungen-beispiel.de')).toMatchObject({ severity: 'hint', requestCount: 1, includes: [] });
  });
});

describe('iframes', () => {
  it('attributes everything inside a Google Maps iframe to Google Maps', () => {
    const embed = 'https://www.google.com/maps/embed?pb=!1m18!1m12';
    const analysis = analyze([
      { url: embed, resourceType: 'document', isNavigation: true, isMainFrame: false, initiator: { type: 'parser', url: SITE } },
      { url: 'https://fonts.googleapis.com/css?family=Roboto', resourceType: 'stylesheet', isMainFrame: false, frameUrls: [embed] },
      { url: 'https://maps.gstatic.com/maps-api-v3/embed/js/x.js', resourceType: 'script', isMainFrame: false, frameUrls: [embed] },
      { url: 'https://www.gstatic.com/images/branding/x.png', resourceType: 'image', isMainFrame: false, frameUrls: [embed] },
    ]);
    expect(keys(analysis)).toEqual(['google-maps']);
    expect(service(analysis, 'google-maps')).toMatchObject({
      requestCount: 4,
      includes: [
        { serviceId: 'google-fonts', requestCount: 1 },
        { serviceId: 'google-other', requestCount: 1 },
      ],
    });
    expect(service(analysis, 'google-maps').evidence[1]?.via).toEqual({ kind: 'frame', url: embed });
  });

  it('uses the outermost third-party frame for nested frames', () => {
    const video = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    const adFrame = 'https://tpc.googlesyndication.com/sodar/sodar2/225/runner.html';
    const analysis = analyze([
      { url: video, resourceType: 'document', isNavigation: true, isMainFrame: false },
      { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', resourceType: 'image', isMainFrame: false, frameUrls: [video] },
      { url: 'https://googleads.g.doubleclick.net/pagead/id', resourceType: 'fetch', isMainFrame: false, frameUrls: [video] },
      { url: 'https://www.google.com/pagead/lvz?x=1', resourceType: 'fetch', isMainFrame: false, frameUrls: [adFrame, video] },
    ]);
    expect(keys(analysis)).toEqual(['youtube']);
    const yt = service(analysis, 'youtube');
    expect(yt.requestCount).toBe(4);
    expect(yt.includes).toEqual([
      { serviceId: 'doubleclick', requestCount: 1 },
      { serviceId: 'google-other', requestCount: 1 },
    ]);
    expect(yt.evidence.find((e) => e.url.startsWith('https://i.ytimg.com'))?.via).toBeNull();
  });

  it('ignores first-party frames when looking for the embedding service', () => {
    const ownFrame = 'https://www.example.de/widgets/frame.html';
    const analysis = analyze([{ url: 'https://fonts.googleapis.com/css?family=Lato', resourceType: 'stylesheet', isMainFrame: false, frameUrls: [ownFrame] }]);
    expect(service(analysis, 'google-fonts').severity).toBe('finding');
  });
});

describe('tag managers and analytics', () => {
  it('lists the tag manager and the tools it loads separately', () => {
    const gtm = 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123';
    const ga = 'https://www.google-analytics.com/analytics.js';
    const analysis = analyze([
      { url: gtm, resourceType: 'script', startMs: 200, initiator: { type: 'script', url: SITE } },
      { url: ga, resourceType: 'script', startMs: 400, initiator: { type: 'script', url: gtm } },
      { url: 'https://region1.google-analytics.com/g/collect?v=2&tid=G-XYZ', resourceType: 'ping', startMs: 600, initiator: { type: 'script', url: ga } },
    ]);
    expect(keys(analysis)).toEqual(['google-analytics', 'google-tag-manager']);
    expect(service(analysis, 'google-tag-manager')).toMatchObject({ severity: 'finding', riskClass: 'consent-required', requestCount: 1 });
    expect(service(analysis, 'google-analytics')).toMatchObject({ severity: 'finding', requestCount: 2, firstStartMs: 400, includes: [] });
  });

  it('attributes requests that an analytics script triggers to that script', () => {
    const ga = 'https://www.google-analytics.com/analytics.js';
    const analysis = analyze([
      { url: ga, resourceType: 'script', initiator: { type: 'parser', url: SITE } },
      { url: 'https://stats.g.doubleclick.net/j/collect?t=dc', resourceType: 'xhr', initiator: { type: 'script', url: ga } },
    ]);
    expect(keys(analysis)).toEqual(['google-analytics']);
    expect(service(analysis, 'google-analytics').includes).toEqual([{ serviceId: 'doubleclick', requestCount: 1 }]);
  });
});

describe('confirmation and classes', () => {
  it('makes a service a hint when none of its requests reached a server', () => {
    const analysis = analyze([{ url: 'https://www.google-analytics.com/ga.js', resourceType: 'script', status: null, failure: 'net::ERR_NAME_NOT_RESOLVED' }]);
    expect(service(analysis, 'google-analytics')).toMatchObject({ severity: 'hint', confirmed: false, riskClass: 'consent-required' });
    expect(analysis.counts.findings).toBe(0);
    expect(analysis.counts.hints).toBe(1);
  });

  it('counts a response blocked by the browser as reaching the server', () => {
    const analysis = analyze([{ url: 'https://fonts.gstatic.com/s/x.woff2', resourceType: 'font', status: null, failure: 'net::ERR_BLOCKED_BY_ORB' }]);
    expect(service(analysis, 'google-fonts')).toMatchObject({ severity: 'finding', confirmed: true });
  });

  it('shows consent tools and platform files as not flagged', () => {
    const analysis = analyze([
      { url: 'https://consent.cookiebot.com/uc.js', resourceType: 'script' },
      { url: 'https://cdn.shopify.com/s/files/1/theme.css', resourceType: 'stylesheet' },
    ]);
    expect(service(analysis, 'cookiebot').severity).toBe('none');
    expect(service(analysis, 'shopify-cdn').severity).toBe('none');
    expect(analysis.counts).toMatchObject({ findings: 0, hints: 0, services: 2 });
  });

  it('groups unknown third parties by registrable domain', () => {
    const analysis = analyze([
      { url: 'https://api.chat-beispiel.de/v1/init', resourceType: 'fetch' },
      { url: 'https://static.chat-beispiel.de/widget.js', resourceType: 'script' },
    ]);
    expect(service(analysis, 'unknown:chat-beispiel.de')).toMatchObject({
      known: false,
      name: 'chat-beispiel.de',
      category: 'unknown',
      requestCount: 2,
      hosts: ['api.chat-beispiel.de', 'static.chat-beispiel.de'],
    });
  });

  it('sorts findings by risk class before hints and unflagged services', () => {
    const analysis = analyze([
      { url: 'https://consent.cookiebot.com/uc.js', startMs: 10 },
      { url: 'https://cdn.jsdelivr.net/npm/x.js', startMs: 20 },
      { url: 'https://www.youtube.com/iframe_api', startMs: 30 },
      { url: 'https://www.google-analytics.com/analytics.js', startMs: 40 },
      { url: 'https://fonts.googleapis.com/css?family=A', startMs: 50 },
    ]);
    expect(analysis.services.map((s) => s.key)).toEqual(['google-fonts', 'google-analytics', 'youtube', 'jsdelivr', 'cookiebot']);
    expect(analysis.counts.byRiskClass).toEqual({ precedent: 1, 'consent-required': 1, 'usually-consent': 1, 'grey-zone': 1, 'not-flagged': 1 });
  });
});

describe('banner timing (information only)', () => {
  const banner = { detected: true, toolId: 'cookiebot', method: 'selector' as const, selector: '#CybotCookiebotDialog', visibleAtMs: 1400, toolsInDom: ['cookiebot'] };

  it('marks services that start before the banner is visible', () => {
    const analysis = analyze(
      [
        { url: 'https://fonts.googleapis.com/css?family=A', startMs: 300 },
        { url: 'https://www.youtube.com/iframe_api', startMs: 2000 },
      ],
      { consentBanner: banner },
    );
    expect(analysis.bannerVisibleAtMs).toBe(1400);
    expect(service(analysis, 'google-fonts').startsBeforeBanner).toBe(true);
    expect(service(analysis, 'youtube').startsBeforeBanner).toBe(false);
  });

  it('never changes the severity', () => {
    const late = analyze([{ url: 'https://fonts.googleapis.com/css?family=A', startMs: 5000 }], { consentBanner: banner });
    expect(service(late, 'google-fonts').severity).toBe('finding');
  });

  it('is unknown without a detected banner', () => {
    const analysis = analyze([{ url: 'https://fonts.googleapis.com/css?family=A' }]);
    expect(service(analysis, 'google-fonts').startsBeforeBanner).toBeNull();
  });
});

describe('evidence limits', () => {
  it('keeps at most 20 evidence entries and long URLs are shortened', () => {
    const many: RequestInput[] = Array.from({ length: 25 }, (_, i) => ({ url: `https://www.google-analytics.com/g/collect?n=${i}&${'x'.repeat(600)}`, startMs: 100 + i }));
    const ga = service(analyze(many), 'google-analytics');
    expect(ga.requestCount).toBe(25);
    expect(ga.evidence).toHaveLength(20);
    expect(ga.evidenceTruncated).toBe(true);
    expect(ga.evidence[0]?.url.length).toBe(500);
  });
});
