import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'web',
    root: import.meta.dirname,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
});
