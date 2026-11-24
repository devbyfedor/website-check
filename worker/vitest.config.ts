import { resolve } from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
  // The queue object imports `cloudflare:workers`, which exists only in the Workers runtime: a stub for its unit test.
  resolve: { alias: { 'cloudflare:workers': resolve(import.meta.dirname, 'test/stubs/cloudflare-workers.ts') } },
  test: {
    name: 'worker',
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    // The wrangler dev tests start a browser: `npm run test:integration` runs them.
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
