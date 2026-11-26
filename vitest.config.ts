import { defineConfig } from 'vitest/config';

// `npm test` runs the unit tests of every workspace. They need no browser and no network.
export default defineConfig({
  test: {
    projects: ['scanner/vitest.config.ts', 'worker/vitest.config.ts', 'web/vitest.config.ts'],
    // Session C0 part 2: no server of a test (the local D1 of wrangler among them) may get a port that Chrome and the
    // fetch of Node refuse (scanner/src/local/ports.ts). Runs once for the whole run.
    globalSetup: ['scanner/test/support/hold-bad-ports.ts'],
  },
});
