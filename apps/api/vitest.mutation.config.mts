import path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vitest config for Stryker only.
//
// The main config declares three projects, and the `integration` one carries a
// globalSetup that provisions Postgres through Testcontainers. Stryker copies
// the workspace into a sandbox that does not include the repo-root
// `docker/postgres/initdb/*.sql` those containers mount, so that setup crashes
// the test runner before a single mutant is evaluated. Stryker's vitest runner
// exposes only `dir`, `related`, and `configFile` — there is no way to select a
// project — so scoping happens here, by declaring only the unit project.
//
// Kept deliberately close to the `unit` project in vitest.config.mts. If that
// one changes, change this too.
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
  // design:paramtypes; vitest's default esbuild transform does not emit
  // decorator metadata, so providers would silently resolve as undefined.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/**/*.integration.test.ts',
      '**/node_modules/**',
      // Reads the operator's real llame.config.json, so it fails on any
      // machine whose local config declares a server with an unset secret.
      // Stryker refuses to start when the initial run has a failure, and a
      // developer's personal config is not a mutation-coverage signal.
      'src/mcp/mcp-runtime.module.test.ts',
    ],
    // Stryker instruments every source file, so the same suites run slower
    // here than under `pnpm --filter api test`. The 5s default trips on that
    // alone and Stryker refuses to start when the initial run has a failure.
    // Generous: Stryker adds a counter to every statement, so a test that
    // walks a byte budget over a filesystem tree (knowledge-filesystem's
    // aggregate-search cap) runs orders of magnitude slower here than under
    // `pnpm --filter api test`. Stryker refuses to start if the initial run
    // has any failure, so this must clear the slowest honest test.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
