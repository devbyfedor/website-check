import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';

describe('worker skeleton', () => {
  it('answers 501 until the API exists', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/scans'));
    expect(response.status).toBe(501);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'not_implemented' });
  });
});
