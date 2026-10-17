/**
 * Queue-contract unit tests for every search-domain queue definition (#195,
 * chat-search-embeddings task 6.2) — pure, no database, no pg-boss. Each
 * definition's `parse` guard is what stands between a redelivered payload
 * (written by an older deploy) and a failure deep inside a handler; this
 * file is where that guard is exercised directly rather than only implicitly
 * through a worker test.
 */
import { ZodError } from 'zod';
import {
  SEARCH_EMBED_QUEUE,
  SEARCH_REINDEX_QUEUE,
  SEARCH_SWEEP_QUEUE,
} from './reindex-queues';

/** The dotted path of every issue the generated guard reports from `parse`. */
function issuePaths(parse: () => void): Array<string> {
  const result = (() => {
    try {
      parse();
    } catch (error) {
      return error;
    }
    return undefined;
  })();
  if (!(result instanceof ZodError)) throw new Error('expected a ZodError');
  return result.issues.map((issue) => issue.path.join('.'));
}

describe('SEARCH_REINDEX_QUEUE.parse', () => {
  it('accepts a well-formed payload', () => {
    expect(
      SEARCH_REINDEX_QUEUE.parse?.({ chatId: 'c1', ownerUserId: 'u1' }),
    ).toEqual({ chatId: 'c1', ownerUserId: 'u1' });
  });

  it('rejects a non-object payload', () => {
    expect(issuePaths(() => SEARCH_REINDEX_QUEUE.parse?.('nope'))).toEqual([
      '',
    ]);
  });

  it('rejects a payload missing chatId', () => {
    expect(
      issuePaths(() =>
        SEARCH_REINDEX_QUEUE.parse?.({
          ownerUserId: 'u1',
        }),
      ),
    ).toEqual(['chatId']);
  });

  it('rejects a payload missing ownerUserId', () => {
    expect(
      issuePaths(() =>
        SEARCH_REINDEX_QUEUE.parse?.({
          chatId: 'c1',
        }),
      ),
    ).toEqual(['ownerUserId']);
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
    expect(issuePaths(() => SEARCH_EMBED_QUEUE.parse?.(42))).toEqual(['']);
  });

  it('rejects a payload missing chatId', () => {
    expect(
      issuePaths(() =>
        SEARCH_EMBED_QUEUE.parse?.({
          ownerUserId: 'u1',
        }),
      ),
    ).toEqual(['chatId']);
  });

  it('rejects a payload missing ownerUserId', () => {
    expect(
      issuePaths(() => SEARCH_EMBED_QUEUE.parse?.({ chatId: 'c1' })),
    ).toEqual(['ownerUserId']);
  });

  it('declares the stately/singletonKey coalescing policy and a bounded retry with backoff (design D5)', () => {
    expect(SEARCH_EMBED_QUEUE.options).toEqual({
      policy: 'stately',
      retryLimit: 5,
      retryBackoff: true,
    });
  });
});
