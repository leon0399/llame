import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    ...(process.env.STRYKER_MUTATOR_WORKER !== undefined ? { testTimeout: 180_000, hookTimeout: 180_000 } : {}),
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'json'],
      reportOnFailure: true,
      // Preserve the API's pre-extraction coverage floor.
      thresholds: { lines: 90, statements: 88 },
    },
  },
});
