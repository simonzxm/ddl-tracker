import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    include: [
      'apps/**/test/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
    ],
    exclude: ['apps/api/test/worker-runtime.test.ts'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
