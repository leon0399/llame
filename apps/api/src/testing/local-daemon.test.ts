import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertBuiltBundle } from './local-daemon';

describe('Machine daemon fixtures', () => {
  it('names the build command when the daemon bundle is missing', () => {
    const missing = join(tmpdir(), 'llame-no-such-machine-bundle.cjs');

    expect(() => assertBuiltBundle(missing)).toThrow(
      `The Machine file and grep integration suites need the built daemon at ${missing}: run \`pnpm --filter machine build\`.`,
    );
  });

  it('accepts a bundle that exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llame-bundle-'));
    const bundle = join(directory, 'llame-machine.cjs');

    try {
      await writeFile(bundle, '');
      expect(() => assertBuiltBundle(bundle)).not.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
