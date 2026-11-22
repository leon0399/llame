#!/usr/bin/env node
/**
 * Prepares the local Machine a `pnpm dev` API serves (host-as-machine design
 * D12). The API talks to its own Machine through `llame-machine serve --stdio`
 * with a fixed configuration directory, so a developer's checkout needs that
 * directory to exist and to have the tree it works in registered as a root.
 *
 * Runs the built bundle's own `roots add`, so the canonicalisation and the file
 * format are the daemon's, and it is idempotent: registering a root twice
 * writes nothing.
 *
 * `LLAME_MACHINE_EXTRA_ROOTS` adds roots a harness needs beyond the checkout
 * and the temp directory — the e2e suite's host-file fixtures live outside
 * both — separated by the platform's path delimiter. A developer's `pnpm dev`
 * leaves it unset.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';

const here = import.meta.dirname;
const apiRoot = resolve(here, '..');
const repoRoot = resolve(apiRoot, '../..');
const bundle = resolve(repoRoot, 'apps/machine/dist/llame-machine.cjs');
const configDir = resolve(repoRoot, '.llame-dev/machine-host');

/** Extra roots from the environment, in the order the harness named them. */
function extraRoots(): ReadonlyArray<string> {
  const value = process.env['LLAME_MACHINE_EXTRA_ROOTS'];

  if (value === undefined) return [];

  return value
    .split(delimiter)
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
}

if (!existsSync(bundle)) {
  console.error(
    `dev-machine-host: ${bundle} is missing; build it with \`pnpm --filter machine build\` first.`,
  );
  process.exit(1);
}

mkdirSync(configDir, { recursive: true });

// The directory is generated state; ignore it locally without touching the
// repository's own ignore rules.
writeFileSync(resolve(repoRoot, '.llame-dev/.gitignore'), '*\n', 'utf8');

for (const root of [resolve(repoRoot, '..'), tmpdir(), ...extraRoots()]) {
  execFileSync(process.execPath, [bundle, 'roots', 'add', root], {
    env: { ...process.env, LLAME_MACHINE_CONFIG_DIR: configDir },
    stdio: 'inherit',
  });
}
