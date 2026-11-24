import { describe, expect, it } from 'vitest';
import { frameEmulation, userAgentMetadataOf, viewportEmulation } from '../src/capture/emulation.ts';

describe('visitor emulation', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

  it('sends the same language, time zone and user agent as Playwright with locale de-DE', () => {
    expect(frameEmulation(ua)).toEqual([
      {
        method: 'Emulation.setUserAgentOverride',
        params: {
          userAgent: ua,
          acceptLanguage: 'de-DE',
          userAgentMetadata: { mobile: false, model: '', architecture: 'x86', platform: 'Windows', platformVersion: '10.0' },
          platform: 'Win32',
        },
      },
      { method: 'Emulation.setLocaleOverride', params: { locale: 'de-DE' } },
      { method: 'Emulation.setTimezoneOverride', params: { timezoneId: 'Europe/Berlin' } },
    ]);
  });

  it('sets viewport and screen to 1440 x 900 on the page', () => {
    const metrics = viewportEmulation().find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(metrics?.params).toMatchObject({ width: 1440, height: 900, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
    expect(viewportEmulation().map((c) => c.method)).toContain('Emulation.setFocusEmulationEnabled');
  });

  it('computes client hints like Playwright', () => {
    expect(userAgentMetadataOf('Mozilla/5.0 (X11; Linux x86_64)')).toMatchObject({ platform: 'Linux', platformVersion: '' });
  });
});
