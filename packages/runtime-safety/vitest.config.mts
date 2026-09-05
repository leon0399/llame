import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
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
