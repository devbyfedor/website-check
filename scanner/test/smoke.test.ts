import { describe, expect, it } from 'vitest';
import { SCANNER_VERSION } from '../src/index.ts';

describe('scanner package', () => {
  it('exposes its version', () => {
    expect(SCANNER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
