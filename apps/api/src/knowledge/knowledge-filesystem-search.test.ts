import {
  collectKnowledgePassages,
  compareNames,
  compareSearchMatches,
  decodeUtf8,
} from './knowledge-filesystem-search';
import {
  KNOWLEDGE_MAX_READ_LINES,
  KNOWLEDGE_MAX_SNIPPET_CODE_POINTS,
} from './knowledge-filesystem';

describe('Knowledge filesystem search helpers', () => {
  it('compares names and matches by path, then offset', () => {
    expect(compareNames('a', 'a')).toBe(0);
    expect(compareNames('a', 'b')).toBeLessThan(0);
    expect(compareNames('b', 'a')).toBeGreaterThan(0);

    const match = (path: string, offset: number) => ({
      path,
      offset,
      limit: 1,
      excerpt: '',
    });
    expect(compareSearchMatches(match('a.md', 1), match('a.md', 1))).toBe(0);
    expect(
      compareSearchMatches(match('a.md', 1), match('a.md', 2)),
    ).toBeLessThan(0);
    expect(
      compareSearchMatches(match('a.md', 2), match('a.md', 1)),
    ).toBeGreaterThan(0);
    expect(
      compareSearchMatches(match('a.md', 1), match('b.md', 0)),
    ).toBeLessThan(0);
    expect(
      compareSearchMatches(match('b.md', 0), match('a.md', 1)),
    ).toBeGreaterThan(0);
  });

  it('decodes valid UTF-8 and rejects malformed bytes', () => {
    expect(decodeUtf8(Buffer.from('café 😀', 'utf8'))).toBe('café 😀');
    expect(() => decodeUtf8(Buffer.from([0xc3, 0x28]))).toThrow(
      expect.objectContaining({ code: 'knowledge_content_invalid' }),
    );
  });

  it('returns no passages for an empty query and keeps logical line delimiters', async () => {
    await expect(
      collectKnowledgePassages('note.md', 'needle\r\nlast', ''),
    ).resolves.toEqual([]);
    await expect(
      collectKnowledgePassages(
        'note.md',
        'before\r\nNeedle here\r\nlast',
        'NEEDLE',
      ),
    ).resolves.toEqual([
      {
        path: 'note.md',
        offset: 0,
        limit: 3,
        excerpt: 'before\r\nNeedle here\r\nlast',
      },
    ]);
  });

  it('merges matches separated by at most two lines and closes larger gaps', async () => {
    await expect(
      collectKnowledgePassages(
        'note.md',
        'needle\nfirst gap\nsecond gap\nneedle\nthird gap\nfourth gap\nfifth gap\nneedle third match\n',
        'needle',
      ),
    ).resolves.toEqual([
      {
        path: 'note.md',
        offset: 0,
        limit: 5,
        excerpt: 'needle\nfirst gap\nsecond gap\nneedle\nthird gap\n',
      },
      {
        path: 'note.md',
        offset: 6,
        limit: 2,
        excerpt: 'fifth gap\nneedle third match\n',
      },
    ]);
  });

  it('applies the search cursor and result cap at exact passage boundaries', async () => {
    const text = 'needle one\nfirst gap\nsecond gap\nthird gap\nneedle two\n';
    await expect(
      collectKnowledgePassages('note.md', text, 'needle', {
        maxResults: 1,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      collectKnowledgePassages('note.md', text, 'needle', {
        after: { path: 'note.md', offset: 0 },
      }),
    ).resolves.toEqual([
      {
        path: 'note.md',
        offset: 3,
        limit: 2,
        excerpt: 'third gap\nneedle two\n',
      },
    ]);
    await expect(
      collectKnowledgePassages('other.md', 'needle\n', 'needle', {
        after: { path: 'note.md', offset: 999 },
      }),
    ).resolves.toHaveLength(1);
    await expect(
      collectKnowledgePassages('note.md', 'needle\n', 'needle', {
        after: { path: 'other.md', offset: 0 },
      }),
    ).resolves.toEqual([]);
  });

  it('uses code-point offsets when case folding expands a character', async () => {
    await expect(
      collectKnowledgePassages('note.md', 'İneedle\n', 'needle'),
    ).resolves.toEqual([
      {
        path: 'note.md',
        offset: 0,
        limit: 1,
        excerpt: 'İneedle\n',
      },
    ]);
  });

  it('clips excerpts around a match while preserving both boundaries', async () => {
    const prefix = 'a'.repeat(600);
    const suffix = 'b'.repeat(600);
    const text = `${prefix}needle${suffix}`;
    const [match] = await collectKnowledgePassages('note.md', text, 'needle');

    expect(match).toMatchObject({ path: 'note.md', offset: 0, limit: 1 });
    expect(match?.excerpt).toBe(`…${text.slice(351, 849)}…`);
    expect(Array.from(match?.excerpt ?? []).length).toBe(
      KNOWLEDGE_MAX_SNIPPET_CODE_POINTS,
    );
  });

  it('splits a long connected interval at the read-line cap', async () => {
    const lines = Array.from(
      { length: KNOWLEDGE_MAX_READ_LINES + 2 },
      (_value, index) => (index % 2 === 0 ? 'needle' : 'gap'),
    );
    const matches = await collectKnowledgePassages(
      'long.md',
      `${lines.join('\n')}\n`,
      'needle',
    );

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      offset: 0,
      limit: KNOWLEDGE_MAX_READ_LINES,
    });
    expect(matches[1]).toMatchObject({
      offset: KNOWLEDGE_MAX_READ_LINES,
      limit: 2,
    });
    expect(matches[0]?.excerpt).toContain('needle');
    expect(matches[1]?.excerpt).toContain('needle');
  });
});
