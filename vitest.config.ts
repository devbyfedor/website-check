import { defineConfig } from 'vitest/config';

// `npm test` runs the unit tests of every workspace. They need no browser and no network.
export default defineConfig({
  test: {
    projects: ['scanner/vitest.config.ts', 'worker/vitest.config.ts', 'web/vitest.config.ts'],
  },
});
