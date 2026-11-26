import { describe, expect, it } from 'vitest';
import { lowerCaseHeaders, toInitiator } from '../src/capture/cdp.ts';
import { SNAPSHOT_EXPRESSION } from '../src/capture/page-scripts.ts';
import { CAPTURE_SETTINGS, chromeVersionOf, desktopChromeUserAgent, networkQuietNow } from '../src/capture/settings.ts';

describe('capture settings', () => {
  it('are the settings of the local A1 run', () => {
    expect(CAPTURE_SETTINGS).toMatchObject({
      locale: 'de-DE',
      acceptLanguage: 'de-DE',
      timezoneId: 'Europe/Berlin',
      viewport: { width: 1440, height: 900 },
      maxWaitMs: 15_000,
      quietWindowMs: 1_500,
      minObserveMs: 3_000,
      hardLimitMs: 20_000,
    });
  });

  // Session C2 (Fedor's answer 3 after C1): a quiet network ends the waiting 3 s after the start at the earliest.
  it('a quiet network ends the waiting only after the load event, with nothing open, 1.5 s after the last request and 3 s after the start', () => {
    const quiet = { nowMs: 3_000, loadMs: 300, inflight: 0, lastActivityMs: 1_000 };
    expect(networkQuietNow(quiet, CAPTURE_SETTINGS)).toBe(true);
    // The C1 case: a quiet page loaded at 0.3 s, quiet since 0.4 s; at 1.9 s the old rule ended the waiting before the
    // page's request at about 2 s.
    expect(networkQuietNow({ nowMs: 1_900, loadMs: 300, inflight: 0, lastActivityMs: 400 }, { ...CAPTURE_SETTINGS, minObserveMs: 0 })).toBe(true);
    expect(networkQuietNow({ nowMs: 1_900, loadMs: 300, inflight: 0, lastActivityMs: 400 }, CAPTURE_SETTINGS)).toBe(false);
    expect(networkQuietNow({ nowMs: 2_999, loadMs: 300, inflight: 0, lastActivityMs: 400 }, CAPTURE_SETTINGS)).toBe(false);
    // The other conditions stay as they were.
    expect(networkQuietNow({ ...quiet, loadMs: null }, CAPTURE_SETTINGS)).toBe(false);
    expect(networkQuietNow({ ...quiet, inflight: 1 }, CAPTURE_SETTINGS)).toBe(false);
    expect(networkQuietNow({ ...quiet, lastActivityMs: 1_501 }, CAPTURE_SETTINGS)).toBe(false);
    // A page busy until 4 s ends 1.5 s after its last request, as before.
    expect(networkQuietNow({ nowMs: 5_500, loadMs: 300, inflight: 0, lastActivityMs: 4_000 }, CAPTURE_SETTINGS)).toBe(true);
    expect(networkQuietNow({ nowMs: 5_499, loadMs: 300, inflight: 0, lastActivityMs: 4_000 }, CAPTURE_SETTINGS)).toBe(false);
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
  it('the snapshot is valid JavaScript', () => {
    expect(() => new Function(SNAPSHOT_EXPRESSION)).not.toThrow();
  });

  it('only reads the page', () => {
    expect(SNAPSHOT_EXPRESSION).not.toMatch(/\.click\(|dispatchEvent|sendBeacon|fetch\(|XMLHttpRequest|\.submit\(|appendChild|innerHTML\s*=/);
  });
});
