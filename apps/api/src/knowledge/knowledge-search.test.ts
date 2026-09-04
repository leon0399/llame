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

describe('collectKnowledgePassages — excerpt windowing', () => {
  it('returns the whole passage at exactly the snippet cap', async () => {
    const source = `${'x'.repeat(494)}NEEDLE`;

    expect(
      await collectKnowledgePassages('exact.md', source, 'needle'),
    ).toEqual([{ path: 'exact.md', offset: 0, limit: 1, excerpt: source }]);
  });

  it('centres the window on a mid-line match and marks both omissions', async () => {
    const source = `${'x'.repeat(700)} NEEDLE ${'y'.repeat(700)}`;

    expect(await collectKnowledgePassages('wide.md', source, 'needle')).toEqual(
      [
        {
          path: 'wide.md',
          offset: 0,
          limit: 1,
          excerpt: `…${'x'.repeat(248)} NEEDLE ${'y'.repeat(242)}…`,
        },
      ],
    );
  });

  it('slides the window back so a match longer than half the budget stays whole', async () => {
    const needle = 'n'.repeat(300);
    const source = `${'a'.repeat(400)}${needle}${'b'.repeat(400)}`;

    expect(
      await collectKnowledgePassages('long-query.md', source, needle),
    ).toEqual([
      {
        path: 'long-query.md',
        offset: 0,
        limit: 1,
        excerpt: `…${'a'.repeat(198)}${needle}…`,
      },
    ]);
  });

  it('extends the window backwards when the match sits against the end of the text', async () => {
    const source = `${'z'.repeat(514)}NEEDLE`;

    expect(await collectKnowledgePassages('tail.md', source, 'needle')).toEqual(
      [
        {
          path: 'tail.md',
          offset: 0,
          limit: 1,
          excerpt: `…${source.slice(22)}`,
        },
      ],
    );
  });

  it('measures the window in code points, not UTF-16 code units', async () => {
    const source = `${'😀'.repeat(700)}NEEDLE${'😀'.repeat(700)}`;
    const passages = await collectKnowledgePassages(
      'astral.md',
      source,
      'needle',
    );

    expect(passages).toEqual([
      {
        path: 'astral.md',
        offset: 0,
        limit: 1,
        excerpt: `…${'😀'.repeat(249)}NEEDLE${'😀'.repeat(243)}…`,
      },
    ]);
    expect(Array.from(passages[0]?.excerpt ?? '')).toHaveLength(500);
  });
});

describe('collectKnowledgePassages — result bounds and delimiters', () => {
  it('returns nothing for an empty query without scanning', async () => {
    expect(await collectKnowledgePassages('note.md', 'needle', '')).toEqual([]);
  });

  it('stops adding passages once maxResults is reached', async () => {
    const lines = Array.from({ length: 20 }, (_value, index) =>
      index % 5 === 0 ? `needle ${index}` : `line ${index}`,
    );

    expect(
      (
        await collectKnowledgePassages('cap.md', lines.join('\n'), 'needle', {
          maxResults: 2,
        })
      ).map(({ offset, limit }) => ({ offset, limit })),
    ).toEqual([
      { offset: 0, limit: 2 },
      { offset: 4, limit: 3 },
    ]);
  });

  it('skips passages at or before the search cursor in the same file', async () => {
    const lines = Array.from({ length: 20 }, (_value, index) =>
      index % 5 === 0 ? `needle ${index}` : `line ${index}`,
    );

    expect(
      (
        await collectKnowledgePassages('cap.md', lines.join('\n'), 'needle', {
          after: { path: 'cap.md', offset: 4 },
        })
      ).map(({ offset }) => offset),
    ).toEqual([9, 14]);
  });

  it('keeps every passage when the cursor names an earlier file', async () => {
    const lines = Array.from({ length: 20 }, (_value, index) =>
      index % 5 === 0 ? `needle ${index}` : `line ${index}`,
    );

    expect(
      (
        await collectKnowledgePassages('cap.md', lines.join('\n'), 'needle', {
          after: { path: 'aaa.md', offset: 999 },
        })
      ).map(({ offset }) => offset),
    ).toEqual([0, 4, 9, 14]);
  });

  it('excludes the CR of a CRLF pair from the searchable line text', async () => {
    expect(
      await collectKnowledgePassages('crlf.md', 'alpha\r\nbeta', 'alpha\r'),
    ).toEqual([]);
    expect(
      await collectKnowledgePassages('crlf.md', 'alpha\r\nbeta', 'alpha'),
    ).toEqual([
      { path: 'crlf.md', offset: 0, limit: 2, excerpt: 'alpha\r\nbeta' },
    ]);
  });

  it('treats a lone CR as ordinary line text', async () => {
    expect(
      await collectKnowledgePassages('cr.md', 'alpha\rbeta\ngamma', 'alpha\r'),
    ).toEqual([
      { path: 'cr.md', offset: 0, limit: 2, excerpt: 'alpha\rbeta\ngamma' },
    ]);
  });

  it('emits one passage per isolated match with a single line of context each', async () => {
    const lines = [
      'zero',
      'needle one',
      'two',
      'three',
      'four',
      'needle five',
      'six',
    ];

    expect(
      await collectKnowledgePassages('gap.md', lines.join('\n'), 'needle'),
    ).toEqual([
      {
        path: 'gap.md',
        offset: 0,
        limit: 3,
        excerpt: 'zero\nneedle one\ntwo\n',
      },
      {
        path: 'gap.md',
        offset: 4,
        limit: 3,
        excerpt: 'four\nneedle five\nsix',
      },
    ]);
  });

  it('merges two matches exactly two lines apart into one passage', async () => {
    const lines = ['zero', 'needle one', 'two', 'needle three', 'four'];

    expect(
      await collectKnowledgePassages('near.md', lines.join('\n'), 'needle'),
    ).toEqual([
      {
        path: 'near.md',
        offset: 0,
        limit: 5,
        excerpt: `${lines.join('\n')}`,
      },
    ]);
  });
});

describe('collectKnowledgePassages — omission markers', () => {
  it('omits the leading marker when the window already starts at the passage start', async () => {
    const source = `NEEDLE${'y'.repeat(1000)}`;

    expect(await collectKnowledgePassages('head.md', source, 'needle')).toEqual(
      [
        {
          path: 'head.md',
          offset: 0,
          limit: 1,
          excerpt: `NEEDLE${'y'.repeat(492)}…`,
        },
      ],
    );
  });

  it('locates the match relative to the passage, not the whole file', async () => {
    // The passage starts at line 4, so the match on line 5 is the second line
    // of the excerpt — measuring from line 5 absolutely would crop elsewhere.
    const lines = [
      ...Array.from({ length: 5 }, (_value, index) => `quiet ${index}`),
      `${'x'.repeat(700)} NEEDLE ${'y'.repeat(700)}`,
      'after',
    ];

    expect(
      await collectKnowledgePassages('deep.md', lines.join('\n'), 'needle'),
    ).toEqual([
      {
        path: 'deep.md',
        offset: 4,
        limit: 3,
        excerpt: `…${'x'.repeat(248)} NEEDLE ${'y'.repeat(242)}…`,
      },
    ]);
  });
});
