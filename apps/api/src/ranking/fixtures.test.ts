import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRecordedAnswers, type RecordedAnswer } from './fixtures';

function answer(model: string, scores: Record<string, number>): RecordedAnswer {
  return { model, status: 'ranked', scores, latencyMs: 1, costUsd: 0 };
}

describe('loadRecordedAnswers', () => {
  it('returns nothing when the answers directory does not exist', () => {
    const dir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ans-')),
      'missing',
    );

    expect(loadRecordedAnswers('case-a', dir)).toEqual([]);
  });

  it('reads only the case’s JSON answers, sorted, ignoring other cases and files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-'));

    const write = (name: string, body: string) =>
      fs.writeFileSync(path.join(dir, name), body);

    write('case-a.jev-1.14.json', JSON.stringify(answer('jev-1.14', { a: 1 })));
    write('case-a.alpha.json', JSON.stringify(answer('alpha', { a: 2 })));
    write('case-ab.other.json', JSON.stringify(answer('other', { a: 3 })));
    write('case-a.notes.txt', 'not json');
    write('other.case-a.json', JSON.stringify(answer('x', { a: 4 })));
    expect(loadRecordedAnswers('case-a', dir).map((a) => a.model)).toEqual([
      'alpha',
      'jev-1.14',
    ]);
  });

  it('orders answers by file name whatever order the directory lists them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-'));

    for (const model of ['alpha', 'mid', 'zulu']) {
      fs.writeFileSync(
        path.join(dir, `case-a.${model}.json`),
        JSON.stringify(answer(model, { a: 1 })),
      );
    }

    const unsorted = () => [
      'case-a.zulu.json',
      'case-a.alpha.json',
      'case-a.mid.json',
    ];

    expect(
      loadRecordedAnswers('case-a', dir, unsorted).map((a) => a.model),
    ).toEqual(['alpha', 'mid', 'zulu']);
  });

  it('rejects an answer that does not match the recorded shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-'));
    fs.writeFileSync(path.join(dir, 'case-a.m.json'), '{"model":"m"}');
    expect(() => loadRecordedAnswers('case-a', dir)).toThrow(/scores/);
  });
});
