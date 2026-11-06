/**
 * Ranked `grep` file runs: one card per run, with a bounded path excerpt and
 * up to three matching-line excerpts, and keys padded to the last index.
 */

import { type GrepPassage } from '@workspace/native-file-tools';
import { describe, expect, it } from 'vitest';

import {
  addGrepPassages,
  createPageState,
  type GrepArtifact,
} from './grep-page';
import {
  GREP_RERANK_CARD_UNITS,
  grepFileRuns,
  grepRunCard,
} from './grep-rerank';

function artifactOf(passages: ReadonlyArray<GrepPassage>): GrepArtifact {
  const artifact = createPageState({
    maxBytes: 10_000_000,
    mayCarryKnowledge: false,
  }).artifact;
  addGrepPassages(artifact, passages);
  return artifact;
}

/** `count` single-passage files, one matching line each. */
function files(count: number): Array<GrepPassage> {
  return Array.from({ length: count }, (_, index) => ({
    locator: `/src/file-${String(index).padStart(2, '0')}.ts:1-1`,
    content: '1: needle',
    matches: [1],
  }));
}

describe('grep file runs', () => {
  it('groups consecutive passages of one file into one run', () => {
    const artifact = artifactOf([
      { locator: '/a.ts:1-2', content: '1: alpha\n2: one', matches: [2] },
      { locator: '/a.ts:10-11', content: '10: beta\n11: two', matches: [11] },
      { locator: '/b.ts:5-5', content: '5: three', matches: [5] },
    ]);

    expect(grepFileRuns(artifact)).toEqual([
      { key: 'p0', path: '/a.ts', indices: [0, 1] },
      { key: 'p1', path: '/b.ts', indices: [2] },
    ]);
  });

  it('pads keys to the width of the last index', () => {
    const runs = grepFileRuns(artifactOf(files(11)));

    expect(runs.map((run) => run.key)).toEqual([
      'p00',
      'p01',
      'p02',
      'p03',
      'p04',
      'p05',
      'p06',
      'p07',
      'p08',
      'p09',
      'p10',
    ]);
  });

  it('holds the path and the first three matching lines, never context', () => {
    const lines = Array.from(
      { length: 6 },
      (_, index) => `${String(index + 1)}: match ${'m'.repeat(60)}`,
    );
    const artifact = artifactOf([
      {
        locator: '/src/deep/file.ts:1-7',
        content: ['0: context', ...lines].join('\n'),
        matches: [1, 2, 3, 4, 5, 6],
      },
    ]);
    const [run] = grepFileRuns(artifact);
    const card = grepRunCard(artifact, run);

    expect(card.split('\n')).toEqual([
      '/src/deep/file.ts',
      ...lines.slice(0, 3),
    ]);
    expect(card).not.toContain('context');
    expect(card.length).toBeLessThanOrEqual(GREP_RERANK_CARD_UNITS);
  });

  it('bounds a path longer than the card', () => {
    const path = `/${'p'.repeat(500)}.ts`;
    const artifact = artifactOf([
      { locator: `${path}:1-1`, content: '1: needle', matches: [1] },
    ]);
    const card = grepRunCard(artifact, grepFileRuns(artifact)[0]);

    expect(card).toBe(path.slice(0, GREP_RERANK_CARD_UNITS));
  });

  it('excerpts a line that exceeds the room left in the card', () => {
    const artifact = artifactOf([
      {
        locator: '/a.ts:1-1',
        content: `1: ${'x'.repeat(500)}`,
        matches: [1],
      },
    ]);
    const card = grepRunCard(artifact, grepFileRuns(artifact)[0]);

    expect(card.startsWith('/a.ts\n1: x')).toBe(true);
    expect(card).toHaveLength(GREP_RERANK_CARD_UNITS);
  });
});
