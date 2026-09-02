import {
  assertKnowledgeSearchCursorBinding,
  decodeKnowledgeSearchCursor,
  encodeKnowledgeSearchCursor,
  KnowledgeSearchCursorError,
  type KnowledgeSearchCursor,
} from './knowledge-search.cursor';

const cursor: KnowledgeSearchCursor = {
  version: 1,
  query: 'needle',
  knowledgeSpaceId: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  spaceCreatedAt: new Date('2026-08-23T12:00:00.000Z'),
  spaceId: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  path: 'notes/a.md',
  offset: 42,
};

describe('Knowledge search cursor', () => {
  it('round-trips canonical opaque keyset state', () => {
    const encoded = encodeKnowledgeSearchCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeKnowledgeSearchCursor(encoded)).toEqual(cursor);
  });

  it('rejects malformed, non-canonical, versioned, and unsafe state', () => {
    const malformed = [
      '',
      'not-base64!',
      Buffer.from(JSON.stringify({ ...cursor, query: 1 })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ ...cursor, offset: '42' })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ ...cursor, version: 2 })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ ...cursor, extra: true })).toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({ ...cursor, spaceCreatedAt: '2026-08-23T12:00:00Z' }),
      ).toString('base64url'),
      Buffer.from(JSON.stringify({ ...cursor, offset: -1 })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ ...cursor, path: '' })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ ...cursor, path: '/absolute.md' })).toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({ ...cursor, path: 'nested/../note.md' }),
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify({ ...cursor, path: 'nested\\note.md' }),
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify({ ...cursor, path: 'nested/\u0000note.md' }),
      ).toString('base64url'),
    ];

    for (const value of malformed) {
      expect(() => decodeKnowledgeSearchCursor(value)).toThrow(
        KnowledgeSearchCursorError,
      );
    }
  });

  it('binds continuation to normalized query and optional selector', () => {
    expect(() =>
      assertKnowledgeSearchCursorBinding(
        cursor,
        'NEEDLE',
        cursor.knowledgeSpaceId,
      ),
    ).not.toThrow();
    expect(() =>
      assertKnowledgeSearchCursorBinding(
        cursor,
        'other',
        cursor.knowledgeSpaceId,
      ),
    ).toThrow(KnowledgeSearchCursorError);
    expect(() =>
      assertKnowledgeSearchCursorBinding(cursor, 'needle', undefined),
    ).toThrow(KnowledgeSearchCursorError);
  });

  it('round-trips a valid query whose case fold expands past 200 code points', () => {
    const query = 'İ'.repeat(101);
    const expandingCursor: KnowledgeSearchCursor = {
      ...cursor,
      query: query.toLowerCase(),
      knowledgeSpaceId: undefined,
    };

    const encoded = encodeKnowledgeSearchCursor(expandingCursor);

    expect(decodeKnowledgeSearchCursor(encoded)).toEqual(expandingCursor);
    expect(() =>
      assertKnowledgeSearchCursorBinding(expandingCursor, query, undefined),
    ).not.toThrow();
  });

  it('supports an unscoped cursor and rejects a non-canonical selector', () => {
    const unscoped = { ...cursor, knowledgeSpaceId: undefined };
    const encoded = encodeKnowledgeSearchCursor(unscoped);

    expect(decodeKnowledgeSearchCursor(encoded)).toEqual(unscoped);
    expect(() =>
      encodeKnowledgeSearchCursor({
        ...cursor,
        knowledgeSpaceId: 'NOT-LOWERCASE',
      }),
    ).toThrow(KnowledgeSearchCursorError);
  });
});
