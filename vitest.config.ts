import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      'apps/coding/*/test/**/*.test.ts',
    ],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
