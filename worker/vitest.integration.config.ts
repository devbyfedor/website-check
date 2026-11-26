import { defineConfig } from 'vitest/config';

// Session A5: the Cloudflare adapter on plain `wrangler dev` (local workerd and local Chrome,
// no Cloudflare account, no browser minutes) against local fixture sites: `ssrf-dev.test.ts` runs the lab
// Workers of the end-to-end check (real API and queue object), the other files the capture function on a local Chromium.
export default defineConfig({
  test: {
    name: 'worker-integration',
    root: import.meta.dirname,
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 150_000,
    fileParallelism: false,
    // Session C0 part 2: no fixture server, no local runtime of wrangler and no debugging port of Chrome on a port that
    // Chrome and the fetch of Node refuse (scanner/src/local/ports.ts).
    globalSetup: ['../scanner/test/support/hold-bad-ports.ts'],
  },
});
