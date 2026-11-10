/**
 * Bounded readers for the byte streams a walk port hands over. A mutant that
 * breaks a stream's end would otherwise keep yielding chunks, and a test that
 * collects them into one array would grow until the runner runs out of memory
 * instead of failing. Every reader here stops at its cap and throws.
 */

/** The most bytes one test reads from a stream, well above every fixture. */
const MAX_STREAM_BYTES = 8 * 1024 * 1024;

/** The most chunks one test reads; an empty chunk still counts as one. */
const MAX_STREAM_CHUNKS = 4096;

/** Every byte a stream yields, failing once it passes its byte or chunk cap. */
export async function collectStreamBytes(
  chunks: AsyncIterable<Uint8Array | { readonly kind: string }>,
  limit = MAX_STREAM_BYTES,
): Promise<Buffer> {
  const parts: Array<Uint8Array> = [];
  let total = 0;

  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array))
      throw new Error(`the stream refused: ${chunk.kind}`);
    total += chunk.byteLength;

    if (total > limit)
      throw new Error(`the stream passed ${limit} bytes without ending`);

    if (parts.length === MAX_STREAM_CHUNKS)
      throw new Error(`the stream passed ${MAX_STREAM_CHUNKS} chunks`);
    parts.push(chunk);
  }

  return Buffer.concat(parts);
}

/** Every item a stream yields, failing once it passes `limit` items. */
export async function drainStream<T>(
  items: AsyncIterable<T>,
  limit: number,
): Promise<Array<T>> {
  const drained: Array<T> = [];

  for await (const item of items) {
    drained.push(item);

    if (drained.length > limit)
      throw new Error(`the stream passed ${limit} items without ending`);
  }

  return drained;
}
