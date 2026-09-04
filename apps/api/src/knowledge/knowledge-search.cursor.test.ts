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

  it('uses the public cursor error message for every validation failure', () => {
    try {
      decodeKnowledgeSearchCursor('not-base64!');
      throw new Error('Expected cursor decoding to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeSearchCursorError);
      expect(error).toMatchObject({
        name: 'KnowledgeSearchCursorError',
        message: 'The Knowledge search cursor is invalid.',
      });
    }
    expect(() =>
      encodeKnowledgeSearchCursor({ ...cursor, offset: -1 }),
    ).toThrow('The Knowledge search cursor is invalid.');
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
      'a'.repeat(4097),
      Buffer.from('not-json').toString('base64url'),
    ];

    for (const value of malformed) {
      expect(() => decodeKnowledgeSearchCursor(value)).toThrow(
        KnowledgeSearchCursorError,
      );
    }
  });

  it('rejects a payload with the right number of keys but the wrong key names', () => {
    const payload = {
      ...cursor,
      spaceCreatedAt: cursor.spaceCreatedAt.toISOString(),
    };
    const { offset, ...payloadWithoutOffset } = payload;
    expect(offset).toBe(42);
    const malformedPayload = { ...payloadWithoutOffset, extra: 42 };

    expect(() =>
      decodeKnowledgeSearchCursor(
        Buffer.from(JSON.stringify(malformedPayload)).toString('base64url'),
      ),
    ).toThrow(KnowledgeSearchCursorError);
  });

  it('rejects a valid payload encoded with non-canonical trailing bits', () => {
    const encoded = encodeKnowledgeSearchCursor({
      ...cursor,
      path: 'a.md',
      offset: 4,
    });
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = encoded.at(-1);
    if (last === undefined) throw new Error('Expected an encoded cursor');
    const index = alphabet.indexOf(last);
    if (index < 0 || encoded.length % 4 !== 3) {
      throw new Error('Expected a three-character base64url tail');
    }
    const alternate =
      alphabet[(index & 0b11_1100) | (index & 0b00_0011 ? 0 : 1)];
    const nonCanonical = `${encoded.slice(0, -1)}${alternate}`;

    expect(() => decodeKnowledgeSearchCursor(nonCanonical)).toThrow(
      KnowledgeSearchCursorError,
    );
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

  it('accepts offset zero but rejects valid cursors beyond the encoded-size limit', () => {
    expect(
      decodeKnowledgeSearchCursor(
        encodeKnowledgeSearchCursor({ ...cursor, offset: 0 }),
      ),
    ).toEqual({ ...cursor, offset: 0 });

    let exact: { cursor: KnowledgeSearchCursor; encoded: string } | undefined;
    let oversized: string | undefined;
    for (let length = 1; length < 5000; length += 1) {
      const candidate = { ...cursor, path: `${'a'.repeat(length)}.md` };
      const encoded = encodeKnowledgeSearchCursor(candidate);
      if (encoded.length === 4096) exact = { cursor: candidate, encoded };
      if (encoded.length > 4096) {
        oversized = encoded;
        break;
      }
    }
    expect(exact).toBeDefined();
    expect(oversized).toBeDefined();
    expect(decodeKnowledgeSearchCursor(exact!.encoded)).toEqual(exact!.cursor);
    expect(() => decodeKnowledgeSearchCursor(oversized!)).toThrow(
      KnowledgeSearchCursorError,
    );
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

  it.each([
    { query: '' },
    { query: 'Needle' },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { path: 'nested//note.md' },
    { path: 'nested/.' },
  ])('rejects invalid cursor state %j', (changes) => {
    expect(() =>
      encodeKnowledgeSearchCursor({ ...cursor, ...changes }),
    ).toThrow(KnowledgeSearchCursorError);
  });
});
