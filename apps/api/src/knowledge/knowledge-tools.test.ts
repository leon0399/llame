import { ZodError } from 'zod';

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
  type KnowledgeFilesystemSearchOptions,
} from './knowledge-filesystem';
import { runTool } from '../tools/runner';
import { isZodSchema } from '../tools/schema-utils';
import { isString } from '../unknown-record';
import { type KnowledgeSpaceCursor } from './knowledge-space.cursor';
import { encodeKnowledgeSearchCursor } from './knowledge-search.cursor';
import {
  type KnowledgeToolSpaceReference,
  type ToolResult,
  type ToolContext,
} from '../tools/types';

const binding: KnowledgeFilesystemBinding = {
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  name: 'Personal',
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
        offset: 0,
        lineCount: 1,
        content: '1: note',
        nextOffset: undefined,
        cutReason: undefined,
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
      listForOwnerPage: vi.fn(() => {
        if (resolverError !== undefined) return Promise.reject(resolverError);
        return Promise.resolve({
          spaces:
            resolvedBinding === null
              ? []
              : [
                  {
                    id: resolvedBinding.id,
                    name: resolvedBinding.name ?? resolvedBinding.id,
                    createdAt: new Date(0),
                  },
                ],
        });
      }),
      resolveBindingForOwnerById: vi.fn((_owner: string, id: string) => {
        if (resolverError !== undefined) return Promise.reject(resolverError);
        return Promise.resolve(
          resolvedBinding?.id === id ? resolvedBinding : undefined,
        );
      }),
      createAdapter: vi.fn(() => adapter ?? fakeAdapter()),
    },
  };
}

function multiSpaceContext(
  spaces: ReadonlyArray<KnowledgeToolSpaceReference>,
  bindings: ReadonlyMap<string, KnowledgeFilesystemBinding>,
  adapters: ReadonlyMap<string, KnowledgeFilesystemAdapterPort>,
): ToolContext {
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    tenantDb: { runAs: () => Promise.reject(new Error('not used')) },
    knowledgeResolver: {
      listForOwnerPage: vi.fn(() => Promise.resolve({ spaces })),
      resolveBindingForOwnerById: vi.fn((_owner: string, id: string) =>
        Promise.resolve(bindings.get(id)),
      ),
      createAdapter: vi.fn((currentBinding: KnowledgeFilesystemBinding) => {
        const adapter = adapters.get(currentBinding.id);
        if (adapter === undefined) {
          throw new Error('Missing fake Knowledge adapter');
        }
        return adapter;
      }),
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
      }).toThrow(ZodError);
      expect(() => {
        schema.parse({ root: '/etc' });
      }).toThrow(ZodError);
      expect(() => {
        schema.parse({ knowledgeSpaceId: binding.id });
      }).toThrow(ZodError);
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
    }).toThrow(ZodError);
    expect(() => {
      schema.parse({ query: '', limit: 5 });
    }).toThrow(ZodError);
    expect(() => {
      schema.parse({ query: 'x', limit: 1.5 });
    }).toThrow(ZodError);
    expect(() => {
      schema.parse({ query: 'x', limit: 11 });
    }).toThrow(ZodError);
    expect(schema.parse({ query: 'x', knowledgeSpaceId: binding.id })).toEqual({
      query: 'x',
      limit: 5,
      knowledgeSpaceId: binding.id,
    });
    expect(schema.parse({ query: 'x', cursor: 'opaque-cursor' })).toEqual({
      query: 'x',
      limit: 5,
      cursor: 'opaque-cursor',
    });
    expect(() => {
      schema.parse({ query: 'x', cursor: 1 });
    }).toThrow(ZodError);
    expect(() => {
      schema.parse({ query: 'x', cursor: 'x', extra: true });
    }).toThrow(ZodError);
  });

  it('requires exactly one read path', () => {
    const schema = knowledgeReadTool.inputSchema;
    if (!isZodSchema(schema)) {
      throw new Error('Expected a Zod schema');
    }
    expect(() => {
      schema.parse({ path: 'notes/a.md' });
    }).toThrow(ZodError);
    expect(() => {
      schema.parse({ path: 'notes/a.md', root: '/srv' });
    }).toThrow(ZodError);
    expect(
      schema.parse({ path: 'notes/a.md', knowledgeSpaceId: binding.id }),
    ).toEqual({ path: 'notes/a.md', knowledgeSpaceId: binding.id });
  });

  it('accepts bounded zero-based read ranges and rejects unsafe values', () => {
    const schema = knowledgeReadTool.inputSchema;
    if (!isZodSchema(schema)) {
      throw new Error('Expected a Zod schema');
    }
    expect(
      schema.parse({
        path: 'notes/a.md',
        knowledgeSpaceId: binding.id,
        offset: 0,
        limit: 2000,
      }),
    ).toEqual({
      path: 'notes/a.md',
      knowledgeSpaceId: binding.id,
      offset: 0,
      limit: 2000,
    });
    for (const invalid of [
      { offset: -1 },
      { offset: 1.5 },
      { offset: Number.MAX_SAFE_INTEGER + 1 },
      { limit: 0 },
      { limit: 2001 },
      { limit: 1.5 },
      { limit: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => {
        void schema.parse({
          path: 'notes/a.md',
          knowledgeSpaceId: binding.id,
          ...invalid,
        });
      }).toThrow(ZodError);
    }
  });
});

