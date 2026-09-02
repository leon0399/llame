import {
  decodeKnowledgeSpaceCursor,
  encodeKnowledgeSpaceCursor,
  KnowledgeSpaceCursorError,
} from './knowledge-space.cursor';

const cursorValue = {
  createdAt: new Date('2026-08-23T12:34:56.789Z'),
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
};

describe('Knowledge Space cursor', () => {
  it('round-trips the exact keyset values as canonical base64url', () => {
    const encoded = encodeKnowledgeSpaceCursor(cursorValue);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeKnowledgeSpaceCursor(encoded)).toEqual(cursorValue);
  });

  it.each([
    '',
    'not-base64url=',
    Buffer.from('{"createdAt":"2026-08-23T12:34:56.789Z"}').toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({
        createdAt: 'not-a-date',
        id: cursorValue.id,
      }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        createdAt: cursorValue.createdAt.toISOString(),
        id: 'not-a-uuid',
      }),
    ).toString('base64url'),
  ])('rejects malformed cursor %j', (encoded) => {
    expect(() => decodeKnowledgeSpaceCursor(encoded)).toThrow(
      KnowledgeSpaceCursorError,
    );
  });
});
