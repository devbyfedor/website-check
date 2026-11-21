import { describe, expect, it } from 'vitest';
import { analyzeThirdParty } from '../src/analyzers/third-party.ts';
import { lowerCaseHeaders, toInitiator } from '../src/capture/cdp.ts';
import { IN_PAGE_COLLECT_EXPRESSION, RESOURCE_TIMING_INIT_SCRIPT, RESOURCE_TIMING_POLL_EXPRESSION, SNAPSHOT_EXPRESSION } from '../src/capture/page-scripts.ts';
import { requestsFromResourceTiming, resourceTypeOf, type DocumentResponse, type ResourceTimingData } from '../src/capture/resource-timing.ts';
import { CAPTURE_SETTINGS, chromeVersionOf, desktopChromeUserAgent } from '../src/capture/settings.ts';
import { loadTestRules, makeCapture } from './helpers.ts';

describe('capture settings', () => {
  it('are the settings of the local A1 run', () => {
    expect(CAPTURE_SETTINGS).toMatchObject({
      locale: 'de-DE',
      acceptLanguage: 'de-DE',
      timezoneId: 'Europe/Berlin',
      viewport: { width: 1440, height: 900 },
      maxWaitMs: 15_000,
      quietWindowMs: 1_500,
      hardLimitMs: 20_000,
    });
  });

  it('reads the Chrome version from browser product strings', () => {
    expect(chromeVersionOf('HeadlessChrome/141.0.7390.37')).toBe('141.0.7390.37');
    expect(chromeVersionOf('Chrome/159.0.1.2')).toBe('159.0.1.2');
    expect(chromeVersionOf('141.0.7390.37')).toBe('141.0.7390.37');
    expect(desktopChromeUserAgent(chromeVersionOf('HeadlessChrome/141.0.7390.37'))).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    );
  });

  it('never sends a headless user agent', () => {
    expect(desktopChromeUserAgent('141.0.1')).not.toMatch(/headless/i);
  });
});

describe('CDP helpers', () => {
  it('takes the initiator URL, else the first script on the stack', () => {
    expect(toInitiator({ type: 'parser', url: 'https://a.de/' })).toEqual({ type: 'parser', url: 'https://a.de/' });
    expect(
      toInitiator({ type: 'script', stack: { callFrames: [{ url: '' }], parent: { callFrames: [{ url: 'https://cdn.x/app.js' }] } } }),
    ).toEqual({ type: 'script', url: 'https://cdn.x/app.js' });
    expect(toInitiator({ type: 'other' })).toEqual({ type: 'other', url: null });
  });

  it('lower-cases headers from objects and from name/value lists', () => {
    expect(lowerCaseHeaders({ 'Content-Type': 'text/html', 'X-A': '1' })).toEqual({ 'content-type': 'text/html', 'x-a': '1' });
    expect(
      lowerCaseHeaders([
        { name: 'Set-Cookie', value: 'a=1' },
        { name: 'set-cookie', value: 'b=2' },
        { name: 'Strict-Transport-Security', value: 'max-age=1' },
      ]),
    ).toEqual({ 'set-cookie': 'a=1\nb=2', 'strict-transport-security': 'max-age=1' });
    expect(lowerCaseHeaders(undefined)).toEqual({});
  });
});

