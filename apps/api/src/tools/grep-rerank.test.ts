/**
 * Ranked `grep` file runs: one card per run, with a bounded path excerpt and
 * up to three matching-line excerpts, and keys padded to the last index.
 */

import { type GrepPassage } from '@workspace/native-file-tools';
import { describe, expect, it } from 'vitest';

import {
  addGrepPassages,
  artifactRunLengths,
  createPageState,
  replaceArtifactPassages,
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
  it('puts a path of exactly the card minus one unit alone, with no empty line', () => {
    const path = `/${'p'.repeat(GREP_RERANK_CARD_UNITS - 5)}.ts`;
    expect(path).toHaveLength(GREP_RERANK_CARD_UNITS - 1);

    const artifact = artifactOf([
      { locator: `${path}:1-1`, content: '1: needle', matches: [1] },
    ]);

    expect(grepRunCard(artifact, grepFileRuns(artifact)[0])).toBe(path);
  });

  it('counts every earlier line against the room of the next', () => {
    const long = artifactOf([
      {
        locator: '/a.ts:1-2',
        content: `1: ${'x'.repeat(500)}\n2: second`,
        matches: [1, 2],
      },
    ]);

    const card = grepRunCard(long, grepFileRuns(long)[0]);

    // The first line takes all the room; the second finds none.
    expect(card.split('\n')).toHaveLength(2);
    expect(card).toHaveLength(GREP_RERANK_CARD_UNITS);

    const short = artifactOf([
      {
        locator: '/a.ts:1-2',
        content: `1: first\n2: ${'y'.repeat(500)}`,
        matches: [1, 2],
      },
    ]);

    const shortCard = grepRunCard(short, grepFileRuns(short)[0]);

    expect(shortCard.split('\n')).toHaveLength(3);
    expect(shortCard.split('\n')[1]).toBe('1: first');
    expect(shortCard).toHaveLength(GREP_RERANK_CARD_UNITS);
  });

  it('reads match lines numbered with several digits, from the line start only', () => {
    const artifact = artifactOf([
      {
        locator: '/a.ts:9-12',
        content: [
          '9: nine',
          '10: ten',
          'note 11: not a numbered line',
          '12: twelve',
        ].join('\n'),
        matches: [10, 11, 12],
      },
    ]);

    expect(
      grepRunCard(artifact, grepFileRuns(artifact)[0]).split('\n'),
    ).toEqual(['/a.ts', '10: ten', '12: twelve']);
  });

  it('keeps single-digit keys for up to ten runs', () => {
    expect(grepFileRuns(artifactOf(files(10))).map((run) => run.key)).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
      'p9',
    ]);
  });
});

describe('replaced artifact passages', () => {
  const first: GrepPassage = {
    locator: '/a.ts:1-1',
    content: '1: one',
    matches: [1],
  };

  const second: GrepPassage = {
    locator: '/a.ts:20-20',
    content: '20: two',
    matches: [20],
  };

  it('sums the block bytes of the rebuilt artifact', () => {
    const artifact = artifactOf([first, second]);
    const built = artifact.lineBytes;
    replaceArtifactPassages(artifact, [first, second], [true, false]);

    expect(artifact.lineBytes).toBeGreaterThan(0);
    expect(artifact.lineBytes).toBe(
      artifact.blocks.reduce((total, block) => total + block.bytes, 0),
    );
    expect(artifact.lineBytes).toBe(built);
  });

  it('counts a first block that does not open as one run', () => {
    const artifact = artifactOf([first, second]);
    replaceArtifactPassages(artifact, [first, second], [false, false]);

    expect(artifactRunLengths(artifact)).toEqual([2]);
  });

  it('derives the boundary from the earlier passage where none is given', () => {
    const artifact = artifactOf([first, second]);
    replaceArtifactPassages(artifact, [first, second], [true]);

    expect(artifact.blocks.map((block) => block.newRun)).toEqual([true, false]);
  });
});
