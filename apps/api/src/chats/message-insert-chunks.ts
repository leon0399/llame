/**
 * How an owner fork splits its message rows into INSERT statements. A fork
 * copies a conversation of any length (#143 — no upper bound), so one
 * statement can neither carry every row (parameter count) nor every large
 * read (statement size): a retained read keeps up to 28 MiB of base64 in its
 * `parts`, and 500 such rows would pass Postgres's 1 GiB statement limit.
 */

/** Max rows one statement carries (parameter-count bound). */
const CHUNK_ROWS = 500;

/**
 * Max serialized `parts` length one statement carries. 256 MiB leaves room
 * for the other columns and for Postgres's per-statement parameter encoding.
 */
export const MESSAGE_INSERT_CHUNK_PARTS_LENGTH = 256 * 1024 * 1024;

/**
 * The INSERT statements an owner fork writes, in row order: at most
 * `CHUNK_ROWS` rows and `partsLengthBound` serialized part characters each. A
 * row that alone passes the byte bound still goes alone, so no row is dropped.
 *
 * @param rows - Pre-built message rows in copy order
 * @param partsLengthBound - Max serialized `parts` length per statement
 * @returns One pre-built array per statement
 */
export function* messageInsertChunks<T extends { parts: Array<unknown> }>(
  rows: ReadonlyArray<T>,
  partsLengthBound: number = MESSAGE_INSERT_CHUNK_PARTS_LENGTH,
): Generator<Array<T>> {
  let chunk: Array<T> = [];
  let chunkPartsLength = 0;
  for (const row of rows) {
    const rowPartsLength = JSON.stringify(row.parts).length;
    const full =
      chunk.length >= CHUNK_ROWS ||
      (chunk.length > 0 &&
        chunkPartsLength + rowPartsLength > partsLengthBound);
    if (full) {
      yield chunk;
      chunk = [];
      chunkPartsLength = 0;
    }
    chunk.push(row);
    chunkPartsLength += rowPartsLength;
  }
  if (chunk.length > 0) {
    yield chunk;
  }
}
