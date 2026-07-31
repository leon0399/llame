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
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.integration.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.spec.ts'],
          setupFiles: ['./vitest.integration.setup.ts'],
          // Files sequential in one worker (jest --runInBand equivalent):
          // every suite opens its own pool against ONE throwaway database;
          // parallel workers contend on it and a real RLS regression could be
          // misread as a flake. Threads, not forks: Nest's
          // Test.createTestingModule(...).compile() of the WorkerModule graph
          // deadlocks under the forks pool (reproduced with a minimal spec;
          // same compile passes in a worker thread).
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          setupFiles: ['./test/vitest.e2e.setup.ts'],
          // Sequential in one worker thread, like the integration project —
          // see that project's pool comment.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
