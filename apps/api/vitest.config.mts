import path from 'node:path';

import swc from 'unplugin-swc';
import type { TestProjectConfiguration } from 'vitest/config';
import { defineConfig } from 'vitest/config';

const qualityExcludes = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.stories.tsx',
  '**/__mocks__/**',
  '**/testing/**',
  '**/db/migrations/**',
  '**/lib/api/generated/**',
  '**/vendor/**',
];

// @workspace/config-interpolation normally resolves to built ./dist; the integration
// project runs outside turbo on fresh checkouts, so compile it from source
// here instead.
const pkgSrc = (name: string) =>
  path.resolve(import.meta.dirname, '../../packages', name, 'src', 'index.ts');

// Stryker sets this in the worker it runs vitest inside; its own vitest runner
// reads the same variable. Under mutation testing the integration project must
// not load: its globalSetup provisions Postgres through Testcontainers, and
// Stryker's sandbox does not include the repo-root `docker/postgres/initdb/*.sql`
// those containers mount, so the runner crashes before evaluating one mutant.
// Stryker's vitest runner exposes only `dir`, `related`, and `configFile` — it
// has no project selector — so the selection has to happen here.
const underStryker = process.env.STRYKER_MUTATOR_WORKER !== undefined;

const unitTest = {
  name: 'unit',
  include: ['src/**/*.test.ts'],
  exclude: [
    'src/**/*.integration.test.ts',
    // Under Stryker only: this reads the operator's real llame.config.json, so
    // it fails on any machine whose local config names a server with an unset
    // secret — and Stryker refuses to start when the initial run has any
    // failure. A developer's personal config is not a mutation signal.
    ...(underStryker ? ['src/mcp/mcp-runtime.module.test.ts'] : []),
  ],
  // Raised only under Stryker: instrumentation puts a counter on every
  // statement, so knowledge-filesystem's aggregate-search byte-budget test
  // (which walks a tree) needs 30s+ where it normally takes well under a
  // second. Leaving it raised for ordinary runs would mask a genuinely hung
  // unit test.
  testTimeout: underStryker ? 180_000 : undefined,
  hookTimeout: underStryker ? 180_000 : undefined,
};

const unitProject = {
  extends: true,
  test: unitTest,
} satisfies TestProjectConfiguration;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@workspace\/knowledge-filesystem\/(.+)$/, replacement: path.resolve(import.meta.dirname, '../../packages/knowledge-filesystem/src/$1.ts') },
      { find: /^@workspace\/tool-runtime\/(.+)$/, replacement: path.resolve(import.meta.dirname, '../../packages/tool-runtime/src/$1.ts') },
      { find: /^@workspace\/runtime-safety$/, replacement: pkgSrc('runtime-safety') },
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
      // Ratchet, not an allowance (api measured 91.1% lines): raise these when coverage
      // rises, never lower one to admit a regression. The 85% target
      // lives in docs/code-quality-targets.md.
      thresholds: { lines: 90, statements: 88 },
      // Product source only: generated clients, migrations, vendored
      // code, and the test scaffolding itself are not what the 85%
      // target is about.
      include: ['src/**/*.ts'],
      exclude: qualityExcludes,
    },
    globals: true,
    environment: 'node',
    // Bounded rather than one-worker-per-core: this suite compiles Nest DI
    // graphs, which are memory-hungry enough that a 16-core runner (or a
    // memory-constrained dev machine) thrashes. Replaces the jest era's
    // --maxWorkers=2.
    maxWorkers: 4,
    projects: underStryker
      ? [unitProject]
      : [
          unitProject,
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
