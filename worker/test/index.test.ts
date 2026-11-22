import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
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
});
