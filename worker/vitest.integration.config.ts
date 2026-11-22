import { defineConfig } from 'vitest/config';

// Session A5: the Cloudflare adapter on plain `wrangler dev` (local workerd and local Chrome,
// no Cloudflare account, no browser minutes) against a local fixture site.
export default defineConfig({
  test: {
    name: 'worker-integration',
    root: import.meta.dirname,
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 150_000,
    fileParallelism: false,
  },
});