describe('page scripts', () => {
  it.each([
    ['snapshot', SNAPSHOT_EXPRESSION],
    ['resource timing init', RESOURCE_TIMING_INIT_SCRIPT],
    ['resource timing poll', RESOURCE_TIMING_POLL_EXPRESSION],
    ['in-page collect', IN_PAGE_COLLECT_EXPRESSION],
  ])('%s is valid JavaScript', (_name, code) => {
    expect(() => new Function(code)).not.toThrow();
  });

  it('only read the page', () => {
    for (const code of [SNAPSHOT_EXPRESSION, RESOURCE_TIMING_INIT_SCRIPT, RESOURCE_TIMING_POLL_EXPRESSION, IN_PAGE_COLLECT_EXPRESSION]) {
      expect(code).not.toMatch(/\.click\(|dispatchEvent|sendBeacon|fetch\(|XMLHttpRequest|\.submit\(|appendChild|innerHTML\s*=/);
    }
  });
});

describe('resource types from Resource Timing', () => {
  it.each([
    ['script', 'https://x.de/a.js', 'script'],
    ['img', 'https://x.de/a.png', 'image'],
    ['css', 'https://fonts.gstatic.com/s/roboto/v1/a.woff2', 'font'],
    ['css', 'https://x.de/bg.jpg', 'image'],
    ['css', 'https://x.de/import.css', 'stylesheet'],
    ['link', 'https://fonts.googleapis.com/css2?family=Roboto', 'stylesheet'],
    ['link', 'https://fonts.googleapis.com/css?family=Roboto', 'stylesheet'],
    ['link', 'https://x.de/a.css?v=2', 'stylesheet'],
    ['link', 'https://x.de/font.woff2', 'font'],
    ['link', 'https://x.de/app.js', 'script'],
    ['link', 'https://x.de/manifest.json', 'other'],
    ['iframe', 'https://www.youtube-nocookie.com/embed/1', 'document'],
    ['xmlhttprequest', 'https://x.de/api', 'xhr'],
    ['fetch', 'https://x.de/api', 'fetch'],
    ['beacon', 'https://x.de/collect', 'ping'],
    ['video', 'https://x.de/a.mp4', 'media'],
    ['other', 'https://x.de/a', 'other'],
  ])('%s %s is %s', (initiatorType, url, expected) => {
    expect(resourceTypeOf(initiatorType, url)).toBe(expected);
  });
});

function timing(resources: ResourceTimingData['resources']): ResourceTimingData {
  return {
    timeOrigin: 1_700_000_000_000,
    now: 5000,
    collector: true,
    navigation: {
      name: 'https://www.example.de/',
      startTime: 0,
      fetchStart: 120,
      responseEnd: 300,
      domContentLoadedEventStart: 700,
      loadEventStart: 1500,
      responseStatus: 200,
      redirectCount: 0,
      type: 'navigate',
    },
    resources,
  };
}

const entry = (name: string, initiatorType: string, startTime: number, responseStatus = 200): ResourceTimingData['resources'][number] => ({
  name,
  initiatorType,
  startTime,
  responseEnd: startTime + 50,
  responseStatus,
  transferSize: 0,
  decodedBodySize: 0,
  nextHopProtocol: 'h2',
});

describe('requests from Resource Timing', () => {
  const documents: DocumentResponse[] = [
    { url: 'https://example.de/', method: 'GET', status: 301, headers: { location: 'https://www.example.de/' }, atMs: 40, redirectedFrom: null },
    { url: 'https://www.example.de/', method: 'GET', status: 200, headers: { 'content-type': 'text/html' }, atMs: 280, redirectedFrom: 'https://example.de/' },
  ];

  it('puts the main documents first, then the entries in start order', () => {
    const requests = requestsFromResourceTiming(
      documents,
      timing([
        entry('https://www.example.de/b.js', 'script', 900),
        entry('https://fonts.googleapis.com/css2?family=Roboto', 'link', 400),
        entry('data:image/png;base64,AAAA', 'img', 500),
        entry('https://www.youtube-nocookie.com/embed/1', 'iframe', 950),
      ]),
    );
    expect(requests.map((r) => [r.seq, r.url, r.resourceType, r.startMs])).toEqual([
      [0, 'https://example.de/', 'document', 40],
      [1, 'https://www.example.de/', 'document', 280],
      [2, 'https://fonts.googleapis.com/css2?family=Roboto', 'stylesheet', 400],
      [3, 'https://www.example.de/b.js', 'script', 900],
      [4, 'https://www.youtube-nocookie.com/embed/1', 'document', 950],
    ]);
    expect(requests[1]).toMatchObject({ status: 200, isMainFrame: true, isNavigation: true, redirectedFrom: 'https://example.de/', endMs: 300 });
    expect(requests[4]).toMatchObject({ isMainFrame: false, frameUrls: ['https://www.youtube-nocookie.com/embed/1'], isNavigation: true });
    expect(requests[3]).toMatchObject({ initiator: null, failure: null, endMs: 950, method: 'GET' });
  });

  it('keeps a missing status as null', () => {
    const [request] = requestsFromResourceTiming([], timing([entry('https://x.de/a.js', 'script', 10, 0)]));
    expect(request?.status).toBeNull();
  });

  it('gives captures the analyzer can read', () => {
    const requests = requestsFromResourceTiming(documents, timing([entry('https://fonts.googleapis.com/css2?family=Roboto', 'link', 400)]));
    const capture = makeCapture({
      requests: [],
      requestedUrl: 'https://example.de/',
      finalUrl: 'https://www.example.de/',
    });
    const analysis = analyzeThirdParty({ ...capture, requests }, loadTestRules());
    expect(analysis.counts.firstPartyRequests).toBe(2);
    expect(analysis.services.map((s) => s.serviceId)).toContain('google-fonts');
  });
});
