import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'worker',
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    // The wrangler dev tests start a browser: `npm run test:integration` runs them.
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
