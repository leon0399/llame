import {
  KNOWLEDGE_CONTENT_NOTICE,
  knowledgeReadTool,
  knowledgeSearchTool,
  KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS,
} from './knowledge-tools';
import {
  KnowledgeFilesystemError,
  type KnowledgeFilesystemAdapterPort,
  type KnowledgeFilesystemBinding,
} from './knowledge-filesystem';
import { runTool } from '@workspace/harness';
import { isZodSchema } from '@workspace/harness';
import { type ToolContext } from '../tools/types';

const binding: KnowledgeFilesystemBinding = {
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  root: '/srv/knowledge',
  directory: '/srv/knowledge/6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
};

function fakeAdapter(
  overrides: Partial<KnowledgeFilesystemAdapterPort> = {},
): KnowledgeFilesystemAdapterPort {
  return {
    search: vi.fn(() => Promise.resolve([])),
    read: vi.fn((relativePath: string) =>
      Promise.resolve({
        path: relativePath,
        content: 'note',
        contentHash: 'a'.repeat(64),
      }),
    ),
    ...overrides,
  };
}

function context(
  adapter: KnowledgeFilesystemAdapterPort | undefined = fakeAdapter(),
  resolvedBinding: KnowledgeFilesystemBinding | null = binding,
  resolverError?: Error,
): ToolContext {
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    tenantDb: {
      runAs: () => Promise.reject(new Error('not used')),
    },
    knowledgeResolver: {
      resolveBindingForOwner: vi.fn(() => {
        if (resolverError !== undefined) return Promise.reject(resolverError);
        return Promise.resolve(resolvedBinding ?? undefined);
      }),
      createAdapter: vi.fn(() => adapter ?? fakeAdapter()),
    },
  };
}

describe('Knowledge tool declarations', () => {
  it('declares both tools read-only with strict model-only arguments', () => {
    expect(knowledgeSearchTool.id).toBe('knowledge_search');
    expect(knowledgeReadTool.id).toBe('knowledge_read');
    expect(knowledgeSearchTool.classification).toBe('read_only');
    expect(knowledgeReadTool.classification).toBe('read_only');
    expect(knowledgeSearchTool.description).toMatch(/untrusted|stale/iu);
    expect(knowledgeSearchTool.description).toMatch(/relative path/iu);
    expect(knowledgeSearchTool.description).toMatch(/verify|volatile/iu);
    expect(knowledgeReadTool.description).toMatch(/untrusted|stale/iu);
    expect(KNOWLEDGE_CONTENT_NOTICE).toMatch(/owner-maintained/iu);
    expect(KNOWLEDGE_CONTENT_NOTICE).toMatch(/untrusted|stale/iu);

    for (const tool of [knowledgeSearchTool, knowledgeReadTool]) {
      const schema = tool.inputSchema;
      if (!isZodSchema(schema)) {
        throw new Error('Expected a Zod schema');
      }
      expect(() => {
        schema.parse({ ownerId: 'other-owner' });
      }).toThrow();
      expect(() => {
        schema.parse({ root: '/etc' });
      }).toThrow();
      expect(() => {
        schema.parse({ knowledgeSpaceId: binding.id });
      }).toThrow();
    }
  });

  it('counts search query Unicode code points and defaults the result limit', () => {
    if (!isZodSchema(knowledgeSearchTool.inputSchema)) {
      throw new Error('Expected a Zod schema');
    }
    const schema = knowledgeSearchTool.inputSchema;
    expect(() => {
      schema.parse({ query: '😀'.repeat(200) });
    }).not.toThrow();
    expect(() => {
      schema.parse({ query: '😀'.repeat(201) });
    }).toThrow();
    expect(() => {
      schema.parse({ query: '', limit: 5 });
    }).toThrow();
    expect(() => {
      schema.parse({ query: 'x', limit: 1.5 });
    }).toThrow();
    expect(() => {
      schema.parse({ query: 'x', limit: 11 });
    }).toThrow();
  });

  it('requires exactly one read path', () => {
    const schema = knowledgeReadTool.inputSchema;
    if (!isZodSchema(schema)) {
      throw new Error('Expected a Zod schema');
    }
    expect(() => {
      schema.parse({ path: 'notes/a.md' });
    }).not.toThrow();
    expect(() => {
      schema.parse({ path: 'notes/a.md', root: '/srv' });
    }).toThrow();
  });
});

