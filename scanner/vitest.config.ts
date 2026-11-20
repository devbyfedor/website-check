import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'scanner',
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
