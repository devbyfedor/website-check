import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from '@cloudflare/puppeteer';
import { buildReport, CAPTURE_LIMITS, compileRules, createUrlGuard, installPopupGuard, parseRulesFile, validateReport, type Capture, type Report } from '@website-check/scanner';
import { captureWithCdpEvents } from '../../src/capture/cdp-events.ts';
import type { CloudCaptureOptions } from '../../src/capture/common.ts';
import { loadAxeSource } from '../../../scanner/src/local/axe-source.ts';
import { cpuMsOf, HEAVY_BOUNDS } from '../../../scanner/test/integration/heavy-pages.ts';
import { startCdpFixture, type CdpFixture } from './cdp-fixture.ts';

/**
 * Session fix-a4: the review's reproductions of findings 4, 10 and 13 as tests of the Cloudflare adapter
 * itself, on the local Chromium (see `cdp-fixture.ts` and `scanner/test/integration/heavy-pages.ts`). For
 * every heavy page: the capture is at most 2 MB as JSON, its report is built within 1 s of CPU and is valid,
 * and the report says what was cut. Before the fix the same pages gave captures of tens of megabytes,
 * browser messages of 30 MB and captures that ran far past the hard limit.
 */

const rules = compileRules(parseRulesFile({ version: 1, updated: '2026-11-24', services: [] }));

let fixture: CdpFixture;
let browser: Browser;
let wire: { messages: number; largest: number };
let axeSource: string;

const guard = () =>
  createUrlGuard({
    resolve: async () => {
      throw new Error('no DNS in this test');
    },
    exempt: (url) => url.hostname.endsWith('.test'),
  });
const options = (extra: CloudCaptureOptions = {}): CloudCaptureOptions => ({ guard: guard(), axeSource: null, httpProbe: false, impressum: false, ...extra });
const page = (path: string): string => fixture.url('www.shop.test', path);

