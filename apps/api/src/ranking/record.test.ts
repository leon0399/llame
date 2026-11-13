import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  type CandidateJudgement,
  type JudgeCandidatesInput,
} from '../decisions/decisions.service';
import { type RankingCase, type RecordedAnswer } from './fixtures';
import {
  fileSink,
  recordAll,
  recordCase,
  type RecordSink,
  reversedVariant,
  selectModels,
} from './record';
import { GREP_RERANK_RUBRIC, WEB_SEARCH_RERANK_RUBRIC } from './rubrics';

const grepCase: RankingCase = {
  name: 'case-a',
  tool: 'grep',
  query: 'q',
  objective: 'find it',
  cards: [
    { key: 'a', text: 'a', relevant: false },
    { key: 'b', text: 'b', relevant: true },
  ],
};

function judgement(scores: Record<string, number>): CandidateJudgement {
  const map = new Map(Object.entries(scores));

  return {
    status: map.size === 0 ? 'unavailable' : 'answered',
    probabilities: map.size === 0 ? undefined : map,
    unanswered: [],
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 },
    model: 'served',
    latencyMs: 7,
  };
}

function harness(scores: Record<string, number>) {
  const judgeCandidates = vi.fn((_input: JudgeCandidatesInput) =>
    Promise.resolve(judgement(scores)),
  );

  const written: Array<[string, string, RecordedAnswer]> = [];
  const lines: Array<string> = [];

  const sink: RecordSink = {
    write: (name, model, answer) => written.push([name, model, answer]),
    log: (line) => lines.push(line),
  };

  return { judge: { judgeCandidates }, judgeCandidates, sink, written, lines };
}

describe('selectModels', () => {
  it('records the whole catalogue when nothing is requested', () => {
    expect(selectModels(['m1', 'm2'], [])).toEqual(['m1', 'm2']);
  });

  it('records only the requested catalogue ids', () => {
    expect(selectModels(['m1', 'm2'], ['m2'])).toEqual(['m2']);
  });

  it('rejects ids outside the catalogue and names the catalogue', () => {
    expect(() => selectModels(['m1'], ['x', 'm1', 'y'])).toThrow(
      'Not in decisionModels[] or rerankModels[]: x, y. Catalogue: m1.',
    );
    expect(() => selectModels(['m1', 'm2'], ['x'])).toThrow(
      'Catalogue: m1, m2.',
    );
    expect(() => selectModels([], ['x'])).toThrow('Catalogue: (empty).');
  });

  it('rejects an empty catalogue with nothing requested', () => {
    expect(() => selectModels([], [])).toThrow(
      'No decisionModels[] or rerankModels[] in the operator config to record.',
    );
  });
});

describe('recordCase', () => {
  it('writes the judged answer and logs the status', async () => {
    const h = harness({ a: 0.1, b: 0.9 });
    await expect(recordCase(h.judge, h.sink, grepCase, 'm1')).resolves.toBe(
      true,
    );
    expect(h.written).toEqual([
      [
        'case-a',
        'm1',
        {
          model: 'm1',
          status: 'ranked',
          scores: { a: 0.1, b: 0.9 },
          latencyMs: 7,
          costUsd: 0.5,
        },
      ],
    ]);
    expect(h.lines).toEqual(['case-a m1: ranked']);
  });

  it('records a partial judgement', async () => {
    const h = harness({ b: 0.9 });
    await recordCase(h.judge, h.sink, grepCase, 'm1');
    expect(h.written[0]?.[2].status).toBe('partial');
  });

  it('writes nothing for an unavailable judgement', async () => {
    const h = harness({});
    await expect(recordCase(h.judge, h.sink, grepCase, 'm1')).resolves.toBe(
      false,
    );
    expect(h.written).toEqual([]);
    expect(h.lines).toEqual(['case-a m1: unavailable']);
  });

  it('sends the tool rubric, card bound, and objective to the judge', async () => {
    const h = harness({ a: 0.1, b: 0.9 });
    await recordCase(h.judge, h.sink, grepCase, 'm1');
    const request = h.judgeCandidates.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: 'm1',
      tool: 'grep',
      runId: 'ranking-record',
      chatId: 'ranking-record',
      query: 'q',
      objective: 'find it',
      cardBound: 384,
    });
    expect(request?.rubric).toBe(GREP_RERANK_RUBRIC);
  });

  it('uses the web_search rubric and bound, and omits an absent objective', async () => {
    const h = harness({ a: 0.1, b: 0.9 });
    const { objective: _objective, ...rest } = grepCase;
    await recordCase(h.judge, h.sink, { ...rest, tool: 'web_search' }, 'm1');
    const request = h.judgeCandidates.mock.calls[0]?.[0];
    expect(request?.cardBound).toBe(400);
    expect(request?.rubric).toBe(WEB_SEARCH_RERANK_RUBRIC);
    expect(request).not.toHaveProperty('objective');
  });
});

describe('recordAll', () => {
  it('records every case with every model', async () => {
    const h = harness({ a: 0.1, b: 0.9 });
    await recordAll(
      h.judge,
      h.sink,
      [grepCase, { ...grepCase, name: 'case-b' }],
      ['m1', 'm2'],
    );
    expect(h.written.map(([name, model]) => `${name}.${model}`)).toEqual([
      'case-a.m1',
      'case-a.m2',
      'case-b.m1',
      'case-b.m2',
    ]);
  });

  it('judges everything, then throws the count of unavailable judgements', async () => {
    const h = harness({});
    await expect(
      recordAll(h.judge, h.sink, [grepCase], ['m1', 'm2']),
    ).rejects.toThrow('2 judgement(s) unavailable and not written.');
    expect(h.judgeCandidates).toHaveBeenCalledTimes(2);
  });
});

describe('reversedVariant', () => {
  it('reverses the cards and records the answer under the reversed label', async () => {
    const h = harness({ a: 0.1, b: 0.9 });
    const variant = reversedVariant([grepCase], h.sink);

    await recordCase(h.judge, variant.sink, variant.cases[0] ?? grepCase, 'm1');

    expect(
      h.judgeCandidates.mock.calls[0]?.[0].cards.map((card) => card.key),
    ).toEqual([...grepCase.cards].reverse().map((card) => card.key));
    expect(h.written[0]?.[1]).toBe('m1~reversed');
    expect(h.written[0]?.[2].model).toBe('m1~reversed');
    expect(h.written[0]?.[2].scores).toEqual({ a: 0.1, b: 0.9 });
    expect(h.lines).toEqual(['case-a m1: ranked (reversed)']);
  });
});

describe('fileSink', () => {
  it('creates the directory and writes one JSON file per case and model', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')), 'a');

    const answer: RecordedAnswer = {
      model: 'jev-1.14',
      status: 'ranked',
      scores: { a: 0.5 },
      latencyMs: 3,
      costUsd: null,
    };

    const sink = fileSink(dir);
    sink.write('case-a', 'jev-1.14', answer);
    const raw = fs.readFileSync(path.join(dir, 'case-a.jev-1.14.json'), 'utf8');
    expect(raw).toBe(`${JSON.stringify(answer, null, 2)}\n`);
  });

  it('logs each line to stdout with a newline', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    fileSink(dir).log('hello');
    expect(write).toHaveBeenCalledWith('hello\n');
    write.mockRestore();
  });
});
