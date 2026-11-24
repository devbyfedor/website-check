import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from '@cloudflare/puppeteer';
import { analyzeThirdParty, buildReport, compileRules, createUrlGuard, parseRulesFile, validateReport, type Capture, type Report } from '@website-check/scanner';
import { BROWSER_LOST, captureWithCdpEvents } from '../../src/capture/cdp-events.ts';
import type { CloudCaptureOptions } from '../../src/capture/common.ts';
import { loadAxeSource } from '../../../scanner/src/local/axe-source.ts';
import { startCdpFixture, type CdpFixture } from './cdp-fixture.ts';
import { HOSTILE_AXE_PAGES, HOSTILE_AXE_VIOLATIONS } from '../../../scanner/test/integration/hostile-a6-pages.ts';

/**
 * Session fix-a1: the review's reproductions of findings 1, 2 and 17 as tests of the Cloudflare adapter
 * itself, on the local Chromium (see `cdp-fixture.ts`). Every test failed before the fix:
 * - a request of a third-party iframe, a CORS preflight or a web worker became a finding of the site;
 * - a capture cut off by a crashed tab, a lost browser or the hard limit became a clean, complete report.
 */

// Invented services: an embedded player (a product), a tracker and a font host of other providers.
const rules = compileRules(
  parseRulesFile({
    version: 1,
    updated: '2026-11-23',
    services: [
      { id: 'x-player', name: 'X Player', provider: 'PlayerCo', category: 'video', riskClass: 'usually-consent', dataLocation: 'unknown', hosts: ['embed.playerco.test'], sources: ['test'] },
      { id: 'x-tracker', name: 'X Tracker', provider: 'TrackCo', category: 'analytics', riskClass: 'consent-required', dataLocation: 'unknown', hosts: ['px.trackco.test'], sources: ['test'] },
      { id: 'x-fonts', name: 'X Fonts', provider: 'FontCo', category: 'fonts', riskClass: 'precedent', dataLocation: 'unknown', hosts: ['css.fontco.test'], sources: ['test'] },
    ],
  }),
);

let fixture: CdpFixture;
let browser: Browser;

const guard = () =>
  createUrlGuard({
    resolve: async () => {
      throw new Error('no DNS in this test');
    },
    exempt: (url) => url.hostname.endsWith('.test'),
  });
const options = (extra: CloudCaptureOptions = {}): CloudCaptureOptions => ({ guard: guard(), axeSource: null, httpProbe: false, impressum: false, ...extra });

function reportOf(capture: Capture): Report {
  const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T10:00:00.000Z', siteUrl: 'http://www.shop.test/', mode: 'full', capture, rules, scannerVersion: '0.0.0', rulesUpdated: '2026-11-23' });
  expect(validateReport(report)).toEqual([]);
  return report;
}

const services = (capture: Capture): string[] => analyzeThirdParty(capture, rules).services.map((s) => `${s.key}=${s.severity}`);
const to = (capture: Capture, host: string) => capture.requests.filter((r) => r.url.includes(`//${host}`));

beforeAll(async () => {
  fixture = await startCdpFixture();
  browser = (await fixture.connect()).browser;
});
afterAll(async () => {
  await fixture?.close();
});

