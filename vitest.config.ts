import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'apps/coding/*/test/**/*.test.ts',
    ],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
