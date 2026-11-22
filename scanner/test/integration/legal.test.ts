import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeLegal } from '../../src/analyzers/legal.ts';
import { IMPRESSUM_SETTINGS } from '../../src/legal/impressum-capture.ts';
import { FIXTURE_SETS, FIXTURES_ROOT, takeFixtureSnapshots } from '../../src/local/fixture-snapshots.ts';
import { captureWithPlaywright, launchLocalBrowser } from '../../src/local/playwright-capture.ts';
import { startFixtureServer, type FixtureServer } from './fixture-server.ts';

/**
 * Session A4 in Chromium: the Impressum link of the homepage opened in a second tab of the same
 * browser, the wait for its text, and the fixture snapshots that `npm test` uses.
 */

const HOST_RULES = '--host-resolver-rules=MAP nx.test ~NOTFOUND, MAP *.test 127.0.0.1';

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

describe('Impressum in a second tab', () => {
  it('opens the footer link, reads the text and finds the fields', async () => {
    const { capture, impressumHtml } = await captureWithPlaywright(browser, server.url('www.legal.test', '/'), { maxWaitMs: 5_000, httpProbe: false, accessibility: false, artifacts: true });
    expect(capture.ok).toBe(true);
    const tab = capture.impressum;
    expect(tab?.url).toBe(server.url('www.legal.test', '/impressum'));
    expect(tab?.ok).toBe(true);
    expect(tab?.status).toBe(200);
    expect(tab?.timings.stopReason).toBe('text-stable');
    expect(tab?.timings.totalMs).toBeLessThan(IMPRESSUM_SETTINGS.hardLimitMs);
    expect(impressumHtml).toContain('Impressum');
    // The homepage capture holds only the homepage's own requests, none of the second tab.
    expect(capture.requests.every((r) => !r.url.includes('/impressum'))).toBe(true);
    const legal = analyzeLegal(capture);
    expect(legal.impressum.state).toBe('analyzed');
    expect(legal.links.datenschutz?.href).toBe(server.url('www.legal.test', '/datenschutz'));
    const expected = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'impressum/expected.json'), 'utf8')).cases['01-gmbh-klassisch'];
    expect(legal.fields.address.status === 'found' ? legal.fields.address.value : null).toEqual(expected.address);
    expect(legal.fields.email.status === 'found' ? legal.fields.email.value : null).toEqual(expected.email);
    expect(legal.fields.handelsregister.status === 'found' ? legal.fields.handelsregister.value : null).toEqual(expected.handelsregister);
    expect(legal.fields.ustId.status === 'found' ? legal.fields.ustId.value : null).toBe(expected.ustId);
  });

  it('waits for a text that a script writes after the load event', async () => {
    const { capture } = await captureWithPlaywright(browser, server.url('www.slowlegal.test', '/'), { maxWaitMs: 5_000, httpProbe: false, accessibility: false });
    const legal = analyzeLegal(capture);
    expect(capture.impressum?.page?.text).toContain('Trägeweg 5');
    expect(legal.fields.address.status === 'found' ? legal.fields.address.value : null).toEqual({ street: 'Trägeweg 5', postcode: '12345', town: 'Wartestadt' });
    expect(capture.impressum?.timings.totalMs).toBeGreaterThan(1_200);
  });

  it('opens no tab for an anchor on the homepage and leaves the fields to a manual check', async () => {
    const { capture } = await captureWithPlaywright(browser, server.url('www.onepager.test', '/'), { maxWaitMs: 5_000, httpProbe: false, accessibility: false });
    expect(capture.impressum).toBeNull();
    const legal = analyzeLegal(capture);
    expect(legal.impressum.state).toBe('same-page');
    expect(legal.fields.address).toEqual({ status: 'not-found', reason: 'impressum-not-checked' });
  });

  it('never guesses /impressum when the homepage has no link', async () => {
    const { capture } = await captureWithPlaywright(browser, server.url('www.nolegal.test', '/'), { maxWaitMs: 5_000, httpProbe: false, accessibility: false });
    expect(capture.impressum).toBeNull();
    const legal = analyzeLegal(capture);
    expect(legal.impressum.state).toBe('no-link');
    expect(legal.fields.address).toEqual({ status: 'not-found', reason: 'impressum-not-checked' });
  });
});

describe('fixture snapshots', () => {
  it.each(FIXTURE_SETS.map((set) => [set.name, set] as const))('%s: the saved snapshots are what Chromium gives for the pages now', async (_name, set) => {
    const fresh = await takeFixtureSnapshots(browser, set);
    for (const [name, snapshot] of Object.entries(fresh)) {
      const saved = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, set.snapshots, `${name}.json`), 'utf8'));
      expect(saved, name).toEqual(snapshot);
    }
  });
});
