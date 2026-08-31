/**
 * OpenAI-compatible embedding adapter unit tests (chat-search-embeddings,
 * tasks 5.4–5.7). The provider boundary is replaced with `ai/test`'s
 * `MockEmbeddingModelV3`, the same "replace the provider, keep the real SDK
 * flow" pattern `openai-model-client.tools.test.ts` uses for streamText — the
 * real `embed`/`embedMany` from `ai` runs against it.
 */
import { createOpenAI } from '@ai-sdk/openai';
import type {
  EmbeddingModelV3,
  EmbeddingModelV3Embedding,
} from '@ai-sdk/provider';
import { APICallError } from 'ai';
import { MockEmbeddingModelV3 } from 'ai/test';

import { KEYLESS_PLACEHOLDER_API_KEY } from '../models/openai-model-client';
import type { UnknownRecord } from '../unknown-record';
import {
  classifyEmbeddingFailure,
  createOpenAIEmbeddingBackend,
  EmbeddingBackendError,
  type OpenAIEmbeddingBackendDependencies,
  type OpenAIEmbeddingProvider,
} from './openai-embedding-backend';

type DoEmbedOptions = Parameters<EmbeddingModelV3['doEmbed']>[0];
type SimpleEmbedResult = { embeddings: Array<EmbeddingModelV3Embedding> };
type SimpleEmbedFn = (
  options: DoEmbedOptions,
) => SimpleEmbedResult | PromiseLike<SimpleEmbedResult>;
type SimpleDoEmbedInput =
  | SimpleEmbedResult
  | Array<SimpleEmbedResult>
  | SimpleEmbedFn;

/** Named type-guard over the `typeof` check (anti-slop/no-runtime-typeof's `allowInTypeGuards` pattern — see `unknown-record.ts`'s `isString`/`isNumber`/etc.). */
function isSimpleEmbedFn(value: SimpleDoEmbedInput): value is SimpleEmbedFn {
  return typeof value === 'function';
}

function embeddingOf(seed: number, dimensions = 3): EmbeddingModelV3Embedding {
  return Array.from({ length: dimensions }, (_, i) => seed + i);
}

/** Builds `dependencies.createOpenAI` returning a fixed mock model, and records what settings our adapter passed to it. Accepts just `{embeddings}` — `warnings: []` (required by `EmbeddingModelV3Result`) is filled in here so every test site stays focused on what it's actually asserting. */
function withModel(doEmbed: SimpleDoEmbedInput) {
  const settingsCalls: Array<{ apiKey: string; baseURL?: string }> = [];
  const wrappedDoEmbed = isSimpleEmbedFn(doEmbed)
    ? async (options: DoEmbedOptions) => ({
        ...(await doEmbed(options)),
        warnings: [],
      })
    : Array.isArray(doEmbed)
      ? doEmbed.map((result) => ({ ...result, warnings: [] }))
      : { ...doEmbed, warnings: [] };
  const model = new MockEmbeddingModelV3({
    maxEmbeddingsPerCall: null,
    doEmbed: wrappedDoEmbed,
  });
  const dependencies: OpenAIEmbeddingBackendDependencies = {
    createOpenAI: (settings) => {
      settingsCalls.push(settings);
      const provider: OpenAIEmbeddingProvider = {
        textEmbeddingModel: () => model,
      };
      return provider;
    },
  };
  return { dependencies, settingsCalls };
}

