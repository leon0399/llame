/**
 * Ranked `grep` file runs (decision-lane experiment, shadow/on modes): one card
 * per file run, a stage-1 prefilter that keeps at most 48, a permutation of
 * whole runs, and the block and finding renumbering that keeps every later
 * step consistent with the reordered text.
 */

import { type GrepPassage } from '@workspace/native-file-tools';
import { describe, expect, it } from 'vitest';

import {
  type CandidateJudgement,
  type DecisionJudge,
  type JudgeCandidatesInput,
} from '../decisions/decisions.service';
import { type ToolRerankMode } from '../instance-config/tool-rerank-config';
import {
  applyGrepRerank,
  GREP_RERANK_CARD_UNITS,
  GREP_RERANK_MAX_CARDS,
  GREP_RERANK_RUBRIC,
  grepFileRuns,
  grepRunCard,
  planGrepRerank,
  prefilterGrepRuns,
} from './grep-rerank';
import {
  addGrepPassages,
  createPageState,
  grepArtifactFindings,
  grepArtifactText,
  type GrepArtifact,
} from './grep-page';

/** An artifact holding exactly these passages, as the walk would build it. */
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
    content: `1: const needle${String(index)} = ${String(index)};`,
    matches: [1],
  }));
}

type LaneDouble = {
  readonly decisions: Partial<DecisionJudge>;
  /** The tool's own `tools.grep.rerank` block; absent means off. */
  readonly rerank:
    | { readonly mode: ToolRerankMode; readonly model: string }
    | undefined;
  readonly calls: Array<JudgeCandidatesInput>;
};

/** A lane double that answers the keys in `answers` and records the call. */
function laneOf(
  mode: ToolRerankMode | undefined,
  answers?: Record<string, number> | 'unavailable',
): LaneDouble {
  const calls: Array<JudgeCandidatesInput> = [];
  return {
    calls,
    rerank: mode === undefined ? undefined : { mode, model: 'jev' },
    decisions: {
      judgeCandidates: (input: JudgeCandidatesInput) => {
        calls.push(input);
        const judgement: CandidateJudgement =
          answers === undefined ||
          answers === 'unavailable' ||
          Object.keys(answers).length === 0
            ? {
                status: 'unavailable',
                probabilities: undefined,
                usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
                model: null,
                latencyMs: 1,
              }
            : {
                status: 'answered',
                probabilities: new Map(Object.entries(answers)),
                usage: { inputTokens: 12, outputTokens: 0, costUsd: 0.0005 },
                model: 'jev-test',
                latencyMs: 40,
              };
        return Promise.resolve(judgement);
      },
    },
  };
}

const planOf = async (
  artifact: GrepArtifact,
  lane: LaneDouble | undefined,
  objective?: string,
) =>
  planGrepRerank({
    artifact,
    decisions: lane?.decisions,
    rerank: lane?.rerank,
    runId: 'run-a',
    chatId: 'chat-a',
    request: {
      patterns: ['needle'],
      ...(objective !== undefined && { objective }),
    },
  });

describe('grep file runs', () => {
  it('groups consecutive passages of one file into one run', () => {
    const artifact = artifactOf([
      {
        locator: '/a.ts:1-2',
        content: '1: alpha\n2: needle one',
        matches: [2],
      },
      {
        locator: '/a.ts:10-11',
        content: '10: beta\n11: needle two',
        matches: [11],
      },
      { locator: '/b.ts:5-5', content: '5: needle three', matches: [5] },
    ]);

    expect(grepFileRuns(artifact)).toEqual([
      { key: 'p00', path: '/a.ts', indices: [0, 1] },
      { key: 'p01', path: '/b.ts', indices: [2] },
    ]);
  });

  it('builds a card from the path and whole matching lines, never context', () => {
    const artifact = artifactOf([
      {
        locator: '/a.ts:1-2',
        content: '1: alpha\n2: needle one',
        matches: [2],
      },
      { locator: '/a.ts:10-10', content: '10: needle two', matches: [10] },
    ]);

    expect(grepRunCard(artifact, grepFileRuns(artifact)[0])).toBe(
      '/a.ts\n2: needle one\n10: needle two',
    );
  });

  it('keeps a card inside its unit bound and at most three lines', () => {
    const long = `1: needle ${'x'.repeat(GREP_RERANK_CARD_UNITS)}`;
    const artifact = artifactOf([
      {
        locator: '/a.ts:1-4',
        content: `${long}\n2: needle b\n3: needle c\n4: needle d`,
        matches: [1, 2, 3, 4],
      },
    ]);

    const card = grepRunCard(artifact, grepFileRuns(artifact)[0]);
    expect(card).toBe('/a.ts');
    expect(card.length).toBeLessThanOrEqual(GREP_RERANK_CARD_UNITS);

    const short = artifactOf([
      {
        locator: '/a.ts:1-4',
        content: '1: needle a\n2: needle b\n3: needle c\n4: needle d',
        matches: [1, 2, 3, 4],
      },
    ]);
    expect(grepRunCard(short, grepFileRuns(short)[0]).split('\n')).toHaveLength(
      4,
    );
  });

  it('ranks the runs whose path or lines hold the objective first', () => {
    const artifact = artifactOf(files(3));
    const runs = grepFileRuns(artifact);
    const [first] = prefilterGrepRuns(artifact, runs, {
      patterns: ['needle'],
      objective: 'where is file-02 registered',
    });

    expect(first?.path).toBe('/src/file-02.ts');
  });

  it('keeps at most 48 runs and drops the rest to canonical order', () => {
    const artifact = artifactOf(files(GREP_RERANK_MAX_CARDS + 12));
    const runs = grepFileRuns(artifact);

    expect(
      prefilterGrepRuns(artifact, runs, { patterns: ['needle'] }),
    ).toHaveLength(GREP_RERANK_MAX_CARDS);
  });
});

