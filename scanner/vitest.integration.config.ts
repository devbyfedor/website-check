import { defineConfig } from 'vitest/config';

// Integration tests start a real Chromium (Playwright) against local fixture pages.
// No request leaves the machine: fixture host names are mapped to 127.0.0.1.
export default defineConfig({
  test: {
    name: 'scanner-integration',
    root: import.meta.dirname,
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
