import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS DI resolves constructor parameters from reflect-metadata's
  // design:paramtypes. Vitest's default esbuild transform does not emit
  // decorator metadata, so without this plugin Test.createTestingModule
  // resolves every provider as undefined — silently. unplugin-swc reads
  // tsconfig.json (emitDecoratorMetadata: true) and emits it.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          setupFiles: ['./vitest.integration.setup.ts'],
          // Files sequential in one worker (jest --runInBand equivalent):
          // every suite opens its own pool against ONE throwaway database;
          // parallel workers contend on it and a real RLS regression could be
          // misread as a flake.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['e2e/**/*.test.ts'],
          setupFiles: ['./e2e/setup.ts'],
          // Sequential in one worker, like the integration project.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'evals',
          include: ['evals/**/*.test.ts'],
          // Model-graded, costs provider spend — opt-in via test:evals
          // (RUN_MODEL_EVALS=1), never part of test / test:e2e.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