/** Captures a page and builds its report; checks the two bounds that hold for every page. */
async function scan(path: string, extra: CloudCaptureOptions = {}): Promise<{ capture: Capture; report: Report; wallMs: number; largestMessage: number }> {
  wire.largest = 0;
  const started = Date.now();
  const { capture } = await captureWithCdpEvents(browser, page(path), options(extra));
  const wallMs = Date.now() - started;
  const largestMessage = wire.largest;
  expect(JSON.stringify(capture).length, 'capture as JSON').toBeLessThanOrEqual(HEAVY_BOUNDS.captureChars);
  const built = cpuMsOf(() => buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T10:00:00.000Z', siteUrl: 'http://www.shop.test/', mode: 'full', capture, rules, scannerVersion: '0.0.0', rulesUpdated: '2026-11-24' }));
  expect(built.ms, 'CPU of the report').toBeLessThanOrEqual(HEAVY_BOUNDS.analysisCpuMs);
  expect(validateReport(built.value.report)).toEqual([]);
  return { capture, report: built.value.report, wallMs, largestMessage };
}

beforeAll(async () => {
  fixture = await startCdpFixture();
  ({ browser, wire } = await fixture.connect());
  axeSource = await loadAxeSource();
});
afterAll(async () => {
  await fixture?.close();
});

describe('finding 4: a page cannot fill the capture with requests', () => {
  it('5,000 requests started and aborted: the capture stops at the limit and fails with page-limit', async () => {
    const { capture, report, wallMs } = await scan('/heavy/flood', { axeSource });
    expect(capture.ok).toBe(false);
    expect(capture.failure?.reason).toBe('page-limit');
    expect(capture.requests.length).toBeLessThanOrEqual(CAPTURE_LIMITS.maxRequests);
    expect(capture.page).toBeNull();
    expect(wallMs).toBeLessThan(15_000);
    expect(report.state).toBe('failed');
    expect(report.failure).toEqual({ reason: 'page-limit', status: null });
    expect(report.findings).toEqual([]);
  });

  it('requests in bursts for 13 seconds: the capture ends long before the hard limit of 20 s', async () => {
    const { capture, report, wallMs } = await scan('/heavy/flood-net');
    expect(capture.failure?.reason).toBe('page-limit');
    expect(capture.requests.length).toBeLessThanOrEqual(CAPTURE_LIMITS.maxRequests);
    expect(wallMs).toBeLessThan(15_000);
    expect(report.state).toBe('failed');
  });

  it('a flood beside an ordinary page in the same browser: the ordinary page is captured as usual', async () => {
    // As the queue object: one popup guard per browser, shared by its parallel scans.
    const ownTargets = new Set<string>();
    const state = await installPopupGuard((await browser.target().createCDPSession()) as never, ownTargets);
    const shared = { popupGuard: { ownTargets, state } };
    const [flood, plain] = await Promise.all([
      captureWithCdpEvents(browser, page('/heavy/flood-net'), options(shared)),
      captureWithCdpEvents(browser, page('/heavy/plain'), options({ ...shared, axeSource, impressum: true })),
    ]);
    expect(flood.capture.failure?.reason).toBe('page-limit');
    expect(plain.capture.failure).toBeNull();
    expect(plain.capture.ok).toBe(true);
    expect(plain.capture.axe?.status, plain.capture.axe?.error ?? '').toBe('ok');
    expect(plain.capture.impressum?.ok).toBe(true);
    expect(plain.capture.requests.some((r) => r.url.includes('/heavy/n?5'))).toBe(true);
  });

  it('200 requests with an address of 1 MB each: every address is kept cut, the page is captured and reported', async () => {
    const { capture, report } = await scan('/heavy/long-addresses', { axeSource });
    expect(capture.ok).toBe(true);
    expect(capture.failure).toBeNull();
    const long = capture.requests.filter((r) => r.url.includes('/heavy/n?'));
    expect(long).toHaveLength(200);
    expect(Math.max(...capture.requests.map((r) => r.url.length))).toBe(CAPTURE_LIMITS.urlLength);
    expect(capture.limited?.strings).toBeGreaterThanOrEqual(200);
    expect(capture.axe?.status).toBe('ok');
    expect(report.state).toBe('complete');
  });
});

describe('finding 10: what the scripts in the page return is bounded', () => {
  it('a document address of 20,000 characters and 1,600 links, on the homepage and on the Impressum', async () => {
    const { capture, report, largestMessage } = await scan('/heavy/long-links', { axeSource, impressum: true });
    expect(largestMessage).toBeLessThan(200_000);
    expect(capture.ok).toBe(true);
    expect(capture.page?.url).toHaveLength(CAPTURE_LIMITS.urlLength);
    // The 1,600 links to anchors of the long address are left out; the Impressum link has a short address.
    expect(capture.page?.links.map((l) => l.text)).toEqual(['Impressum']);
    expect(capture.page?.linksTruncated).toBe(true);
    expect(capture.impressum?.ok).toBe(true);
    expect(capture.impressum?.page?.links.map((l) => l.text)).toEqual(['Impressum']);
    expect(capture.impressum?.page?.linksTruncated).toBe(true);
    expect(JSON.stringify(capture).length).toBeLessThan(100_000);
    expect(report.state).toBe('complete');
    expect(report.truncated.page).toEqual(['homepage-links', 'impressum-links']);
  });

  it('a title, a language, a banner state and a consent signal of 5 MB each', async () => {
    const { capture, largestMessage } = await scan('/heavy/big-fields');
    expect(largestMessage).toBeLessThan(200_000);
    expect(capture.ok).toBe(true);
    expect(capture.page?.title).toHaveLength(CAPTURE_LIMITS.titleLength);
    expect(capture.page?.lang).toHaveLength(CAPTURE_LIMITS.langLength);
    expect(capture.consentBanner.toolId).toHaveLength(CAPTURE_LIMITS.toolIdLength);
    expect(capture.consentBanner.selector).toHaveLength(CAPTURE_LIMITS.selectorLength);
    expect(capture.consentBanner.toolsInDom).toEqual([]);
    expect(capture.consentBanner.signals?.cookiebot?.method).toHaveLength(CAPTURE_LIMITS.shortText);
    expect(JSON.stringify(capture).length).toBeLessThan(20_000);
  });

  it('the same on a page that replaces the methods the snapshot cuts with: the values are dropped, the answer stays small', async () => {
    const { capture, largestMessage } = await scan('/heavy/slice');
    expect(largestMessage).toBeLessThan(200_000);
    expect(capture.page?.title ?? '').toBe('');
    expect(capture.consentBanner.toolId ?? '').toBe('');
    expect(JSON.stringify(capture).length).toBeLessThan(20_000);
  });

  it("an accessibility result of the page's own with megabyte strings", async () => {
    const { capture, report, largestMessage } = await scan('/heavy/fake-axe', { axeSource });
    expect(largestMessage).toBeLessThan(400_000);
    expect(capture.ok).toBe(true);
    expect(JSON.stringify(capture.axe).length).toBeLessThan(200_000);
    expect(report.scan.axeVersion).toBeNull();
  });

  it('twelve images whose id is 1 MB long: the selectors of the examples are cut', async () => {
    const { capture, largestMessage } = await scan('/heavy/big-ids', { axeSource });
    expect(largestMessage).toBeLessThan(400_000);
    expect(capture.axe?.status, capture.axe?.error ?? '').toBe('ok');
    const rule = capture.axe?.rules['image-alt'];
    expect(rule?.violations).toBe(12);
    expect(rule?.examples).toHaveLength(5);
    for (const example of rule?.examples ?? []) for (const part of example.target) expect(part.length).toBeLessThanOrEqual(CAPTURE_LIMITS.axeTargetLength);
  });
});

describe('finding 13: a Permissions-Policy header with 64,000 spaces', () => {
  it('the value is not kept and not analysed: "bitte manuell prüfen", and the report names the cut', async () => {
    const { capture, report } = await scan('/heavy/long-header');
    expect(capture.ok).toBe(true);
    expect(capture.mainDocument?.headers['permissions-policy']).toBeUndefined();
    expect(capture.mainDocument?.headersCut).toEqual(['permissions-policy']);
    expect(report.security?.headers.find((h) => h.key === 'permissions-policy')).toMatchObject({ status: 'manual', textId: 'security-header-too-long' });
    expect(report.truncated.page).toEqual(['headers']);
  });
});
