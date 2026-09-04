/**
 * Queue-contract unit tests for every search-domain queue definition (#195,
 * chat-search-embeddings task 6.2) — pure, no database, no pg-boss. Each
 * definition's `parse` guard is what stands between a redelivered payload
 * (written by an older deploy) and a `TypeError` deep inside a handler; this
 * file is where that guard is exercised directly rather than only implicitly
 * through a worker test.
 */
import {
  SEARCH_EMBED_QUEUE,
  SEARCH_REINDEX_QUEUE,
  SEARCH_SWEEP_QUEUE,
} from './reindex-queues';

describe('SEARCH_REINDEX_QUEUE.parse', () => {
  it('accepts a well-formed payload', () => {
    expect(
      SEARCH_REINDEX_QUEUE.parse?.({ chatId: 'c1', ownerUserId: 'u1' }),
    ).toEqual({ chatId: 'c1', ownerUserId: 'u1' });
  });

  it('rejects a non-object payload', () => {
    expect(() => SEARCH_REINDEX_QUEUE.parse?.('nope')).toThrow(
      "Malformed 'search-reindex' job: payload is not an object",
    );
  });

  it('rejects a payload missing chatId', () => {
    expect(() => SEARCH_REINDEX_QUEUE.parse?.({ ownerUserId: 'u1' })).toThrow(
      "Malformed 'search-reindex' job: expected non-empty string 'chatId'",
    );
  });

  it('rejects a payload missing ownerUserId', () => {
    expect(() => SEARCH_REINDEX_QUEUE.parse?.({ chatId: 'c1' })).toThrow(
      "Malformed 'search-reindex' job: expected non-empty string 'ownerUserId'",
    );
  });
});

describe('SEARCH_SWEEP_QUEUE.parse', () => {
  it('accepts the empty marker payload regardless of input', () => {
    expect(SEARCH_SWEEP_QUEUE.parse?.({})).toEqual({});
    expect(SEARCH_SWEEP_QUEUE.parse?.(undefined)).toEqual({});
  });
});

describe('SEARCH_EMBED_QUEUE.parse', () => {
  it('accepts a well-formed payload', () => {
    expect(
      SEARCH_EMBED_QUEUE.parse?.({ chatId: 'c1', ownerUserId: 'u1' }),
    ).toEqual({ chatId: 'c1', ownerUserId: 'u1' });
  });

  it('rejects a non-object payload', () => {
    expect(() => SEARCH_EMBED_QUEUE.parse?.(42)).toThrow(
      "Malformed 'search-embed' job: payload is not an object",
    );
  });

  it('rejects a payload missing chatId', () => {
    expect(() => SEARCH_EMBED_QUEUE.parse?.({ ownerUserId: 'u1' })).toThrow(
      "Malformed 'search-embed' job: expected non-empty string 'chatId'",
    );
  });

  it('rejects a payload missing ownerUserId', () => {
    expect(() => SEARCH_EMBED_QUEUE.parse?.({ chatId: 'c1' })).toThrow(
      "Malformed 'search-embed' job: expected non-empty string 'ownerUserId'",
    );
  });

  it('declares the stately/singletonKey coalescing policy and a bounded retry with backoff (design D5)', () => {
    expect(SEARCH_EMBED_QUEUE.options).toEqual({
      policy: 'stately',
      retryLimit: 5,
      retryBackoff: true,
    });
  });
});
