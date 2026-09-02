import { collectKnowledgePassages } from './knowledge-filesystem';

describe('collectKnowledgePassages', () => {
  it('collects literal occurrences with one-line context and deduplicates a matching line', async () => {
    const passages = await collectKnowledgePassages(
      'note.md',
      [
        'before',
        'needle needle',
        'after',
        'far away',
        'another',
        'NEEDLE',
        'tail',
      ].join('\n'),
      'needle',
    );

    expect(passages).toEqual([
      {
        path: 'note.md',
        offset: 0,
        limit: 3,
        excerpt: 'before\nneedle needle\nafter\n',
      },
      {
        path: 'note.md',
        offset: 4,
        limit: 3,
        excerpt: 'another\nNEEDLE\ntail',
      },
    ]);
  });

  it('does not expand repeated same-line matches into repeated candidates', async () => {
    const repeated = `${'needle '.repeat(100_000)}tail`;

    await expect(
      collectKnowledgePassages('repeated.md', repeated, 'needle'),
    ).resolves.toEqual([
      expect.objectContaining({ path: 'repeated.md', offset: 0, limit: 1 }),
    ]);
  });

  it('unions touching windows transitively before partitioning', async () => {
    const lines = Array.from({ length: 12 }, (_value, index) =>
      [2, 4, 6].includes(index) ? `needle-${index}` : `line-${index}`,
    );

    expect(
      await collectKnowledgePassages('chain.md', lines.join('\n'), 'needle'),
    ).toEqual([
      {
        path: 'chain.md',
        offset: 1,
        limit: 7,
        excerpt: `${lines.slice(1, 8).join('\n')}\n`,
      },
    ]);
  });

  it('partitions a long merged interval into adjacent passages that each retain a match', async () => {
    const lines = Array.from({ length: 2501 }, (_value, index) =>
      index % 2 === 0 ? `needle ${index}` : `line ${index}`,
    );

    const passages = await collectKnowledgePassages(
      'long.md',
      lines.join('\n'),
      'needle',
    );

    expect(passages.map(({ offset, limit }) => ({ offset, limit }))).toEqual([
      { offset: 0, limit: 2000 },
      { offset: 2000, limit: 501 },
    ]);
    expect(passages.every(({ excerpt }) => excerpt.includes('needle'))).toBe(
      true,
    );
  });

  it('keeps trailing context by moving the final match into the adjacent partition', async () => {
    const lines = Array.from({ length: 2001 }, (_value, index) =>
      index % 3 === 1 ? `needle ${index}` : `line ${index}`,
    );
    const passages = await collectKnowledgePassages(
      'trailing.md',
      lines.join('\n'),
      'needle',
    );

    expect(passages.map(({ offset, limit }) => ({ offset, limit }))).toEqual([
      { offset: 0, limit: 1999 },
      { offset: 1999, limit: 2 },
    ]);
    expect(passages.every(({ excerpt }) => excerpt.includes('needle'))).toBe(
      true,
    );
    expect(passages[0]?.offset + passages[0]?.limit).toBe(passages[1]?.offset);
  });

  it('crops oversized excerpts around a literal match with visible omission', async () => {
    const passages = await collectKnowledgePassages(
      'wide.md',
      `${'x'.repeat(700)} NEEDLE ${'y'.repeat(700)}`,
      'needle',
    );

    expect(passages).toHaveLength(1);
    expect(Array.from(passages[0]?.excerpt ?? []).length).toBeLessThanOrEqual(
      500,
    );
    expect(passages[0]?.excerpt).toContain('NEEDLE');
    expect(passages[0]?.excerpt).toContain('…');
  });

  it('uses read-compatible logical lines for mixed delimiters and Unicode literals', async () => {
    const passages = await collectKnowledgePassages(
      'mixed.md',
      'first\r\nβETA\rfoo\r\nlast',
      'βeta',
    );

    expect(passages).toEqual([
      {
        path: 'mixed.md',
        offset: 0,
        limit: 3,
        excerpt: 'first\r\nβETA\rfoo\r\nlast',
      },
    ]);
  });
});
