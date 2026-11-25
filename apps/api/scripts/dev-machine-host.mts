#!/usr/bin/env node
/**
 * Prepares the local Machine a `pnpm dev` API serves. The API discovers its
 * own static `llame-machine` binary with `attach --print-socket`, after this
 * helper registers the checkout and temporary directory as roots.
 *
 * Runs the daemon binary's own `roots add`, so canonicalisation and file format
 * are the daemon's, and registration is idempotent.
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
import { daemonBinary } from '@workspace/machine-protocol';

const here = import.meta.dirname;
const apiRoot = resolve(here, '..');
const repoRoot = resolve(apiRoot, '../..');
const binary = daemonBinary();
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

if (!existsSync(binary)) {
  console.error(
    `dev-machine-host: ${binary} is missing; build it with \`pnpm --filter machine build\` first.`,
  );
  process.exit(1);
}

mkdirSync(configDir, { recursive: true });

// The directory is generated state; ignore it locally without touching the
// repository's own ignore rules.
writeFileSync(resolve(repoRoot, '.llame-dev/.gitignore'), '*\n', 'utf8');

for (const root of [resolve(repoRoot, '..'), tmpdir(), ...extraRoots()]) {
  execFileSync(binary, ['roots', 'add', root], {
    env: { ...process.env, LLAME_MACHINE_CONFIG_DIR: configDir },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
console.log(binary);