describe('finding 17: a request without a frame belongs to the document that caused it', () => {
  it('a CORS preflight inside a third-party iframe is no separate finding', async () => {
    const { capture, stats } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/preflight'), options());
    const frame = fixture.url('embed.playerco.test', '/preflight');
    const tracker = to(capture, 'px.trackco.test');
    expect(tracker.map((r) => r.method).sort()).toEqual(['OPTIONS', 'POST']);
    for (const request of tracker) expect(request).toMatchObject({ isMainFrame: false, frameUrls: [frame], frameKnown: true });
    expect(stats.framesUnknown).toBe(0);
    expect(services(capture)).toEqual(['x-player=finding']);
    expect(reportOf(capture).findings.filter((f) => f.area === 'privacy').map((f) => f.id)).toEqual(['third-party:x-player']);
  });

  it('a request of a web worker inside a third-party iframe is no separate finding', async () => {
    const { capture, stats } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/worker'), options());
    const fonts = to(capture, 'css.fontco.test');
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({ isMainFrame: false, frameUrls: [fixture.url('embed.playerco.test', '/worker')], frameKnown: true });
    expect(stats.framesUnknown).toBe(0);
    expect(services(capture)).toEqual(['x-player=finding']);
  });

  it('a preflight and a worker of the page itself still count for the page', async () => {
    const { capture } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/own'), options());
    const own = [...to(capture, 'px.trackco.test'), ...to(capture, 'css.fontco.test')];
    expect(own.map((r) => r.method).sort()).toEqual(['GET', 'OPTIONS', 'POST']);
    for (const request of own) expect(request).toMatchObject({ isMainFrame: true, frameUrls: [], frameKnown: true });
    expect(services(capture).sort()).toEqual(['x-fonts=finding', 'x-tracker=finding']);
  });
});

describe('finding 1: two third-party iframes that answer at almost the same time', () => {
  it('the requests of the first iframe keep its address, and its fonts are no finding of the site', async () => {
    // The review's setting: 25 ms each way between the Worker and the browser, the second widget answers
    // 60 to 74 ms after the first. Before the fix Puppeteer then recorded the first widget's requests
    // without its address in most of these captures (`framesPlacedLate` counts them now).
    const delayed = (await fixture.connect(25)).browser;
    const widget = fixture.url('forms.widget.test', '/embed');
    let placedLate = 0;
    for (const gap of [60, 62, 63, 64, 65, 66, 68, 74]) {
      fixture.setGap(gap);
      const { capture, stats } = await captureWithCdpEvents(delayed, fixture.url('www.shop.test', '/race'), options({ maxWaitMs: 8_000 }));
      expect(capture.ok).toBe(true);
      const inWidget = capture.requests.filter((r) => !r.isNavigation && (r.url.includes('//css.fontco.test') || r.url.includes('//forms.widget.test')));
      expect(inWidget).toHaveLength(3);
      for (const request of inWidget) expect(request).toMatchObject({ isMainFrame: false, frameUrls: [widget], frameKnown: true });
      expect(stats.framesUnknown).toBe(0);
      placedLate += stats.framesPlacedLate ?? 0;
      expect(services(capture)).toEqual(['unknown:widget.test=hint']);
      expect(reportOf(capture).findings.filter((f) => f.kind === 'finding' && f.area === 'privacy')).toEqual([]);
    }
    console.log(`requests of the widget placed only at the end of the capture: ${placedLate} in 8 captures`);
    await delayed.disconnect();
  });
});

