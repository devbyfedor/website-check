import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Capture } from '../../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../../src/data.ts';
import { captureWithPlaywright, launchLocalBrowser } from '../../src/local/playwright-capture.ts';
import { buildReport } from '../../src/report/build.ts';
import { validateReport } from '../../src/report/validate.ts';
import { fixtureGuard, startFixtureServer, type FixtureServer } from './fixture-server.ts';
import { HOSTILE_AXE_PAGES, HOSTILE_AXE_VIOLATIONS } from './hostile-a6-pages.ts';

/**
 * Session fix-a6 through the local adapter in Chromium (pages on 127.0.0.1): review finding 26 (the page cannot give
 * axe a false result) and the CSP meta element of finding 77 (only one in <head> counts).
 */

const HOST_RULES = '--host-resolver-rules=MAP *.test 127.0.0.1';
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

const violations = (capture: Capture): Record<string, number> => Object.fromEntries(Object.entries(capture.axe?.rules ?? {}).filter(([, r]) => (r?.violations ?? 0) > 0).map(([id, r]) => [id, r?.violations ?? 0]));

describe('finding 26: axe runs in an isolated world', () => {
  it.each(Object.keys(HOSTILE_AXE_PAGES))('%s: the six barriers are found', async (name) => {
    const url = server.url('www.hostile.test', `/${name}`);
    const { capture } = await captureWithPlaywright(browser, url, { guard: fixtureGuard, maxWaitMs: 4_000, httpProbe: false });
    expect(capture.ok).toBe(true);
    expect(capture.axe?.status, capture.axe?.error ?? '').toBe('ok');
    expect(violations(capture)).toEqual(HOSTILE_AXE_VIOLATIONS);
    const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: url, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
    expect(validateReport(built.report)).toEqual([]);
    expect(built.report.findings.filter((f) => f.area === 'accessibility' && f.kind === 'finding')).toHaveLength(6);
  });
});

describe('"Feld B2": the field of an element on the plan of the homepage', () => {
  it('an image without alt in A1, grey text in B2, an iframe of another host in D3', async () => {
    const url = server.url('www.field.test', '/feld');
    const { capture } = await captureWithPlaywright(browser, url, { guard: fixtureGuard, maxWaitMs: 4_000, httpProbe: false });
    expect(capture.axe?.status, capture.axe?.error ?? '').toBe('ok');
    expect(capture.axe?.rules['image-alt']?.examples[0]?.field).toBe('A1');
    expect(capture.axe?.rules['color-contrast']?.examples[0]?.field).toBe('B2');
    expect(capture.axe?.positions?.hosts['karte.mapco.test']).toEqual(['D3']);
    const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: url, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
    expect(validateReport(built.report)).toEqual([]);
    const field = (id: string) => built.report.findings.find((f) => f.id === id)?.field;
    expect(field('a11y:image-alt')).toBe('A1');
    expect(field('a11y:color-contrast')).toBe('B2');
    expect(field('third-party:unknown:mapco.test')).toBe('D3');
  });
});

describe('finding 77: a CSP meta element counts only as a child of <head>', () => {
  it('in <body> it is not read, in <head> it is', async () => {
    const body = await captureWithPlaywright(browser, server.url('www.hostile.test', '/csp-meta-body'), { guard: fixtureGuard, maxWaitMs: 3_000, httpProbe: false });
    expect(body.capture.page?.securityMeta).toEqual({ csp: null, referrer: null });
    const head = await captureWithPlaywright(browser, server.url('www.hostile.test', '/csp-meta-head'), { guard: fixtureGuard, maxWaitMs: 3_000, httpProbe: false });
    expect(head.capture.page?.securityMeta?.csp).toBe("img-src 'self'");
  });
});