describe('planGrepRerank', () => {
  it('never calls the lane without a tools.grep.rerank block', async () => {
    const decisions = laneOf(undefined, { p00: 0.9 });
    const plan = await planOf(artifactOf(files(4)), decisions);

    expect(plan).toBeUndefined();
    expect(decisions.calls).toHaveLength(0);
  });

  it('never calls the lane for fewer than three file runs', async () => {
    const decisions = laneOf('on', { p00: 0.9, p01: 0.1 });
    const plan = await planOf(artifactOf(files(2)), decisions);

    expect(plan).toBeUndefined();
    expect(decisions.calls).toHaveLength(0);
  });

  it('never calls a lane the host did not supply', async () => {
    expect(await planOf(artifactOf(files(4)), undefined)).toBeUndefined();
  });

  it('asks one question per card with the tool rubric and the objective', async () => {
    const decisions = laneOf('on', { p00: 0.9 });
    await planOf(artifactOf(files(4)), decisions, 'the index entry');

    const call = decisions.calls[0];
    expect(call?.model).toBe('jev');
    expect(call?.tool).toBe('grep');
    expect(call?.rubric).toBe(GREP_RERANK_RUBRIC);
    expect(call?.objective).toBe('the index entry');
    expect(call?.query).toBe('needle');
    expect(call?.cards.map((card) => card.key)).toEqual([
      'p00',
      'p01',
      'p02',
      'p03',
    ]);
  });

  it('leaves everything alone when the lane is unavailable', async () => {
    const plan = await planOf(
      artifactOf(files(4)),
      laneOf('shadow', 'unavailable'),
    );

    expect(plan).toBeUndefined();
  });

  it('orders judged runs by probability and keeps unjudged ones canonical', async () => {
    const artifact = artifactOf(files(4));
    const plan = await planOf(
      artifact,
      laneOf('on', { p00: 0.1, p01: 0.9, p02: 0.5 }),
    );

    // p01 > p02 > p00, then the never-judged p03 keeps canonical order.
    expect(plan?.record.order).toEqual(['p01', 'p02', 'p00', 'p03']);
    expect(plan?.record.unjudged).toBe(1);
    expect(plan?.record.model).toBe('jev-test');
    expect(plan?.record.costUsd).toBe(0.0005);
  });

  it('does not mutate the artifact while planning', async () => {
    const artifact = artifactOf(files(4));
    const before = artifact.results.map((passage) => passage.locator);
    await planOf(artifact, laneOf('shadow', { p00: 0.01, p01: 0.99 }));

    expect(artifact.results.map((passage) => passage.locator)).toEqual(before);
  });
});

describe('applyGrepRerank', () => {
  it('keeps every run contiguous and reopens one heading per file', async () => {
    const artifact = artifactOf([
      { locator: '/a.ts:1-1', content: '1: needle a', matches: [1] },
      { locator: '/a.ts:5-5', content: '5: needle a again', matches: [5] },
      { locator: '/b.ts:2-2', content: '2: needle b', matches: [2] },
      { locator: '/c.ts:3-3', content: '3: needle c', matches: [3] },
    ]);
    const bytes = artifact.lineBytes;
    const plan = await planOf(
      artifact,
      laneOf('on', { p00: 0.1, p01: 0.2, p02: 0.9 }),
    );
    if (plan === undefined) throw new Error('the lane must answer');

    applyGrepRerank(artifact, plan.runs, plan.order);

    // /c.ts, then /b.ts, then /a.ts with both of its passages together.
    expect(artifact.results.map((passage) => passage.locator)).toEqual([
      '/c.ts:3-3',
      '/b.ts:2-2',
      '/a.ts:1-1',
      '/a.ts:5-5',
    ]);
    expect(artifact.blocks.map((block) => block.newRun)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(artifact.lineBytes).toBe(bytes);

    const lines = grepArtifactText(artifact).split('\n');
    for (const finding of grepArtifactFindings(artifact)) {
      expect(lines[finding.start - 1]).toBe(`## ${finding.locators[0]}`);
      expect(finding.end).toBeGreaterThanOrEqual(finding.start);
    }
  });

  it('leaves inline line numbers equal to the artifact lines', async () => {
    const artifact = artifactOf([
      { locator: '/a.ts:1-1', content: '1: needle a', matches: [1] },
      { locator: '/b.ts:1-1', content: '1: needle b', matches: [1] },
      { locator: '/c.ts:1-1', content: '1: needle c', matches: [1] },
    ]);
    const plan = await planOf(
      artifact,
      laneOf('on', { p00: 0.3, p01: 0.4, p02: 0.5 }),
    );
    if (plan === undefined) throw new Error('the lane must answer');

    applyGrepRerank(artifact, plan.runs, plan.order);

    const findings = grepArtifactFindings(artifact);
    expect(findings.map((finding) => finding.locators[0])).toEqual([
      '/c.ts',
      '/b.ts',
      '/a.ts',
    ]);
    expect(findings.map((finding) => finding.start)).toEqual([1, 3, 5]);
  });
});
