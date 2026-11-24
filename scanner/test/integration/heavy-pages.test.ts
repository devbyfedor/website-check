import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPTURE_LIMITS } from '../../src/capture/limits.ts';
import type { Capture } from '../../src/capture/types.ts';
import { captureWithPlaywright, launchLocalBrowser, type LocalCaptureOptions } from '../../src/local/playwright-capture.ts';
import { buildReport } from '../../src/report/build.ts';
import type { Report } from '../../src/report/types.ts';
import { validateReport } from '../../src/report/validate.ts';
import { compileRules, parseRulesFile } from '../../src/rules/match.ts';
import { fixtureGuard, startFixtureServer, type FixtureServer } from './fixture-server.ts';
import { cpuMsOf, HEAVY_BOUNDS } from './heavy-pages.ts';

/**
 * Session fix-a4: the review's heavy pages (findings 4, 10 and 13, `heavy-pages.ts`) through the local
 * Playwright adapter. For every page: the capture is at most 2 MB as JSON, its report is built within 1 s
 * of CPU and is valid. The same pages run through the Cloudflare adapter in `worker/test/integration`.
 */

// One invented service: the heavy pages make no request to it.
const rules = compileRules(
  parseRulesFile({
    version: 1,
    updated: '2026-11-24',
    services: [{ id: 'x-tracker', name: 'X Tracker', provider: 'TrackCo', category: 'analytics', riskClass: 'consent-required', dataLocation: 'unknown', hosts: ['px.trackco.test'], sources: ['test'] }],
  }),
);

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await launchLocalBrowser(['--host-resolver-rules=MAP *.test 127.0.0.1']);
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function scan(path: string, extra: LocalCaptureOptions = {}): Promise<{ capture: Capture; report: Report; wallMs: number }> {
  const started = Date.now();
  const { capture } = await captureWithPlaywright(browser, server.url('www.heavy.test', path), { guard: fixtureGuard, httpProbe: false, impressum: false, accessibility: false, ...extra });
  const wallMs = Date.now() - started;
  expect(JSON.stringify(capture).length, 'capture as JSON').toBeLessThanOrEqual(HEAVY_BOUNDS.captureChars);
  const built = cpuMsOf(() => buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T10:00:00.000Z', siteUrl: 'http://www.heavy.test/', mode: 'full', capture, rules, scannerVersion: '0.0.0', rulesUpdated: '2026-11-24' }));
  expect(built.ms, 'CPU of the report').toBeLessThanOrEqual(HEAVY_BOUNDS.analysisCpuMs);
  expect(validateReport(built.value.report)).toEqual([]);
  return { capture, report: built.value.report, wallMs };
}

describe('finding 4: a page cannot fill the capture with requests', () => {
  it('5,000 requests started and aborted: the capture stops at the limit and fails with page-limit', async () => {
    const { capture, report, wallMs } = await scan('/heavy/flood', { accessibility: true });
    expect(capture.ok).toBe(false);
    expect(capture.failure?.reason).toBe('page-limit');
    expect(capture.requests.length).toBeLessThanOrEqual(CAPTURE_LIMITS.maxRequests);
    expect(capture.page).toBeNull();
    expect(wallMs).toBeLessThan(15_000);
    expect(report.state).toBe('failed');
    expect(report.failure).toEqual({ reason: 'page-limit', status: null });
  });

  it('200 requests with an address of 1 MB each: every address is kept cut, the page is captured and reported', async () => {
    const { capture, report } = await scan('/heavy/long-addresses');
    expect(capture.ok).toBe(true);
    expect(capture.requests.filter((r) => r.url.includes('/heavy/n?'))).toHaveLength(200);
    expect(Math.max(...capture.requests.map((r) => r.url.length))).toBe(CAPTURE_LIMITS.urlLength);
    expect(capture.limited?.strings).toBeGreaterThanOrEqual(200);
    expect(report.state).toBe('complete');
  });
});

describe('finding 10: what the scripts in the page return is bounded', () => {
  it('a document address of 20,000 characters and 1,600 links, on the homepage and on the Impressum', async () => {
    const { capture, report } = await scan('/heavy/long-links', { impressum: true });
    expect(capture.ok).toBe(true);
    expect(capture.page?.url).toHaveLength(CAPTURE_LIMITS.urlLength);
    expect(capture.page?.links.map((l) => l.text)).toEqual(['Impressum']);
    expect(capture.page?.linksTruncated).toBe(true);
    expect(capture.impressum?.ok).toBe(true);
    expect(capture.impressum?.page?.linksTruncated).toBe(true);
    expect(JSON.stringify(capture).length).toBeLessThan(100_000);
    expect(report.truncated.page).toEqual(['homepage-links', 'impressum-links']);
  });

  it('a title, a language, a banner state and a consent signal of 5 MB each', async () => {
    const { capture } = await scan('/heavy/big-fields');
    expect(capture.ok).toBe(true);
    expect(capture.page?.title).toHaveLength(CAPTURE_LIMITS.titleLength);
    expect(capture.page?.lang).toHaveLength(CAPTURE_LIMITS.langLength);
    expect(capture.consentBanner.toolId).toHaveLength(CAPTURE_LIMITS.toolIdLength);
    expect(capture.consentBanner.selector).toHaveLength(CAPTURE_LIMITS.selectorLength);
    expect(capture.consentBanner.signals?.cookiebot?.method).toHaveLength(CAPTURE_LIMITS.shortText);
    expect(JSON.stringify(capture).length).toBeLessThan(20_000);
  });

  it('the same on a page that replaces the methods the snapshot cuts with', async () => {
    const { capture } = await scan('/heavy/slice');
    expect(capture.page?.title ?? '').toBe('');
    expect(JSON.stringify(capture).length).toBeLessThan(20_000);
  });

  it("an accessibility result of the page's own with megabyte strings, and images with an id of 1 MB", async () => {
    const fake = await scan('/heavy/fake-axe', { accessibility: true });
    expect(JSON.stringify(fake.capture.axe).length).toBeLessThan(200_000);
    // Session fix-a6 (review finding 26): axe runs in an isolated world, so the page's own `window.axe` is never the
    // one that runs: the pinned axe-core checks the page (it has no barrier) and gives its own version.
    expect(fake.capture.axe?.status, fake.capture.axe?.error ?? '').toBe('ok');
    expect(fake.report.scan.axeVersion).toBe('4.14.1');
    const ids = await scan('/heavy/big-ids', { accessibility: true });
    expect(ids.capture.axe?.status, ids.capture.axe?.error ?? '').toBe('ok');
    const rule = ids.capture.axe?.rules['image-alt'];
    expect(rule?.violations).toBe(12);
    for (const example of rule?.examples ?? []) for (const part of example.target) expect(part.length).toBeLessThanOrEqual(CAPTURE_LIMITS.axeTargetLength);
  });
});

describe('finding 13: a Permissions-Policy header with 64,000 spaces', () => {
  it('the value is not kept and not analysed: "bitte manuell prüfen"', async () => {
    const { capture, report } = await scan('/heavy/long-header');
    expect(capture.ok).toBe(true);
    expect(capture.mainDocument?.headersCut).toEqual(['permissions-policy']);
    expect(report.security?.headers.find((h) => h.key === 'permissions-policy')).toMatchObject({ status: 'manual', textId: 'security-header-too-long' });
    expect(report.truncated.page).toEqual(['headers']);
  });
});
