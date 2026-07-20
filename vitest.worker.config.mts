import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-07-19',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: {
    include: ['apps/api/test/worker-runtime.test.ts'],
  },
});