describe('knowledge_search', () => {
  it('returns the stable space ID and safe match attribution', async () => {
    const adapter = fakeAdapter({
      search: vi.fn(() =>
        Promise.resolve([
          {
            path: 'notes/a.md',
            line: 'Needle line',
            snippet: 'Needle line',
            contentHash: 'b'.repeat(64),
          },
        ]),
      ),
    });

    const result = await knowledgeSearchTool.execute(context(adapter), {
      query: 'needle',
      limit: 5,
    });

    expect(result).toEqual({
      status: 'success',
      knowledgeSpaceId: binding.id,
      results: [
        {
          knowledgeSpaceId: binding.id,
          path: 'notes/a.md',
          line: 'Needle line',
          snippet: 'Needle line',
          contentHash: 'b'.repeat(64),
        },
      ],
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
  });

  it('keeps the stable space ID for an empty result', async () => {
    const result = await knowledgeSearchTool.execute(context(), {
      query: 'missing',
      limit: 5,
    });

    expect(result).toEqual({
      status: 'success',
      knowledgeSpaceId: binding.id,
      results: [],
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
  });

  it('passes only trusted owner scope and the model query to the adapter', async () => {
    const adapter = fakeAdapter();
    const toolContext = context(adapter);
    const resolver = toolContext.knowledgeResolver!;
    await knowledgeSearchTool.execute(toolContext, {
      query: 'literal',
      limit: 3,
    });

    expect(resolver.resolveBindingForOwner).toHaveBeenCalledWith('owner-a');
    expect(adapter.search).toHaveBeenCalledWith('literal', 3, {
      signal: undefined,
    });
  });

  it('returns a whole-operation limit error when the success projection is too large', async () => {
    const adapter = fakeAdapter({
      search: vi.fn(() =>
        Promise.resolve([
          {
            path: 'notes/a.md',
            line: 'needle',
            snippet: 'x'.repeat(KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS),
            contentHash: 'c'.repeat(64),
          },
        ]),
      ),
    });

    const result = await knowledgeSearchTool.execute(context(adapter), {
      query: 'needle',
      limit: 5,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'knowledge_limit_exceeded',
      message: 'The Knowledge operation exceeded its result limit.',
    });
  });
});

describe('knowledge_read', () => {
  it('returns complete live content and exact attribution', async () => {
    const result = await knowledgeReadTool.execute(context(), {
      path: 'notes/a.md',
    });

    expect(result).toEqual({
      status: 'success',
      knowledgeSpaceId: binding.id,
      path: 'notes/a.md',
      content: 'note',
      contentHash: 'a'.repeat(64),
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
  });

  it('returns a whole-operation limit error instead of partial content', async () => {
    const adapter = fakeAdapter({
      read: vi.fn(() =>
        Promise.resolve({
          path: 'notes/a.md',
          content: 'x'.repeat(KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS),
          contentHash: 'd'.repeat(64),
        }),
      ),
    });

    const result = await knowledgeReadTool.execute(context(adapter), {
      path: 'notes/a.md',
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'knowledge_limit_exceeded',
    });
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100));
  });

  it('preflights JavaScript UTF-16 code units rather than UTF-8 bytes', async () => {
    const adapter = fakeAdapter({
      read: vi.fn(() =>
        Promise.resolve({
          path: 'notes/a.md',
          content: '😀'.repeat(6_000),
          contentHash: 'e'.repeat(64),
        }),
      ),
    });

    const result = await knowledgeReadTool.execute(context(adapter), {
      path: 'notes/a.md',
    });

    expect(result.status).toBe('success');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS,
    );
  });
});

describe('Knowledge tool failure boundaries', () => {
  it('reports unavailable when trusted worker binding is not injected', async () => {
    const result = await knowledgeSearchTool.execute(
      { ...context(), knowledgeResolver: undefined },
      { query: 'needle', limit: 5 },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });
  });

  it('fails closed when no binding is configured', async () => {
    await expect(
      knowledgeSearchTool.execute(context(undefined, null), {
        query: 'needle',
        limit: 5,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_space_not_configured',
      message: 'Knowledge Space is not configured.',
    });
  });

  it('maps resolver and adapter failures without exposing private paths', async () => {
    const resolverResult = await knowledgeReadTool.execute(
      context(undefined, binding, new Error('/srv/knowledge secret')),
      { path: 'notes/a.md' },
    );
    expect(resolverResult).toEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });

    const adapter = fakeAdapter({
      read: vi.fn(() =>
        Promise.reject(new KnowledgeFilesystemError('knowledge_path_invalid')),
      ),
    });
    await expect(
      knowledgeReadTool.execute(context(adapter), { path: 'bad.md' }),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_path_invalid',
      message: 'The Knowledge path is invalid.',
    });
  });

  it('propagates the trusted abort signal and cancellation to the runner', async () => {
    const abort = new AbortController();
    const adapter = fakeAdapter({
      search: vi.fn<KnowledgeFilesystemAdapterPort['search']>(
        (_query, _limit, options = {}) => {
          expect(options.signal).toBe(abort.signal);
          return Promise.reject(
            new KnowledgeFilesystemError('knowledge_cancelled'),
          );
        },
      ),
      read: vi.fn<KnowledgeFilesystemAdapterPort['read']>(
        (_path, options = {}) => {
          expect(options.signal).toBe(abort.signal);
          return Promise.reject(
            new KnowledgeFilesystemError('knowledge_cancelled'),
          );
        },
      ),
    });
    const toolContext = { ...context(adapter), abortSignal: abort.signal };

    await expect(
      knowledgeSearchTool.execute(toolContext, { query: 'x', limit: 5 }),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
    await expect(
      knowledgeReadTool.execute(toolContext, { path: 'note.md' }),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
  });

  it('records parent abort and call timeout through the canonical runner outcomes', async () => {
    const abort = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const parentAbortAdapter = fakeAdapter({
      search: vi.fn<KnowledgeFilesystemAdapterPort['search']>(
        (_query, _limit, options = {}) =>
          new Promise((_resolve, reject) => {
            markStarted();
            options.signal?.addEventListener(
              'abort',
              () => reject(new KnowledgeFilesystemError('knowledge_cancelled')),
              { once: true },
            );
          }),
      ),
    });

    const parentAbortResult = runTool(
      knowledgeSearchTool,
      { query: 'x', limit: 5 },
      { ...context(parentAbortAdapter), abortSignal: abort.signal },
      15,
    );
    await started;
    abort.abort();
    await expect(parentAbortResult).resolves.toMatchObject({
      status: 'error',
      type: 'cancelled',
    });

    const timeoutAdapter = fakeAdapter({
      search: vi.fn<KnowledgeFilesystemAdapterPort['search']>(
        (_query, _limit, options = {}) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => reject(new KnowledgeFilesystemError('knowledge_cancelled')),
              { once: true },
            );
          }),
      ),
    });
    await expect(
      runTool(
        knowledgeSearchTool,
        { query: 'x', limit: 5 },
        context(timeoutAdapter),
        0.01,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'timeout' });
  });
});