describe('finding 2: a capture that is cut off is never a complete report', () => {
  const ticker = (): string => fixture.url('www.shop.test', '/ticker');

  it('control: the whole visit sees the tracker that starts after 2.5 s', async () => {
    const { capture } = await captureWithCdpEvents(browser, ticker(), options());
    expect(capture).toMatchObject({ ok: true, failure: null, timings: { stopReason: 'network-quiet' } });
    const report = reportOf(capture);
    expect(report.state).toBe('complete');
    expect(report.measures.find((m) => m.id === 'third-party-before-consent')).toMatchObject({ result: 'fail', actual: { type: 'count', count: 1 } });
  });

  it('a tab that crashes 1.2 s after the document gives a failed capture, not a page without services', async () => {
    fixture.onNextDocument(() => {
      setTimeout(() => {
        void (async () => {
          const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(fixture.url('www.shop.test', '/')));
          const session = await target?.createCDPSession();
          void session?.send('Page.crash').catch(() => undefined);
        })();
      }, 1_200);
    });
    const { capture } = await captureWithCdpEvents(browser, ticker(), options());
    expect(capture.ok).toBe(false);
    expect(capture.failure).toMatchObject({ reason: 'other' });
    expect(to(capture, 'px.trackco.test')).toEqual([]);
    const report = reportOf(capture);
    expect(report.state).toBe('failed');
    expect(report.measures).toEqual([]);
    expect(report.services).toEqual([]);
  });

  it('a page that never finishes is cut by the hard limit: a timeout, not a clean report', async () => {
    const { capture } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/busy'), options({ maxWaitMs: 2_000, hardLimitMs: 3_500 }));
    expect(capture.ok).toBe(false);
    expect(capture.failure).toMatchObject({ reason: 'timeout' });
    const report = reportOf(capture);
    expect(report.state).toBe('failed');
    expect(report.measures).toEqual([]);
  });

  it('a browser lost 1.2 s after the document makes the capture throw: the scan ends as an error, without a report', async () => {
    const own = await fixture.connect();
    fixture.onNextDocument(() => {
      setTimeout(() => own.dropConnection(), 1_200);
    });
    const started = Date.now();
    await expect(captureWithCdpEvents(own.browser, ticker(), options())).rejects.toThrow(BROWSER_LOST);
    // Noticed at once, not after the 15 s of the longest wait.
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});

// Session fix-a2, review finding 23: the review's reproduction as a test of the adapter itself.
describe('finding 23: axe reads only the document that was checked', () => {
  it('a page that moves to a prefetched internal page after the snapshot: nothing of that page is in the capture', async () => {
    // The third check is the one of the snapshot's address; it is slow here (as a name lookup can be), so the
    // other document is in the tab before axe starts.
    const inner = guard();
    let calls = 0;
    const slow = {
      check: async (url: string | URL) => {
        calls += 1;
        if (calls === 3) await new Promise((resolve) => setTimeout(resolve, 900));
        return inner.check(url);
      },
    };
    const { capture } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/prefetch-swap'), options({ guard: slow, axeSource: await loadAxeSource(), maxWaitMs: 4_000 }));
    // The internal page was fetched once ahead and never requested as a navigation: the guard on requests saw nothing.
    expect(fixture.hits('GET 127.0.0.1/private')).toBe(1);
    expect(fixture.hits('NAVIGATION 127.0.0.1/private')).toBe(0);
    expect(JSON.stringify(capture)).not.toContain('INTVAL');
    expect(capture.axe?.status).not.toBe('ok');
    expect(capture.ok).toBe(false);
    expect(capture.failure).toMatchObject({ reason: 'not-allowed' });
    expect(reportOf(capture).state).toBe('not-allowed');
  });

  it('control: an ordinary page gets its accessibility result', async () => {
    const { capture } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/own'), options({ axeSource: await loadAxeSource(), maxWaitMs: 4_000 }));
    expect(capture.ok).toBe(true);
    expect(capture.axe?.status, capture.axe?.error ?? '').toBe('ok');
  });
});

describe('finding 100 (session fix-a5): a failure of the Impressum tab leaves the homepage capture standing', () => {
  /** The same browser, but the second tab of every context fails: `newPage` throws, or the page is already gone. */
  function failingSecondTab(how: 'throws' | 'closed'): Browser {
    return new Proxy(browser, {
      get(target, prop) {
        if (prop === 'createBrowserContext') {
          return async (...args: unknown[]) => {
            const context = await (target.createBrowserContext as (...a: unknown[]) => Promise<Awaited<ReturnType<Browser['createBrowserContext']>>>)(...args);
            let pages = 0;
            return new Proxy(context, {
              get(ctx, key) {
                if (key === 'newPage') {
                  return async () => {
                    pages += 1;
                    if (pages < 2) return ctx.newPage();
                    if (how === 'throws') throw new Error('Protocol error (Target.createTarget): Target closed');
                    const page = await ctx.newPage();
                    await page.close();
                    return page;
                  };
                }
                const value: unknown = Reflect.get(ctx, key);
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(ctx) : value;
              },
            });
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  for (const how of ['throws', 'closed'] as const) {
    it(`the Impressum tab ${how === 'throws' ? 'cannot be created' : 'is gone at once'}: homepage captured, Impressum failed, report complete`, async () => {
      const { capture } = await captureWithCdpEvents(failingSecondTab(how), fixture.url('www.shop.test', '/heavy/plain'), options({ impressum: true }));
      expect(capture.ok).toBe(true);
      expect(capture.page).not.toBeNull();
      expect(capture.impressum?.ok).toBe(false);
      expect(capture.impressum?.failure?.reason).toBe('other');
      const report = reportOf(capture);
      expect(report.state).toBe('complete');
      expect(report.legal?.impressum.state).toBe('failed');
    });
  }

  it('control: the same page with a working second tab reads the Impressum', async () => {
    const { capture } = await captureWithCdpEvents(browser, fixture.url('www.shop.test', '/heavy/plain'), options({ impressum: true }));
    expect(capture.impressum?.ok).toBe(true);
  });
});

describe('session fix-a6: the page cannot give axe a false result, and a CSP meta element counts only in <head>', () => {
  const violations = (capture: Capture): Record<string, number> => Object.fromEntries(Object.entries(capture.axe?.rules ?? {}).filter(([, r]) => (r?.violations ?? 0) > 0).map(([id, r]) => [id, r?.violations ?? 0]));
  for (const name of Object.keys(HOSTILE_AXE_PAGES)) {
    it(`finding 26, ${name}: axe runs in an isolated world and finds the six barriers`, async () => {
      const { capture } = await captureWithCdpEvents(browser, fixture.url('www.hostile.test', `/${name}`), options({ axeSource: await loadAxeSource(), maxWaitMs: 4_000 }));
      expect(capture.ok).toBe(true);
      expect(capture.axe?.status, capture.axe?.error ?? '').toBe('ok');
      expect(violations(capture)).toEqual(HOSTILE_AXE_VIOLATIONS);
      const report = reportOf(capture);
      expect(report.findings.filter((f) => f.area === 'accessibility' && f.kind === 'finding')).toHaveLength(6);
    });
  }

  it('"Feld B2": an image without alt in A1, grey text in B2, an iframe of another host in D3', async () => {
    const { capture } = await captureWithCdpEvents(browser, fixture.url('www.field.test', '/feld'), options({ axeSource: await loadAxeSource(), maxWaitMs: 4_000 }));
    expect(capture.axe?.status, capture.axe?.error ?? '').toBe('ok');
    expect(capture.axe?.rules['image-alt']?.examples[0]?.field).toBe('A1');
    expect(capture.axe?.rules['color-contrast']?.examples[0]?.field).toBe('B2');
    expect(capture.axe?.positions?.hosts['karte.mapco.test']).toEqual(['D3']);
    const report = reportOf(capture);
    const field = (id: string) => report.findings.find((f) => f.id === id)?.field;
    expect(field('a11y:image-alt')).toBe('A1');
    expect(field('a11y:color-contrast')).toBe('B2');
    expect(field('third-party:unknown:mapco.test')).toBe('D3');
  });

  it('finding 77: a CSP meta element in <body> is not read, one in <head> is', async () => {
    const body = await captureWithCdpEvents(browser, fixture.url('www.hostile.test', '/csp-meta-body'), options({ maxWaitMs: 3_000 }));
    expect(body.capture.page?.securityMeta).toEqual({ csp: null, referrer: null });
    const head = await captureWithCdpEvents(browser, fixture.url('www.hostile.test', '/csp-meta-head'), options({ maxWaitMs: 3_000 }));
    expect(head.capture.page?.securityMeta?.csp).toBe("img-src 'self'");
  });
});