describe('createOpenAIEmbeddingBackend — keyless provider (task 5.4)', () => {
  it('passes the shared keyless placeholder when no credential is configured', async () => {
    const { dependencies, settingsCalls } = withModel({
      embeddings: [embeddingOf(0)],
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    await backend.embedQuery('hello');
    expect(settingsCalls[0]?.apiKey).toBe(KEYLESS_PLACEHOLDER_API_KEY);
    expect(settingsCalls[0]?.baseURL).toBeUndefined();
  });

  it('passes a configured credential and baseUrl through unchanged', async () => {
    const { dependencies, settingsCalls } = withModel({
      embeddings: [embeddingOf(0)],
    });
    const backend = createOpenAIEmbeddingBackend(
      {
        providerModelId: 'm',
        dimensions: 3,
        credential: 'sk-real',
        baseUrl: 'http://localhost:11434/v1',
      },
      dependencies,
    );
    await backend.embedQuery('hello');
    // toMatchObject, not toEqual: settings also carries the response-order
    // verification `fetch` wrapper (see the "response-order verification"
    // describe block below), which this test isn't asserting on.
    expect(settingsCalls[0]).toMatchObject({
      apiKey: 'sk-real',
      baseURL: 'http://localhost:11434/v1',
    });
  });
});

describe('createOpenAIEmbeddingBackend — prefixes', () => {
  it('applies documentPrefix to documents and queryPrefix to the query, never crossed', async () => {
    const seenValues: Array<string> = [];
    const { dependencies } = withModel((options) => {
      seenValues.push(...options.values);
      return { embeddings: options.values.map((_, i) => embeddingOf(i)) };
    });
    const backend = createOpenAIEmbeddingBackend(
      {
        providerModelId: 'm',
        dimensions: 3,
        documentPrefix: 'passage: ',
        queryPrefix: 'query: ',
      },
      dependencies,
    );
    await backend.embedDocuments([
      { documentId: 'd1', contentHash: 'h1', content: 'doc text' },
    ]);
    await backend.embedQuery('a query');
    expect(seenValues).toEqual(['passage: doc text', 'query: a query']);
  });

  it('embeds content verbatim when no prefix is configured', async () => {
    const seenValues: Array<string> = [];
    const { dependencies } = withModel((options) => {
      seenValues.push(...options.values);
      return { embeddings: options.values.map((_, i) => embeddingOf(i)) };
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    await backend.embedDocuments([
      { documentId: 'd1', contentHash: 'h1', content: 'doc text' },
    ]);
    expect(seenValues).toEqual(['doc text']);
  });
});

describe('createOpenAIEmbeddingBackend — batching (task 5.4/D5)', () => {
  it('chunks the provider request to the configured batchSize', async () => {
    const callSizes: Array<number> = [];
    const { dependencies } = withModel((options) => {
      callSizes.push(options.values.length);
      return { embeddings: options.values.map((_, i) => embeddingOf(i)) };
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3, batchSize: 2 },
      dependencies,
    );
    const documents = Array.from({ length: 5 }, (_, i) => ({
      documentId: `d${i}`,
      contentHash: `h${i}`,
      content: `text ${i}`,
    }));
    const results = await backend.embedDocuments(documents);
    expect(callSizes).toEqual([2, 2, 1]);
    expect(results.map((r) => r.documentId)).toEqual([
      'd0',
      'd1',
      'd2',
      'd3',
      'd4',
    ]);
  });

  it('defaults to a batch size of 32 when unset', async () => {
    const callSizes: Array<number> = [];
    const { dependencies } = withModel((options) => {
      callSizes.push(options.values.length);
      return { embeddings: options.values.map((_, i) => embeddingOf(i)) };
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    const documents = Array.from({ length: 40 }, (_, i) => ({
      documentId: `d${i}`,
      contentHash: `h${i}`,
      content: `text ${i}`,
    }));
    await backend.embedDocuments(documents);
    expect(callSizes).toEqual([32, 8]);
  });
});

describe('createOpenAIEmbeddingBackend — result correlation (task 5.6)', () => {
  // This is a happy-path pairing test, not a robustness test: `withModel`'s
  // mock always returns embeddings in request order, so it cannot fail on a
  // reordered response — it only proves the zip is correctly indexed when
  // the provider behaves. The actual reorder-detection guarantee (design
  // D7) is exercised end to end through the REAL SDK/fetch chain in the
  // "response-order verification via raw HTTP" describe block below, which
  // is the one that can fail.
  it('pairs each result with its requesting document by position when the provider returns embeddings in request order', async () => {
    const { dependencies } = withModel((options) => ({
      embeddings: options.values.map((_, i) => embeddingOf(i * 10)),
    }));
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    const documents = [
      { documentId: 'a', contentHash: 'ha', content: 'A' },
      { documentId: 'b', contentHash: 'hb', content: 'B' },
      { documentId: 'c', contentHash: 'hc', content: 'C' },
    ];
    const results = await backend.embedDocuments(documents);
    expect(results).toEqual([
      { documentId: 'a', contentHash: 'ha', embedding: embeddingOf(0) },
      { documentId: 'b', contentHash: 'hb', embedding: embeddingOf(10) },
      { documentId: 'c', contentHash: 'hc', embedding: embeddingOf(20) },
    ]);
  });

  it('discards the whole chunk when the provider returns fewer embeddings than requested (partial response)', async () => {
    const { dependencies } = withModel({
      embeddings: [embeddingOf(0)], // only one, for two requested
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    const results = await backend.embedDocuments([
      { documentId: 'a', contentHash: 'ha', content: 'A' },
      { documentId: 'b', contentHash: 'hb', content: 'B' },
    ]);
    expect(results).toEqual([]);
  });

  it('discards the whole chunk when the provider returns more embeddings than requested', async () => {
    const { dependencies } = withModel({
      embeddings: [embeddingOf(0), embeddingOf(10), embeddingOf(20)],
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    const results = await backend.embedDocuments([
      { documentId: 'a', contentHash: 'ha', content: 'A' },
      { documentId: 'b', contentHash: 'hb', content: 'B' },
    ]);
    expect(results).toEqual([]);
  });

  it('a valid chunk after a discarded one still succeeds (per-chunk failure, not whole-call)', async () => {
    let call = 0;
    const { dependencies } = withModel((options) => {
      call += 1;
      if (call === 1) return { embeddings: [embeddingOf(0)] }; // 1 requested 2 -> discard
      return { embeddings: options.values.map((_, i) => embeddingOf(i * 100)) };
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3, batchSize: 2 },
      dependencies,
    );
    const documents = [
      { documentId: 'a', contentHash: 'ha', content: 'A' },
      { documentId: 'b', contentHash: 'hb', content: 'B' },
      { documentId: 'c', contentHash: 'hc', content: 'C' },
    ];
    const results = await backend.embedDocuments(documents);
    // chunk [a,b] discarded (partial), chunk [c] succeeds
    expect(results).toEqual([
      { documentId: 'c', contentHash: 'hc', embedding: embeddingOf(0) },
    ]);
  });
});

/**
 * Returns `dependencies.fetch` responding with the given raw JSON body,
 * regardless of the request — for exercising `assertResponseOrderPreserved`
 * end to end through the REAL `createOpenAI`/`textEmbeddingModel`/`embedMany`
 * chain. `MockEmbeddingModelV3` (used everywhere else in this file) bypasses
 * the whole HTTP layer, so it cannot reach this guard at all.
 */
function fakeEmbeddingHttpFetch(
  responseBody: UnknownRecord,
  status = 200,
): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

describe('createOpenAIEmbeddingBackend — response-order verification via raw HTTP (design D7, task 5.6)', () => {
  it('detects a reordered same-count response and rejects rather than silently pairing wrong vectors', async () => {
    // Same count as requested (3), so the length-mismatch guard alone would
    // NOT catch this — the provider claims each item's true position via
    // `index`, but the array itself arrives scrambled: physically the first
    // item is d2's vector, the second is d0's, the third is d1's. A plain
    // positional zip (no order verification) would silently write d2's
    // vector onto d0's row, d0's onto d1's row, and d1's onto d2's row.
    const dependencies = {
      createOpenAI: (settings: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI(settings),
      fetch: fakeEmbeddingHttpFetch({
        data: [
          { object: 'embedding', index: 2, embedding: embeddingOf(300) },
          { object: 'embedding', index: 0, embedding: embeddingOf(100) },
          { object: 'embedding', index: 1, embedding: embeddingOf(200) },
        ],
        model: 'text-embedding-3-small',
      }),
    };
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'text-embedding-3-small', dimensions: 3 },
      dependencies,
    );
    const documents = [
      { documentId: 'd0', contentHash: 'h0', content: 'A' },
      { documentId: 'd1', contentHash: 'h1', content: 'B' },
      { documentId: 'd2', contentHash: 'h2', content: 'C' },
    ];
    try {
      await backend.embedDocuments(documents);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.terminal).toBe(false);
    }
  });

  it('treats a response with no index metadata at all as unverifiable and rejects it', async () => {
    const dependencies = {
      createOpenAI: (settings: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI(settings),
      fetch: fakeEmbeddingHttpFetch({
        data: [
          { object: 'embedding', embedding: embeddingOf(0) },
          { object: 'embedding', embedding: embeddingOf(10) },
        ],
      }),
    };
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'a', contentHash: 'ha', content: 'A' },
        { documentId: 'b', contentHash: 'hb', content: 'B' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
    }
  });

  it('a well-formed in-order response with index metadata passes verification and embeds normally', async () => {
    const dependencies = {
      createOpenAI: (settings: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI(settings),
      fetch: fakeEmbeddingHttpFetch({
        data: [
          { object: 'embedding', index: 0, embedding: embeddingOf(100) },
          { object: 'embedding', index: 1, embedding: embeddingOf(200) },
        ],
      }),
    };
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    const results = await backend.embedDocuments([
      { documentId: 'd0', contentHash: 'h0', content: 'A' },
      { documentId: 'd1', contentHash: 'h1', content: 'B' },
    ]);
    expect(results).toEqual([
      { documentId: 'd0', contentHash: 'h0', embedding: embeddingOf(100) },
      { documentId: 'd1', contentHash: 'h1', embedding: embeddingOf(200) },
    ]);
  });

  it('leaves a non-2xx response untouched for the SDK own error handling', async () => {
    const dependencies = {
      createOpenAI: (settings: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI(settings),
      fetch: fakeEmbeddingHttpFetch({ error: { message: 'bad request' } }, 400),
    };
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'a', contentHash: 'ha', content: 'A' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.terminal).toBe(true);
    }
  });
});

describe('createOpenAIEmbeddingBackend — vector validation (task 5.5)', () => {
  // Deliberately updated by a later review (chat-search-embeddings, High-
  // severity gap): an earlier version of this suite pinned a silent-`continue`
  // behavior (the bad document simply absent from `results`, no throw). That
  // left a systematic dimensions misconfiguration completely un-tombstoned —
  // `search-embed.worker.ts`'s `processBatch` only tombstones on a THROWN
  // terminal error, so the outstanding rows just stayed `embedding IS NULL AND
  // embedding_fail_reason IS NULL` forever, re-attempted (and re-billed) by
  // every write-hook enqueue and every sweep tick with no operator-visible
  // error — exactly the unbounded-spend-with-no-error failure design D16's
  // tombstone exists to prevent. A vector failing OUR OWN validation cannot
  // succeed on retry (the model returns the same width every call), so it now
  // throws terminal, reaching the tombstone path the same way a terminal HTTP
  // status does.
  it('a wrong-length vector throws terminal, naming expected vs received width', async () => {
    const { dependencies } = withModel({
      embeddings: [embeddingOf(0, 3), embeddingOf(0, 5)],
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'ok', contentHash: 'h1', content: 'x' },
        { documentId: 'bad-length', contentHash: 'h2', content: 'y' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.terminal).toBe(true);
      // Concrete width mismatch — the operator's only signal (design D16).
      expect(error.message).toContain('5');
      expect(error.message).toContain('3');
    }
  });

  it('a non-finite vector throws terminal', async () => {
    const { dependencies } = withModel({
      embeddings: [embeddingOf(0, 3), [1, Number.NaN, 3]],
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'ok', contentHash: 'h1', content: 'x' },
        { documentId: 'bad-value', contentHash: 'h2', content: 'y' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.terminal).toBe(true);
    }
  });

  it('the error names no credential, request content, or endpoint value', async () => {
    const { dependencies } = withModel({
      embeddings: [embeddingOf(0, 5)],
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'bad-length', contentHash: 'h2', content: 'y' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.message).not.toContain('y');
      expect(error.message).not.toContain('bad-length');
    }
  });
});

describe('classifyEmbeddingFailure — terminal vs transient (task 5.7)', () => {
  function apiCallError(statusCode: number | undefined): APICallError {
    return new APICallError({
      message: 'boom',
      url: 'https://example.test/v1/embeddings?secret=leak',
      requestBodyValues: { input: ['tenant document content'] },
      statusCode,
      responseBody: 'raw response body with tenant content',
      responseHeaders: { authorization: 'Bearer sk-should-never-leak' },
    });
  }

  it('classifies a 400 as terminal', () => {
    expect(classifyEmbeddingFailure(apiCallError(400)).terminal).toBe(true);
  });

  it('classifies a 429 (rate limit) as transient, not terminal', () => {
    expect(classifyEmbeddingFailure(apiCallError(429)).terminal).toBe(false);
  });

  it('classifies a 408 (timeout) as transient, not terminal', () => {
    expect(classifyEmbeddingFailure(apiCallError(408)).terminal).toBe(false);
  });

  it('classifies a 500 as transient, not terminal', () => {
    expect(classifyEmbeddingFailure(apiCallError(500)).terminal).toBe(false);
  });

  it('classifies a non-APICallError (e.g. a network failure) as transient', () => {
    expect(
      classifyEmbeddingFailure(new TypeError('fetch failed')).terminal,
    ).toBe(false);
  });

  it('never carries the url, request body, response body, or response headers into the classified error (redaction, task 5.8)', () => {
    const classified = classifyEmbeddingFailure(apiCallError(400));
    expect(classified.message).not.toContain('secret=leak');
    expect(classified.message).not.toContain('tenant document content');
    expect(classified.message).not.toContain('tenant content');
    expect(classified.message).not.toContain('sk-should-never-leak');
    expect(classified).not.toHaveProperty('cause');
  });

  it('a 500 propagates from embedDocuments as a transient EmbeddingBackendError, never leaking the credential', async () => {
    const { dependencies } = withModel(() => {
      throw apiCallError(500);
    });
    const backend = createOpenAIEmbeddingBackend(
      {
        providerModelId: 'm',
        dimensions: 3,
        credential: 'sk-should-never-leak',
      },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'a', contentHash: 'ha', content: 'A' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.terminal).toBe(false);
      expect(error.message).not.toContain('sk-should-never-leak');
    }
  });

  it('a 400 propagates from embedDocuments as a terminal EmbeddingBackendError', async () => {
    const { dependencies } = withModel(() => {
      throw apiCallError(400);
    });
    const backend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      dependencies,
    );
    try {
      await backend.embedDocuments([
        { documentId: 'a', contentHash: 'ha', content: 'A' },
      ]);
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingBackendError);
      if (!(error instanceof EmbeddingBackendError)) return;
      expect(error.terminal).toBe(true);
    }
  });
});
