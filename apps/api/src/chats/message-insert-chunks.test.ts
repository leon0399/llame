import {
  MESSAGE_INSERT_CHUNK_PARTS_LENGTH,
  messageInsertChunks,
} from './message-insert-chunks';

/** A row whose `parts` serialize to roughly the given text length. */
const rowOf = (id: string, textLength: number) => ({
  id,
  parts: [{ type: 'text', text: 'x'.repeat(textLength) }],
});

describe('messageInsertChunks', () => {
  it('ends a chunk at the part-length bound and keeps an oversized row alone', () => {
    const bound = JSON.stringify(rowOf('', 400).parts).length * 2 + 100;
    const rows = [
      rowOf('a', 400),
      rowOf('b', 400),
      rowOf('c', 800),
      rowOf('d', 100),
      rowOf('e', 2000),
    ];

    const chunks = [...messageInsertChunks(rows, bound)].map((chunk) =>
      chunk.map((row) => row.id),
    );

    // a+b fit; c starts a chunk d fits in; e alone passes the bound.
    expect(chunks).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('ends a chunk at 500 rows', () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      rowOf(`row-${index + 1}`, 1),
    );

    const chunks = [
      ...messageInsertChunks(rows, MESSAGE_INSERT_CHUNK_PARTS_LENGTH),
    ];

    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 1]);
  });
});
