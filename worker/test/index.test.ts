import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/app.ts';
import { localD1, type LocalD1 } from './d1.ts';

let d1: LocalD1;

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);

afterAll(async () => {
  await d1?.dispose();
});

describe('worker entry point', () => {
  it('routes the API with the D1 binding', async () => {
    const env = { DB: d1.db };
    const unknown = await worker.fetch(new Request('https://website-check.test/api/scans/aaaaaaaaaaaaaaaaaaaaaaaaaa'), env);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    const refused = await worker.fetch(new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"http://127.0.0.1/"}' }), env);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'address-not-allowed', reason: 'address' });
  });

  it('refuses to work when the local dev switch is set on a real host (A5 part 3 review)', async () => {
    const env = { DB: d1.db, DEV_MODE: '1', DEV_ORIGINS: 'http://127.0.0.1:8788' };
    const response = await worker.fetch(new Request('https://website-check.test/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"http://127.0.0.1:8788/"}' }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'misconfigured' });
  });

  it('lets only the exact fixture origin through in local dev mode, nothing else on the loopback (session fix-a6)', async () => {
    const start = async (env: Record<string, unknown>, url: string) => {
      const response = await worker.fetch(
        new Request('http://127.0.0.1:8788/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }),
        { DB: d1.db, ...env },
      );
      return response.status;
    };
    const dev = { DEV_MODE: '1', DEV_ORIGINS: 'http://localhost:4000' };
    // Past the address rules the start reaches the queue, which these unit tests do not bind: 503, not 400.
    expect(await start(dev, 'http://localhost:4000/')).toBe(503);
    for (const url of ['http://127.0.0.1:4000/', 'http://localhost:4001/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://2130706433:4000/']) {
      expect(await start(dev, url), url).toBe(400);
    }
    // Without the dev switch the origins are ignored, also for a request to the loopback.
    expect(await start({ DEV_ORIGINS: 'http://localhost:4000' }, 'http://localhost:4000/')).toBe(400);
  });
});
