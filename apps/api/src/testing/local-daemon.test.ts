import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertBuiltBinary } from './local-daemon';

describe('Machine daemon fixtures', () => {
  it('names the build command when the daemon binary is missing', () => {
    const missing = join(tmpdir(), 'llame-no-such-machine-binary');

    expect(() => assertBuiltBinary(missing)).toThrow(
      `The Machine integration suites need the daemon binary at ${missing}: run \`pnpm --filter machine build\`.`,
    );
  });

  it('accepts a binary that exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llame-machine-'));
    const binary = join(directory, 'llame-machine');

    try {
      await writeFile(binary, '');
      expect(() => assertBuiltBinary(binary)).not.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
