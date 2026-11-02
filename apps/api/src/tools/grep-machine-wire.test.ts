import { describe, expect, it } from 'vitest';

import { type FsGrepSuccess } from '@workspace/machine-protocol';

import {
  ignoredAccumulator,
  mergePage,
  type IgnoredAccumulator,
} from './grep-machine-wire';
import { type MachineGrepScope } from './grep-machine';

const SCOPE: MachineGrepScope = {
  index: 0,
  name: 'devl',
  path: '/srv',
  globSuffix: undefined,
};

function pageOf(paths: ReadonlyArray<string>): FsGrepSuccess {
  return {
    ok: true,
    results: [],
    complete: true,
    warnings: [],
    consumed: { files: 0, entries: 0, bytes: 0 },
    progressed: false,
    ignored: { paths, atLeast: false },
  };
}

/** Fold a page into one scope's accumulator, as the daemon loop does. */
function fold(ignored: IgnoredAccumulator, paths: ReadonlyArray<string>): void {
  mergePage(
    new Map(),
    { files: 0, entries: 0, bytes: 0 },
    ignored,
    pageOf(paths),
  );
}

describe('mergePage', () => {
  it('caps one scope at one thousand directories across pages', () => {
    const ignored = ignoredAccumulator(SCOPE);
    const first = Array.from(
      { length: 600 },
      (_, index) => `a${String(index)}`,
    );
    const second = Array.from(
      { length: 600 },
      (_, index) => `b${String(index)}`,
    );
    fold(ignored, first);
    expect(ignored.paths).toHaveLength(600);
    expect(ignored.atLeast).toBe(false);
    fold(ignored, second);
    expect(ignored.paths).toHaveLength(1000);
    expect(ignored.rels).toHaveLength(1000);
    expect(ignored.atLeast).toBe(true);
  });
});
