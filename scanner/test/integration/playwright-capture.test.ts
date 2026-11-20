import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeThirdParty } from '../../src/analyzers/third-party.ts';
import type { Capture } from '../../src/capture/types.ts';
import { compileRules, parseRulesFile } from '../../src/rules/match.ts';
import { captureWithPlaywright, launchLocalBrowser } from '../../src/local/playwright-capture.ts';
import { startFixtureServer, type FixtureServer } from './fixture-server.ts';

const HOST_RULES = '--host-resolver-rules=MAP nx.test ~NOTFOUND, MAP *.test 127.0.0.1';

const fixtureRules = compileRules(
  parseRulesFile({
    version: 1,
    updated: '2026-11-20',
    services: [
      { id: 'test-fonts', name: 'Test Fonts', provider: 'Test', category: 'fonts', riskClass: 'precedent', dataLocation: 'unknown', hosts: ['fonts.thirdparty.test', 'fontfiles.thirdparty.test'], sources: ['test'] },
      { id: 'test-tracker', name: 'Test Tracker', provider: 'Test', category: 'analytics', riskClass: 'consent-required', dataLocation: 'unknown', hosts: ['tracker.thirdparty.test'], sources: ['test'] },
      { id: 'test-video', name: 'Test Video', provider: 'Test', category: 'video', riskClass: 'usually-consent', dataLocation: 'unknown', hosts: ['video.thirdparty.test'], sources: ['test'] },
      { id: 'test-ads', name: 'Test Ads', provider: 'Test', category: 'advertising', riskClass: 'consent-required', dataLocation: 'unknown', hosts: ['ads.adnetwork.test'], sources: ['test'] },
    ],
  }),
);

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await launchLocalBrowser([HOST_RULES]);
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('captureWithPlaywright on a fixture shop page', () => {
  let capture: Capture;
  let html: string | null;
  let screenshot: Buffer | null;

  beforeAll(async () => {
    ({ capture, html, screenshot } = await captureWithPlaywright(browser, server.url('www.shop.test', '/start'), { artifacts: true }));
  });

  it('captures the page after following the redirect', () => {
    expect(capture.ok).toBe(true);
    expect(capture.failure).toBeNull();
    expect(capture.finalUrl).toBe(server.url('www.shop.test', '/'));
    expect(capture.mainDocument?.status).toBe(200);
    expect(capture.mainDocument?.redirectChain).toEqual([{ url: server.url('www.shop.test', '/start'), status: 301 }]);
    expect(capture.mainDocument?.headers['x-fixture']).toBe('shop-home');
    expect(capture.mainDocument?.headers['strict-transport-security']).toBe('max-age=1');
  });

  it('uses the configured environment and a normal Chrome user agent', () => {
    expect(capture.environment).toMatchObject({ locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } });
    expect(capture.environment.userAgent).toMatch(/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\).* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(capture.environment.userAgent).not.toMatch(/Headless/i);
  });

  it('records every request with time, status, frame and initiator', () => {
    const byUrl = (part: string) => capture.requests.find((r) => r.url.includes(part));
    const font = byUrl('fontfiles.thirdparty.test');
    const css = byUrl(server.url('fonts.thirdparty.test', '/css'));
    const pixel = byUrl('ads.adnetwork.test');
    const beacon = byUrl('tracker.thirdparty.test:' + server.port + '/collect');
    expect(capture.requests.length).toBeGreaterThanOrEqual(10);
    expect(capture.requests.map((r) => r.seq)).toEqual(capture.requests.map((_, i) => i));
    expect(css).toMatchObject({ status: 200, resourceType: 'stylesheet', isMainFrame: true, frameUrls: [] });
    expect(font?.initiator?.url).toBe(css?.url);
    expect(pixel?.isMainFrame).toBe(false);
    expect(pixel?.frameUrls).toEqual([server.url('video.thirdparty.test', '/embed/1')]);
    expect(beacon?.status).toBe(204);
    expect(beacon?.startMs ?? 0).toBeGreaterThan(css?.startMs ?? Infinity);
    for (const request of capture.requests) {
      expect(request.startMs).toBeGreaterThanOrEqual(0);
      expect(request.startMs).toBeLessThan(15_000);
    }
  });

  it('detects the consent banner and when it became visible', () => {
    expect(capture.consentBanner).toMatchObject({ detected: true, toolId: 'cookiebot', method: 'selector', selector: '#CybotCookiebotDialog' });
    expect(capture.consentBanner.visibleAtMs ?? 0).toBeGreaterThanOrEqual(800);
    expect(capture.consentBanner.visibleAtMs ?? Infinity).toBeLessThan(5_000);
  });

  it('stops when the network is quiet', () => {
    expect(capture.timings.stopReason).toBe('network-quiet');
    expect(capture.timings.loadMs).not.toBeNull();
    expect(capture.timings.endMs).toBeLessThan(10_000);
  });

  it('collects page text, links, language, HTML and a screenshot', () => {
    expect(capture.page?.lang).toBe('de');
    expect(capture.page?.text).toContain('Willkommen');
    expect(capture.page?.links).toContainEqual({ href: server.url('www.shop.test', '/impressum'), text: 'Impressum' });
    expect(html).toContain('CybotCookiebotDialog');
    expect(screenshot?.subarray(1, 4).toString()).toBe('PNG');
  });

  it('feeds the analyzer: fonts and tracker are findings, the iframe owns the ad pixel', () => {
    const analysis = analyzeThirdParty(capture, fixtureRules);
    expect(analysis.firstPartySites).toEqual(['shop.test']);
    const keys = analysis.services.map((s) => s.key).sort();
    expect(keys).toEqual(['test-fonts', 'test-tracker', 'test-video']);
    expect(analysis.services.find((s) => s.key === 'test-fonts')).toMatchObject({ severity: 'finding', requestCount: 2, startsBeforeBanner: true });
    expect(analysis.services.find((s) => s.key === 'test-video')?.includes).toEqual([{ serviceId: 'test-ads', requestCount: 1 }]);
  });
});

describe('captureWithPlaywright limits and failures', () => {
  it('stops a page that never gets quiet at maxWaitMs', async () => {
    const { capture } = await captureWithPlaywright(browser, server.url('www.busy.test'), { maxWaitMs: 3_000 });
    expect(capture.ok).toBe(true);
    expect(capture.timings.stopReason).toBe('max-wait');
    expect(capture.timings.endMs).toBeGreaterThanOrEqual(3_000);
    expect(capture.timings.endMs).toBeLessThan(8_000);
  });

  it('reports a host that does not exist as an invalid address', async () => {
    const { capture } = await captureWithPlaywright(browser, 'http://nx.test/');
    expect(capture.ok).toBe(false);
    expect(capture.failure?.reason).toBe('invalid-address');
    expect(capture.finalUrl).toBeNull();
  });

  it('reports a challenge page as blocked and a server error as http-error', async () => {
    const blocked = await captureWithPlaywright(browser, server.url('www.blocked.test'));
    expect(blocked.capture.failure).toMatchObject({ reason: 'blocked', status: 403 });
    const broken = await captureWithPlaywright(browser, server.url('www.broken.test'));
    expect(broken.capture.failure).toMatchObject({ reason: 'http-error', status: 500 });
  });
});
