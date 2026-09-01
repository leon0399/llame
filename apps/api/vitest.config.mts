import path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// @workspace/config-interpolation normally resolves to built ./dist; the integration
// project runs outside turbo on fresh checkouts, so compile it from source
// here instead.
const pkgSrc = (name: string) =>
  path.resolve(import.meta.dirname, '../../packages', name, 'src', 'index.ts');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@workspace\/config-interpolation$/,
        replacement: pkgSrc('config-interpolation'),
      },
    ],
  },
  // NestJS DI resolves constructor parameters from reflect-metadata's
  // design:paramtypes. Vitest's default esbuild transform does not emit
  // decorator metadata, so without this plugin Test.createTestingModule
  // resolves every provider as undefined — silently. unplugin-swc reads
  // tsconfig.json (emitDecoratorMetadata: true) and emits it.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    coverage: {
      provider: 'v8',
      // Write the report even when a test fails: the metric targets in
      // docs/code-quality-targets.md need a number from every run, and a
      // single unrelated failure otherwise yields none at all.
      reportOnFailure: true,
      reporter: ['text-summary', 'json'],
      reportsDirectory: './coverage',
      // Product source only: generated clients, migrations, vendored
      // code, and the test scaffolding itself are not what the 85%
      // target is about.
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.stories.tsx',
        '**/__mocks__/**',
        '**/testing/**',
        '**/db/migrations/**',
        '**/lib/api/generated/**',
        '**/vendor/**',
      ],
    },
    globals: true,
    environment: 'node',
    // Bounded rather than one-worker-per-core: this suite compiles Nest DI
    // graphs, which are memory-hungry enough that a 16-core runner (or a
    // memory-constrained dev machine) thrashes. Replaces the jest era's
    // --maxWorkers=2.
    maxWorkers: 4,
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
          // evals/ rides this project rather than owning one: qa-evals
          // self-gates on RUN_MODEL_EVALS (spend), so a plain
          // test:integration run skips it.
          include: ['src/**/*.integration.test.ts', 'evals/**/*.test.ts'],
          exclude: ['evals/mcp-web-search-eval.test.ts'],
          // Self-provisions a throwaway worst-case-owner Postgres via
          // Testcontainers; TEST_DATABASE_URL overrides (no container).
          globalSetup: ['./vitest.integration.global-setup.mts'],
          setupFiles: ['./vitest.integration.setup.ts'],
          // Files sequential in one worker: every suite opens its own pool
          // against ONE throwaway database; parallel workers contend on it
          // and a real RLS regression could be misread as a flake.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'mcp-live-eval',
          include: ['evals/mcp-web-search-eval.test.ts'],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
