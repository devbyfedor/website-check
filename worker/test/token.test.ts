import { describe, expect, it } from 'vitest';
import { sameToken } from '../src/lab/token.ts';

const TOKEN = 'a'.repeat(64);

describe('lab token comparison', () => {
  it('compares tokens exactly', () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken(TOKEN, `${TOKEN}a`)).toBe(false);
    expect(sameToken('', TOKEN)).toBe(false);
    expect(sameToken('b'.repeat(64), TOKEN)).toBe(false);
  });
});
