import { describe, expect, it, vi } from 'vitest';
import { frameEmulation, pageEmulation, userAgentMetadataOf } from '../src/capture/emulation.ts';
import { createLabHandler, isScannableUrl, parseTrace, sameToken, type LabDeps, type LabEnv } from '../src/lab/handler.ts';

const TOKEN = 'a'.repeat(64);
const env: LabEnv = { LAB_TOKEN: TOKEN };

function deps(): LabDeps<LabEnv> {
  return {
    limits: vi.fn(async () => ({ limits: { maxConcurrentSessions: 3 } })),
    open: vi.fn(async () => ({ sessionId: 'session-0001', browserVersion: 'HeadlessChrome/152.0.0.0' })),
    trace: vi.fn(async () => ({ loc: 'DE', colo: 'FRA', http: 'http/2', tls: 'TLSv1.3', environment: null })),
    capture: vi.fn(async (_env, _id, url, strategy) => ({
      capture: { requestedUrl: url, strategy } as never,
      stats: { events: 1, polls: 0, emulationFailed: [], wallMs: 5 },
    })),
    close: vi.fn(async (_env, sessionId) => ({ sessionId, startTime: 1, endTime: 2, closeReasonText: 'NormalClosure' })),
  };
}

const post = (path: string, body: unknown, token = TOKEN): Request =>
  new Request(`https://lab.example.test${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('lab endpoint', () => {
  it('is disabled without a configured token', async () => {
    const d = deps();
    const response = await createLabHandler(d)(post('/lab/session', {}), {});
    expect(response.status).toBe(503);
    expect(d.open).not.toHaveBeenCalled();
  });

  it('is disabled with a short token', async () => {
    const response = await createLabHandler(deps())(post('/lab/session', {}, 'short'), { LAB_TOKEN: 'short' });
    expect(response.status).toBe(503);
  });

  it('rejects a missing or wrong token without touching the browser', async () => {
    const d = deps();
    const handler = createLabHandler(d);
    expect((await handler(new Request('https://lab.example.test/lab/limits'), env)).status).toBe(401);
    expect((await handler(post('/lab/session', {}, 'b'.repeat(64)), env)).status).toBe(401);
    expect((await handler(post('/lab/session', {}, `${TOKEN}x`), env)).status).toBe(401);
    expect(d.open).not.toHaveBeenCalled();
    expect(d.limits).not.toHaveBeenCalled();
  });

  it('never echoes the token', async () => {
    const response = await createLabHandler(deps())(post('/lab/session', {}), env);
    expect(await response.text()).not.toContain(TOKEN);
  });

  it('opens a session, captures with both strategies and closes', async () => {
    const d = deps();
    const handler = createLabHandler(d);
    const opened = await handler(post('/lab/session', {}), env);
    expect(opened.status).toBe(200);
    expect(opened.headers.get('cache-control')).toBe('no-store');
    expect(await opened.json()).toMatchObject({ sessionId: 'session-0001' });

    for (const strategy of ['cdp-events', 'resource-timing']) {
      const response = await handler(post('/lab/capture', { sessionId: 'session-0001', url: 'https://www.example.de/', strategy }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ capture: { strategy }, stats: { events: 1 } });
    }
    expect(d.capture).toHaveBeenCalledTimes(2);

    const closed = await handler(post('/lab/close', { sessionId: 'session-0001' }), env);
    expect(await closed.json()).toMatchObject({ usage: { closeReasonText: 'NormalClosure' } });
  });

  it('validates the input', async () => {
    const d = deps();
    const handler = createLabHandler(d);
    const bad = [
      post('/lab/capture', { sessionId: 'session-0001', url: 'file:///etc/passwd', strategy: 'cdp-events' }),
      post('/lab/capture', { sessionId: 'session-0001', url: 'https://user:pw@example.de/', strategy: 'cdp-events' }),
      post('/lab/capture', { sessionId: 'session-0001', url: 'https://www.example.de/', strategy: 'screenshot' }),
      post('/lab/capture', { sessionId: '../x', url: 'https://www.example.de/', strategy: 'cdp-events' }),
      post('/lab/trace', {}),
    ];
    for (const request of bad) expect((await handler(request, env)).status).toBe(400);
    expect(d.capture).not.toHaveBeenCalled();
    expect((await handler(post('/lab/unknown', { sessionId: 'session-0001' }), env)).status).toBe(404);
  });

  it('reports a failing browser call as 502 with a short message', async () => {
    const d = deps();
    d.open = vi.fn(async () => {
      throw new Error('Unable to create new browser: code: 429: message: Browser time limit exceeded for today\nstack');
    });
    const response = await createLabHandler(d)(post('/lab/session', {}), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'failed', message: 'Unable to create new browser: code: 429: message: Browser time limit exceeded for today' });
  });
});

describe('lab helpers', () => {
  it('compares tokens exactly', () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken(TOKEN, `${TOKEN}a`)).toBe(false);
    expect(sameToken('', TOKEN)).toBe(false);
    expect(sameToken('b'.repeat(64), TOKEN)).toBe(false);
  });

  it('accepts only http and https addresses', () => {
    expect(isScannableUrl('https://www.example.de/')).toBe(true);
    expect(isScannableUrl('http://www.example.de/')).toBe(true);
    expect(isScannableUrl('javascript:alert(1)')).toBe(false);
    expect(isScannableUrl('ftp://example.de/')).toBe(false);
    expect(isScannableUrl(42)).toBe(false);
  });

  it('reads loc and colo from the trace page', () => {
    const text = 'fl=1f1\nh=www.cloudflare.com\nip=192.0.2.1\nts=1.2\nvisit_scheme=https\nuag=Mozilla/5.0\ncolo=FRA\nsliver=none\nhttp=http/2\nloc=DE\ntls=TLSv1.3\n';
    expect(parseTrace(text)).toEqual({ loc: 'DE', colo: 'FRA', http: 'http/2', tls: 'TLSv1.3' });
    expect(parseTrace('')).toEqual({ loc: null, colo: null, http: null, tls: null });
  });
});

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
        },
      },
      { method: 'Emulation.setLocaleOverride', params: { locale: 'de-DE' } },
      { method: 'Emulation.setTimezoneOverride', params: { timezoneId: 'Europe/Berlin' } },
    ]);
  });

  it('sets viewport and screen to 1440 x 900 on the page', () => {
    const metrics = pageEmulation(ua).find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(metrics?.params).toMatchObject({ width: 1440, height: 900, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
    expect(pageEmulation(ua).map((c) => c.method)).toContain('Emulation.setFocusEmulationEnabled');
  });

  it('computes client hints like Playwright', () => {
    expect(userAgentMetadataOf('Mozilla/5.0 (X11; Linux x86_64)')).toMatchObject({ platform: 'Linux', platformVersion: '' });
  });
});
