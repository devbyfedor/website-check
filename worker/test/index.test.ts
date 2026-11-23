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
});