describe('knowledge_search cursor continuation', () => {
  it('walks multiple passages across spaces without duplicates', async () => {
    const bindingB: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Second',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaceA: KnowledgeToolSpaceReference = {
      id: binding.id,
      name: 'First',
      createdAt: new Date(0),
    };
    const spaceB: KnowledgeToolSpaceReference = {
      id: bindingB.id,
      name: 'Second',
      createdAt: new Date(1),
    };
    const searchA = vi.fn<KnowledgeFilesystemAdapterPort['search']>(
      (_query, _limit, options) =>
        Promise.resolve(
          options?.after === undefined
            ? [
                { path: 'a.md', offset: 0, limit: 1, excerpt: 'a0' },
                { path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' },
              ]
            : options.after.offset === 0
              ? [{ path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' }]
              : [],
        ),
    );
    const searchB = vi.fn<KnowledgeFilesystemAdapterPort['search']>(
      (_query, _limit, options) =>
        Promise.resolve(
          options?.after?.offset === 0
            ? [{ path: 'b.md', offset: 2, limit: 1, excerpt: 'b1' }]
            : [
                { path: 'b.md', offset: 0, limit: 1, excerpt: 'b0' },
                { path: 'b.md', offset: 2, limit: 1, excerpt: 'b1' },
              ],
        ),
    );
    const toolContext = multiSpaceContext(
      [spaceA, spaceB],
      new Map([
        [binding.id, binding],
        [bindingB.id, bindingB],
      ]),
      new Map([
        [binding.id, fakeAdapter({ search: searchA })],
        [bindingB.id, fakeAdapter({ search: searchB })],
      ]),
    );

    const pages: Array<ToolResult> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const result =
        cursor === undefined
          ? await knowledgeSearchTool.execute(toolContext, {
              query: 'term',
              limit: 1,
            })
          : await knowledgeSearchTool.execute(toolContext, {
              query: 'term',
              limit: 1,
              cursor,
            });
      pages.push(result);
      if (result.status !== 'success' || !isString(result.nextCursor)) break;
      cursor = result.nextCursor;
    }

    expect(pages[0]).toMatchObject({
      results: [{ knowledgeSpaceId: binding.id, path: 'a.md', offset: 0 }],
    });
    expect(pages[1]).toMatchObject({
      results: [{ knowledgeSpaceId: binding.id, path: 'a.md', offset: 2 }],
    });
    expect(pages[2]).toMatchObject({
      results: [{ knowledgeSpaceId: bindingB.id, path: 'b.md', offset: 0 }],
    });
    expect(pages[3]).toMatchObject({
      results: [{ knowledgeSpaceId: bindingB.id, path: 'b.md', offset: 2 }],
    });
    expect(pages[3]).toMatchObject({ status: 'success' });
    expect(pages[3]).not.toHaveProperty('nextCursor');
  });

  it('does not retry failed spaces before an unscoped cursor anchor', async () => {
    const bindingBefore: KnowledgeFilesystemBinding = {
      ...binding,
      id: '5f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Before',
      directory: '/srv/knowledge/5f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const bindingAfter: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'After',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaceBefore = {
      id: bindingBefore.id,
      name: 'Before',
      createdAt: new Date(0),
    };
    const spaceAnchor = {
      id: binding.id,
      name: 'Anchor',
      createdAt: new Date(1),
    };
    const spaceAfter = {
      id: bindingAfter.id,
      name: 'After',
      createdAt: new Date(2),
    };
    const searchBefore = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.reject(new KnowledgeFilesystemError('knowledge_path_invalid')),
    );
    const searchAnchor = vi.fn<KnowledgeFilesystemAdapterPort['search']>(
      (_query, _limit, options) =>
        Promise.resolve(
          options?.after === undefined
            ? [
                { path: 'a.md', offset: 0, limit: 1, excerpt: 'a0' },
                { path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' },
              ]
            : [{ path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' }],
        ),
    );
    const searchAfter = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([{ path: 'z.md', offset: 0, limit: 1, excerpt: 'z0' }]),
    );
    const toolContext = multiSpaceContext(
      [spaceBefore, spaceAnchor, spaceAfter],
      new Map([
        [bindingBefore.id, bindingBefore],
        [binding.id, binding],
        [bindingAfter.id, bindingAfter],
      ]),
      new Map([
        [bindingBefore.id, fakeAdapter({ search: searchBefore })],
        [binding.id, fakeAdapter({ search: searchAnchor })],
        [bindingAfter.id, fakeAdapter({ search: searchAfter })],
      ]),
    );

    const first = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
    });
    expect(first).toMatchObject({
      status: 'success',
      complete: false,
      results: [{ knowledgeSpaceId: binding.id, offset: 0 }],
    });
    if (first.status !== 'success' || !isString(first.nextCursor)) {
      throw new Error('Expected a continuation cursor');
    }

    const second = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({
      status: 'success',
      results: [{ knowledgeSpaceId: binding.id, offset: 2 }],
    });
    expect(searchBefore).toHaveBeenCalledOnce();
    expect(searchAnchor).toHaveBeenCalledTimes(2);
  });

  it('reauthorizes later spaces and keeps a bounded warning with continuation', async () => {
    const bindingLater: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Later',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaceAnchor = {
      id: binding.id,
      name: 'Anchor',
      createdAt: new Date(0),
    };
    const spaceLater = {
      id: bindingLater.id,
      name: 'Later',
      createdAt: new Date(1),
    };
    const bindingLast: KnowledgeFilesystemBinding = {
      ...binding,
      id: '8f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Last',
      directory: '/srv/knowledge/8f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaceLast = {
      id: bindingLast.id,
      name: 'Last',
      createdAt: new Date(2),
    };
    const searchAnchor = vi.fn<KnowledgeFilesystemAdapterPort['search']>(
      (_query, _limit, options) =>
        Promise.resolve(
          options?.after === undefined
            ? [
                { path: 'a.md', offset: 0, limit: 1, excerpt: 'a0' },
                { path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' },
              ]
            : [{ path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' }],
        ),
    );
    const searchLater = vi
      .fn<KnowledgeFilesystemAdapterPort['search']>()
      .mockResolvedValueOnce([
        { path: 'b.md', offset: 0, limit: 1, excerpt: 'b0' },
      ])
      .mockRejectedValueOnce(
        new KnowledgeFilesystemError('knowledge_path_invalid'),
      )
      .mockResolvedValue([
        { path: 'b.md', offset: 4, limit: 1, excerpt: 'b2' },
      ]);
    const searchLast = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([{ path: 'c.md', offset: 0, limit: 1, excerpt: 'c0' }]),
    );
    const toolContext = multiSpaceContext(
      [spaceAnchor, spaceLater, spaceLast],
      new Map([
        [binding.id, binding],
        [bindingLater.id, bindingLater],
        [bindingLast.id, bindingLast],
      ]),
      new Map([
        [binding.id, fakeAdapter({ search: searchAnchor })],
        [bindingLater.id, fakeAdapter({ search: searchLater })],
        [bindingLast.id, fakeAdapter({ search: searchLast })],
      ]),
    );

    const first = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
    });
    if (first.status !== 'success' || !isString(first.nextCursor)) {
      throw new Error('Expected a continuation cursor');
    }
    const second = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({
      status: 'success',
      complete: false,
      warningCount: 1,
      warnings: [
        {
          type: 'knowledge_path_invalid',
          knowledgeSpaceId: bindingLater.id,
        },
      ],
      results: [{ knowledgeSpaceId: binding.id, offset: 2 }],
    });
    expect(second).toHaveProperty('nextCursor');
    expect(searchLater).toHaveBeenCalledTimes(2);
    expect(searchLast).toHaveBeenCalledTimes(2);
  });

  it('omits continuation when an incomplete final page has no later passage', async () => {
    const bindingLater: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Later',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const searchAnchor = vi.fn<KnowledgeFilesystemAdapterPort['search']>(
      (_query, _limit, options) =>
        Promise.resolve(
          options?.after === undefined
            ? [
                { path: 'a.md', offset: 0, limit: 1, excerpt: 'a0' },
                { path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' },
              ]
            : [{ path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' }],
        ),
    );
    const searchLater = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.reject(new KnowledgeFilesystemError('knowledge_path_invalid')),
    );
    const toolContext = multiSpaceContext(
      [
        { id: binding.id, name: 'Anchor', createdAt: new Date(0) },
        { id: bindingLater.id, name: 'Later', createdAt: new Date(1) },
      ],
      new Map([
        [binding.id, binding],
        [bindingLater.id, bindingLater],
      ]),
      new Map([
        [binding.id, fakeAdapter({ search: searchAnchor })],
        [bindingLater.id, fakeAdapter({ search: searchLater })],
      ]),
    );

    const first = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
    });
    if (first.status !== 'success' || !isString(first.nextCursor)) {
      throw new Error('Expected a continuation cursor');
    }
    const second = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({
      status: 'success',
      complete: false,
      warningCount: 1,
      results: [{ knowledgeSpaceId: binding.id, offset: 2 }],
    });
    expect(second).not.toHaveProperty('nextCursor');
  });

  it('returns the first deterministic error when all eligible continuation spaces fail', async () => {
    const bindingBefore: KnowledgeFilesystemBinding = {
      ...binding,
      id: '5f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Before',
      directory: '/srv/knowledge/5f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const bindingLater: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Later',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaces = [
      { id: bindingBefore.id, name: 'Before', createdAt: new Date(0) },
      { id: binding.id, name: 'Anchor', createdAt: new Date(1) },
      { id: bindingLater.id, name: 'Later', createdAt: new Date(2) },
    ];
    const searchBefore = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.reject(new KnowledgeFilesystemError('knowledge_path_invalid')),
    );
    const searchAnchor = vi.fn<KnowledgeFilesystemAdapterPort['search']>(
      (_query, _limit, options) =>
        Promise.resolve(
          options?.after === undefined
            ? [
                { path: 'a.md', offset: 0, limit: 1, excerpt: 'a0' },
                { path: 'a.md', offset: 2, limit: 1, excerpt: 'a1' },
              ]
            : Promise.reject(
                new KnowledgeFilesystemError('knowledge_content_invalid'),
              ),
        ),
    );
    const searchLater = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.reject(
        new KnowledgeFilesystemError('knowledge_space_unavailable'),
      ),
    );
    const toolContext = multiSpaceContext(
      spaces,
      new Map([
        [bindingBefore.id, bindingBefore],
        [binding.id, binding],
        [bindingLater.id, bindingLater],
      ]),
      new Map([
        [bindingBefore.id, fakeAdapter({ search: searchBefore })],
        [binding.id, fakeAdapter({ search: searchAnchor })],
        [bindingLater.id, fakeAdapter({ search: searchLater })],
      ]),
    );

    const first = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
    });
    if (first.status !== 'success' || !isString(first.nextCursor)) {
      throw new Error('Expected a continuation cursor');
    }
    const second = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second).toEqual({
      status: 'error',
      type: 'knowledge_content_invalid',
      message: 'The Knowledge note is not valid UTF-8.',
    });
    expect(searchBefore).toHaveBeenCalledOnce();
    expect(searchAnchor).toHaveBeenCalledTimes(2);
    expect(searchLater).toHaveBeenCalledTimes(2);
  });

  it('returns later passages without locating a deleted anchor', async () => {
    const search = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([
        { path: 'a.md', offset: 0, limit: 1, excerpt: 'first' },
        { path: 'a.md', offset: 4, limit: 1, excerpt: 'later' },
      ]),
    );
    const adapter = fakeAdapter({ search });
    const first = await knowledgeSearchTool.execute(context(adapter), {
      query: 'needle',
      limit: 1,
    });

    expect(first).toMatchObject({
      status: 'success',
      results: [{ offset: 0 }],
    });
    if (first.status !== 'success' || !isString(first.nextCursor)) {
      throw new Error('Expected a search continuation cursor');
    }
    const second = await knowledgeSearchTool.execute(context(adapter), {
      query: 'NEEDLE',
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({
      status: 'success',
      results: [{ path: 'a.md', offset: 4 }],
    });
    expect(search.mock.calls[1]?.[2]?.after).toEqual({
      path: 'a.md',
      offset: 0,
    });
  });

  it('skips a deleted anchor and includes a newly added later space', async () => {
    const bindingLater: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Later',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const bindingAdded: KnowledgeFilesystemBinding = {
      ...binding,
      id: '8f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Added',
      directory: '/srv/knowledge/8f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const anchor = {
      id: binding.id,
      name: 'Anchor',
      createdAt: new Date(0),
    };
    const later = {
      id: bindingLater.id,
      name: 'Later',
      createdAt: new Date(1),
    };
    const added = {
      id: bindingAdded.id,
      name: 'Added',
      createdAt: new Date(2),
    };
    const searchAnchor = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([{ path: 'a.md', offset: 0, limit: 1, excerpt: 'a0' }]),
    );
    const searchLater = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([{ path: 'b.md', offset: 0, limit: 1, excerpt: 'b0' }]),
    );
    const searchAdded = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([{ path: 'c.md', offset: 0, limit: 1, excerpt: 'c0' }]),
    );
    const baseContext = multiSpaceContext(
      [anchor, later],
      new Map([
        [binding.id, binding],
        [bindingLater.id, bindingLater],
        [bindingAdded.id, bindingAdded],
      ]),
      new Map([
        [binding.id, fakeAdapter({ search: searchAnchor })],
        [bindingLater.id, fakeAdapter({ search: searchLater })],
        [bindingAdded.id, fakeAdapter({ search: searchAdded })],
      ]),
    );
    let inventoryCall = 0;
    const toolContext: ToolContext = {
      ...baseContext,
      knowledgeResolver: {
        ...baseContext.knowledgeResolver!,
        listForOwnerPage: vi.fn(() => {
          inventoryCall += 1;
          return Promise.resolve({
            spaces: inventoryCall === 1 ? [anchor, later] : [later, added],
          });
        }),
      },
    };

    const first = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
    });
    if (first.status !== 'success' || !isString(first.nextCursor)) {
      throw new Error('Expected a continuation cursor');
    }
    const second = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({
      status: 'success',
      results: [{ knowledgeSpaceId: bindingLater.id, path: 'b.md' }],
    });
    expect(searchAnchor).toHaveBeenCalledOnce();
    expect(searchAdded).toHaveBeenCalledOnce();
  });

  it('rejects malformed and request-mismatched cursors before filesystem access', async () => {
    const search = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([]),
    );
    const adapter = fakeAdapter({ search });
    const cursor = encodeKnowledgeSearchCursor({
      version: 1,
      query: 'needle',
      knowledgeSpaceId: binding.id,
      spaceCreatedAt: new Date(0),
      spaceId: binding.id,
      path: 'a.md',
      offset: 0,
    });

    await expect(
      knowledgeSearchTool.execute(context(adapter), {
        query: 'needle',
        limit: 1,
        cursor: 'bad!',
      }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'knowledge_cursor_invalid',
    });
    await expect(
      knowledgeSearchTool.execute(context(adapter), {
        query: 'different',
        limit: 1,
        knowledgeSpaceId: binding.id,
        cursor,
      }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'knowledge_cursor_invalid',
    });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('knowledge_search', () => {
  it('returns the stable space ID and safe match attribution', async () => {
    const adapter = fakeAdapter({
      search: vi.fn(() =>
        Promise.resolve([
          {
            path: 'notes/a.md',
            offset: 0,
            limit: 1,
            excerpt: 'Needle line',
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
      results: [
        {
          knowledgeSpaceId: binding.id,
          knowledgeSpaceName: binding.name,
          path: 'notes/a.md',
          offset: 0,
          limit: 1,
          excerpt: 'Needle line',
        },
      ],
      complete: true,
      warningCount: 0,
      warnings: [],
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
      results: [],
      complete: true,
      warningCount: 0,
      warnings: [],
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
  });

  it('passes only trusted owner scope and the model query to the adapter', async () => {
    const search = vi.fn<KnowledgeFilesystemAdapterPort['search']>(() =>
      Promise.resolve([]),
    );
    const adapter = fakeAdapter({ search });
    const toolContext = context(adapter);
    const resolver = toolContext.knowledgeResolver!;
    await knowledgeSearchTool.execute(toolContext, {
      query: 'literal',
      limit: 3,
    });

    expect(resolver.listForOwnerPage).toHaveBeenCalledWith(
      'owner-a',
      undefined,
    );
    expect(resolver.resolveBindingForOwnerById).toHaveBeenCalledWith(
      'owner-a',
      binding.id,
    );
    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0]).toBe('literal');
    expect(search.mock.calls[0]?.[1]).toBe(3);
    expect(search.mock.calls[0]?.[2]?.signal).toBeUndefined();
    expect(search.mock.calls[0]?.[2]?.budget).toBeDefined();
  });

  it('returns a whole-operation limit error when the success projection is too large', async () => {
    const adapter = fakeAdapter({
      search: vi.fn(() =>
        Promise.resolve([
          {
            path: 'notes/a.md',
            offset: 0,
            limit: 1,
            excerpt: 'x'.repeat(KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS),
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

  it('searches current spaces in page order under one shared budget', async () => {
    const spaceA: KnowledgeToolSpaceReference = {
      id: binding.id,
      name: 'Same label',
      createdAt: new Date('2026-08-23T12:00:00.000Z'),
    };
    const bindingB: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Same label',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaceB: KnowledgeToolSpaceReference = {
      id: bindingB.id,
      name: bindingB.name!,
      createdAt: new Date('2026-08-23T12:01:00.000Z'),
    };
    const budgets: Array<unknown> = [];
    const adapterA = fakeAdapter({
      search: vi.fn(
        (
          _query: string,
          _limit: number,
          options: KnowledgeFilesystemSearchOptions = {},
        ) => {
          budgets.push(options.budget);
          return Promise.resolve([
            {
              path: 'a.md',
              offset: 0,
              limit: 1,
              excerpt: 'first',
            },
          ]);
        },
      ),
    });
    const adapterB = fakeAdapter({
      search: vi.fn(
        (
          _query: string,
          _limit: number,
          options: KnowledgeFilesystemSearchOptions = {},
        ) => {
          budgets.push(options.budget);
          return Promise.resolve([
            {
              path: 'b.md',
              offset: 0,
              limit: 1,
              excerpt: 'second',
            },
          ]);
        },
      ),
    });
    const result = await knowledgeSearchTool.execute(
      multiSpaceContext(
        [spaceA, spaceB],
        new Map([
          [binding.id, { ...binding, name: spaceA.name }],
          [bindingB.id, bindingB],
        ]),
        new Map([
          [binding.id, adapterA],
          [bindingB.id, adapterB],
        ]),
      ),
      { query: 'term', limit: 10 },
    );

    expect(result).toMatchObject({
      status: 'success',
      complete: true,
      warningCount: 0,
      results: [
        { knowledgeSpaceId: binding.id, path: 'a.md' },
        { knowledgeSpaceId: bindingB.id, path: 'b.md' },
      ],
    });
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toBe(budgets[1]);
  });

  it('processes each inventory page before requesting the next page', async () => {
    const bindingB: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Second',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const spaceA: KnowledgeToolSpaceReference = {
      id: binding.id,
      name: 'First',
      createdAt: new Date(0),
    };
    const spaceB: KnowledgeToolSpaceReference = {
      id: bindingB.id,
      name: 'Second',
      createdAt: new Date(1),
    };
    let firstPageSearched = false;
    const adapterA = fakeAdapter({
      search: vi.fn(() => {
        firstPageSearched = true;
        return Promise.resolve([
          {
            path: 'a.md',
            offset: 0,
            limit: 1,
            excerpt: 'first',
          },
        ]);
      }),
    });
    const adapterB = fakeAdapter({
      search: vi.fn(() =>
        Promise.resolve([
          {
            path: 'b.md',
            offset: 0,
            limit: 1,
            excerpt: 'second',
          },
        ]),
      ),
    });
    const nextCursor = { createdAt: spaceA.createdAt, id: spaceA.id };
    const listForOwnerPage = vi.fn(
      (_owner: string, after?: KnowledgeSpaceCursor) => {
        if (after === undefined) {
          return Promise.resolve({ spaces: [spaceA], nextCursor });
        }
        if (!firstPageSearched) {
          throw new Error('The inventory was materialized before searching');
        }
        return Promise.resolve({ spaces: [spaceB] });
      },
    );
    const baseContext = multiSpaceContext(
      [spaceA, spaceB],
      new Map([
        [binding.id, binding],
        [bindingB.id, bindingB],
      ]),
      new Map([
        [binding.id, adapterA],
        [bindingB.id, adapterB],
      ]),
    );
    const toolContext: ToolContext = {
      ...baseContext,
      knowledgeResolver: {
        ...baseContext.knowledgeResolver!,
        listForOwnerPage,
      },
    };

    const result = await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 1,
    });

    expect(listForOwnerPage).toHaveBeenCalledTimes(2);
    expect(adapterB.search).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'success',
      results: [{ knowledgeSpaceId: binding.id, path: 'a.md' }],
    });
  });

  it('narrows explicit search and rejects an absent current selector', async () => {
    const bindingB: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Other',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const adapterA = fakeAdapter({ search: vi.fn(() => Promise.resolve([])) });
    const adapterB = fakeAdapter({ search: vi.fn(() => Promise.resolve([])) });
    const toolContext = multiSpaceContext(
      [
        { id: binding.id, name: 'A', createdAt: new Date(0) },
        { id: bindingB.id, name: 'B', createdAt: new Date(1) },
      ],
      new Map([
        [binding.id, binding],
        [bindingB.id, bindingB],
      ]),
      new Map([
        [binding.id, adapterA],
        [bindingB.id, adapterB],
      ]),
    );

    await knowledgeSearchTool.execute(toolContext, {
      query: 'term',
      limit: 5,
      knowledgeSpaceId: bindingB.id,
    });
    expect(adapterA.search).not.toHaveBeenCalled();
    expect(adapterB.search).toHaveBeenCalledOnce();

    await expect(
      knowledgeSearchTool.execute(toolContext, {
        query: 'term',
        limit: 5,
        knowledgeSpaceId: '8f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_space_not_found',
      message: 'Knowledge Space was not found.',
    });
  });

  it('omits an unscoped row revoked before its pre-open access check', async () => {
    const revoked = {
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Revoked',
      createdAt: new Date(0),
    };
    const current = {
      id: binding.id,
      name: binding.name ?? binding.id,
      createdAt: new Date(1),
    };
    const adapter = fakeAdapter();

    await expect(
      knowledgeSearchTool.execute(
        multiSpaceContext(
          [revoked, current],
          new Map([[binding.id, binding]]),
          new Map([[binding.id, adapter]]),
        ),
        { query: 'term', limit: 5 },
      ),
    ).resolves.toMatchObject({
      status: 'success',
      complete: true,
      warningCount: 0,
      warnings: [],
    });
    expect(adapter.search).toHaveBeenCalledOnce();

    await expect(
      knowledgeSearchTool.execute(
        multiSpaceContext([revoked], new Map(), new Map()),
        { query: 'term', limit: 5 },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_space_not_configured',
      message: 'Knowledge Space is not configured.',
    });
  });

  it('returns bounded incomplete warnings when one current space fails', async () => {
    const bindingB: KnowledgeFilesystemBinding = {
      ...binding,
      id: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      name: 'Broken',
      directory: '/srv/knowledge/7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    };
    const adapterA = fakeAdapter({
      search: vi.fn(() =>
        Promise.resolve([
          {
            path: 'a.md',
            offset: 0,
            limit: 1,
            excerpt: 'term',
          },
        ]),
      ),
    });
    const adapterB = fakeAdapter({
      search: vi.fn(() =>
        Promise.reject(new KnowledgeFilesystemError('knowledge_path_invalid')),
      ),
    });
    const result = await knowledgeSearchTool.execute(
      multiSpaceContext(
        [
          { id: binding.id, name: 'Working', createdAt: new Date(0) },
          { id: bindingB.id, name: 'Broken', createdAt: new Date(1) },
        ],
        new Map([
          [binding.id, binding],
          [bindingB.id, bindingB],
        ]),
        new Map([
          [binding.id, adapterA],
          [bindingB.id, adapterB],
        ]),
      ),
      { query: 'term', limit: 5 },
    );

    expect(result).toMatchObject({
      status: 'success',
      complete: false,
      warningCount: 1,
      warnings: [
        {
          type: 'knowledge_path_invalid',
          knowledgeSpaceId: bindingB.id,
          knowledgeSpaceName: 'Broken',
        },
      ],
      results: [{ knowledgeSpaceId: binding.id, path: 'a.md' }],
    });
  });

  it('counts warning details omitted by the structured-output budget', async () => {
    const workingSpace: KnowledgeToolSpaceReference = {
      id: binding.id,
      name: 'Working',
      createdAt: new Date(0),
    };
    const spaces = [workingSpace];
    const bindings = new Map<string, KnowledgeFilesystemBinding>([
      [binding.id, binding],
    ]);
    const adapters = new Map<string, KnowledgeFilesystemAdapterPort>([
      [binding.id, fakeAdapter()],
    ]);
    for (let index = 1; index <= 60; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const space = {
        id,
        name: `Broken ${'x'.repeat(90)}`,
        createdAt: new Date(index),
      };
      spaces.push(space);
      bindings.set(id, {
        id,
        name: space.name,
        root: '/srv/knowledge',
        directory: `/srv/knowledge/${id}`,
      });
      adapters.set(
        id,
        fakeAdapter({
          search: vi.fn(() =>
            Promise.reject(
              new KnowledgeFilesystemError('knowledge_path_invalid'),
            ),
          ),
        }),
      );
    }

    const result = await knowledgeSearchTool.execute(
      multiSpaceContext(spaces, bindings, adapters),
      { query: 'term', limit: 5 },
    );

    expect(result).toMatchObject({
      status: 'success',
      complete: false,
      warningCount: 60,
    });
    if (result.status !== 'success' || !Array.isArray(result.warnings)) {
      throw new Error('Expected bounded warning details');
    }
    expect(result.warnings.length).toBeLessThan(60);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS,
    );
  });

  it('returns not configured for an empty current inventory', async () => {
    const result = await knowledgeSearchTool.execute(
      multiSpaceContext([], new Map(), new Map()),
      { query: 'term', limit: 5 },
    );
    expect(result).toEqual({
      status: 'error',
      type: 'knowledge_space_not_configured',
      message: 'Knowledge Space is not configured.',
    });
  });

  it('returns the first closed failure when listed spaces cannot be resolved', async () => {
    const listedSpace: KnowledgeToolSpaceReference = {
      id: binding.id,
      name: 'Unavailable',
      createdAt: new Date(0),
    };
    const baseContext = multiSpaceContext([listedSpace], new Map(), new Map());
    const toolContext: ToolContext = {
      ...baseContext,
      knowledgeResolver: {
        ...baseContext.knowledgeResolver!,
        resolveBindingForOwnerById: vi.fn(() =>
          Promise.reject(new Error('/private/host/path')),
        ),
      },
    };

    await expect(
      knowledgeSearchTool.execute(toolContext, { query: 'term', limit: 5 }),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });
  });
});

describe('knowledge_read', () => {
  it('forwards optional ranges and preserves continuation metadata without hashes', async () => {
    const read = vi.fn<KnowledgeFilesystemAdapterPort['read']>(() =>
      Promise.resolve({
        path: 'notes/a.md',
        offset: 4,
        lineCount: 2,
        content: '5: fifth\n6: sixth\n',
        nextOffset: 6,
      }),
    );
    const result = await knowledgeReadTool.execute(
      context(fakeAdapter({ read })),
      {
        knowledgeSpaceId: binding.id,
        path: 'notes/a.md',
        offset: 4,
        limit: 2,
      },
    );

    const readCall = read.mock.calls[0];
    expect(readCall?.[0]).toBe('notes/a.md');
    expect(readCall?.[1]).toMatchObject({
      signal: undefined,
      offset: 4,
      limit: 2,
    });
    expect(readCall?.[1]?.maxResultCodeUnits).toBe(
      KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS,
    );
    expect(readCall?.[1]?.fixedResultCodeUnits).toBeGreaterThan(0);
    expect(result).toEqual({
      status: 'success',
      knowledgeSpaceId: binding.id,
      knowledgeSpaceName: binding.name,
      path: 'notes/a.md',
      offset: 4,
      lineCount: 2,
      content: '5: fifth\n6: sixth\n',
      nextOffset: 6,
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
    expect(result).not.toHaveProperty('contentHash');
  });

  it('returns the closed range error from the adapter', async () => {
    const adapter = fakeAdapter({
      read: vi.fn(() =>
        Promise.reject(new KnowledgeFilesystemError('knowledge_range_invalid')),
      ),
    });

    await expect(
      knowledgeReadTool.execute(context(adapter), {
        knowledgeSpaceId: binding.id,
        path: 'notes/a.md',
        offset: 99,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_range_invalid',
      message: 'The Knowledge line range is invalid.',
    });
  });

  it('returns complete live content and exact attribution', async () => {
    const result = await knowledgeReadTool.execute(context(), {
      knowledgeSpaceId: binding.id,
      path: 'notes/a.md',
    });

    expect(result).toEqual({
      status: 'success',
      knowledgeSpaceId: binding.id,
      knowledgeSpaceName: binding.name,
      path: 'notes/a.md',
      offset: 0,
      lineCount: 1,
      content: '1: note',
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
    expect(result).not.toHaveProperty('contentHash');
  });

  it('returns a whole-operation limit error instead of partial content', async () => {
    const adapter = fakeAdapter({
      read: vi.fn(() =>
        Promise.resolve({
          path: 'notes/a.md',
          content: 'x'.repeat(KNOWLEDGE_TOOL_RESULT_MAX_CODE_UNITS),
          offset: 0,
          lineCount: 1,
        }),
      ),
    });

    const result = await knowledgeReadTool.execute(context(adapter), {
      knowledgeSpaceId: binding.id,
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
          content: '😀'.repeat(6000),
          offset: 0,
          lineCount: 1,
        }),
      ),
    });

    const result = await knowledgeReadTool.execute(context(adapter), {
      knowledgeSpaceId: binding.id,
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
      { knowledgeSpaceId: binding.id, path: 'notes/a.md' },
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
      knowledgeReadTool.execute(context(adapter), {
        knowledgeSpaceId: binding.id,
        path: 'bad.md',
      }),
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
      knowledgeReadTool.execute(toolContext, {
        knowledgeSpaceId: binding.id,
        path: 'note.md',
      }),
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
