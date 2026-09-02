import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type ModelToolDeclaration } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { type Tool, type JsonSchemaDocument } from '../tools/types';
import { hashToolDeclaration } from '../tools/turn-tool-catalog';
import { isRecord } from '../unknown-record';
import { resolveBoundExecutableTools } from './snapshot-tool-execution';

/** The not-available executor path below never reaches `.runAs`. */
const fakeTenantDb: TenantRunner = {
  runAs: () => {
    throw new Error('runAs should not be called by this executor context');
  },
};

/** The JSON round-trip in `makeDeclaration` below erases compile-time type
 * information; this reasserts it from the actual shape. */
function assertModelToolDeclaration(
  value: unknown,
): asserts value is ModelToolDeclaration {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.description !== 'string' ||
    !isRecord(value.inputSchema)
  ) {
    throw new TypeError('Expected a canonical ModelToolDeclaration');
  }
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'test_tool',
    description: 'A test tool',
    classification: 'read_only',
    inputSchema: z.object({ query: z.string() }),
    execute: () => ({ status: 'success' as const }),
    ...overrides,
  };
}

function makeJsonSchemaTool(
  schema: JsonSchemaDocument,
  overrides: Partial<Tool> = {},
): Tool {
  return makeTool({ inputSchema: schema, ...overrides });
}

async function makeDeclaration(tool: Tool): Promise<ModelToolDeclaration> {
  const { resolveJsonSchema } = await import('../tools/schema-utils.js');
  const { canonicalJson } = await import('./effective-context-resolver.js');
  const declaration: unknown = JSON.parse(
    canonicalJson({
      id: tool.id,
      description: tool.description,
      inputSchema: await resolveJsonSchema(tool.inputSchema),
    }),
  );
  assertModelToolDeclaration(declaration);
  return declaration;
}

describe('resolveBoundExecutableTools — JSON-Schema tools', () => {
  it('an unchanged JSON-Schema tool rebinds without spurious drift (3.6)', async () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1 },
      },
      required: ['query'],
    };
    const tool = makeJsonSchemaTool(schema);
    const declaration = await makeDeclaration(tool);
    const registry = new Map([[tool.id, tool]]);

    const result = await resolveBoundExecutableTools([declaration], registry);
    expect(result).toHaveLength(1);
    expect(result[0].executor).toBe(tool);
  });

  it('key-order differences are not drift (3.6)', async () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['query'],
    };
    const tool = makeJsonSchemaTool(schema);
    const declaration = await makeDeclaration(tool);

    const reorderedSchema: JsonSchemaDocument = {
      required: ['query'],
      properties: {
        limit: { type: 'integer' },
        query: { type: 'string' },
      },
      type: 'object',
    };
    const reorderedTool = makeJsonSchemaTool(reorderedSchema);
    const registry = new Map([[reorderedTool.id, reorderedTool]]);

    const result = await resolveBoundExecutableTools([declaration], registry);
    expect(result).toHaveLength(1);
  });

  it('a real content change is drift (3.6)', async () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    };
    const tool = makeJsonSchemaTool(schema);
    const declaration = await makeDeclaration(tool);

    const changedSchema: JsonSchemaDocument = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        newField: { type: 'boolean' },
      },
      required: ['query'],
    };
    const changedTool = makeJsonSchemaTool(changedSchema);
    const registry = new Map([[changedTool.id, changedTool]]);

    await expect(
      resolveBoundExecutableTools([declaration], registry),
    ).rejects.toThrow('no longer matches');
  });

  it('rejects a registered writable tool before comparing its declaration', async () => {
    const tool = makeTool({ classification: 'write_low_risk' });
    const declaration = await makeDeclaration(tool);

    await expect(
      resolveBoundExecutableTools([declaration], new Map([[tool.id, tool]])),
    ).rejects.toThrow('no longer read-only');
  });

  it('rejects a registered tool whose JSON-Schema dialect is unsupported', async () => {
    const tool = makeJsonSchemaTool({
      $schema: 'https://schemas.example.invalid/unknown',
      type: 'object',
    });
    const declaration = await makeDeclaration(tool);

    await expect(
      resolveBoundExecutableTools([declaration], new Map([[tool.id, tool]])),
    ).rejects.toThrow('unsupported schema dialect');
  });
});

describe('resolveBoundExecutableTools — declaration validation', () => {
  it.each([['empty id', makeTool({ id: '' })]])(
    'rejects a declaration with an %s',
    async (_case, tool) => {
      const declaration = await makeDeclaration(tool);

      await expect(
        resolveBoundExecutableTools([declaration], new Map()),
      ).rejects.toThrow('invalid tool declaration');
    },
  );

  it('rejects duplicate declarations before rebinding the second entry', async () => {
    const tool = makeTool();
    const declaration = await makeDeclaration(tool);

    await expect(
      resolveBoundExecutableTools(
        [declaration, declaration],
        new Map([[tool.id, tool]]),
      ),
    ).rejects.toThrow(`duplicate tool id "${tool.id}"`);
  });
});

describe('resolveBoundExecutableTools — dynamic tools', () => {
  it('binds the current dynamic executor only when its declaration hash exactly matches', async () => {
    const tool = makeJsonSchemaTool(
      {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      { id: 'mcp__web__search' },
    );
    const declaration = await makeDeclaration(tool);
    const resolver = {
      resolveDynamicTool: vi.fn(() => ({
        state: 'available' as const,
        declarationHash: hashToolDeclaration(declaration),
        executor: tool,
      })),
    };

    const result = await resolveBoundExecutableTools(
      [declaration],
      new Map(),
      resolver,
    );

    expect(result).toEqual([{ declaration, executor: tool }]);
    expect(resolver.resolveDynamicTool).toHaveBeenCalledOnce();
    expect(resolver.resolveDynamicTool).toHaveBeenCalledWith(tool.id);
  });

  it.each([
    ['disconnected', { state: 'unavailable' as const }],
    [
      'declaration drift',
      {
        state: 'available' as const,
        declarationHash: '0'.repeat(64),
        executor: makeTool({ id: 'mcp__web__search' }),
      },
    ],
  ])(
    'preserves the snapshot contract and binds not_available on %s',
    async (_case, resolution) => {
      const liveExecute = vi.fn(() => ({ status: 'success' as const }));
      const tool = makeTool({
        id: 'mcp__web__search',
        execute: liveExecute,
      });
      const declaration = await makeDeclaration(tool);

      const [bound] = await resolveBoundExecutableTools(
        [declaration],
        new Map(),
        { resolveDynamicTool: () => resolution },
      );

      expect(bound.declaration).toBe(declaration);
      expect(
        await bound.executor.execute(
          {
            userId: 'user-1',
            chatId: 'chat-1',
            tenantDb: fakeTenantDb,
          },
          { query: 'llame' },
        ),
      ).toEqual({
        status: 'error',
        type: 'not_available',
        message: 'Tool "mcp__web__search" is not available.',
      });
      expect(liveExecute).not.toHaveBeenCalled();
      expect(bound.executor.id).toBe(declaration.id);
      expect(bound.executor.description).toBe(declaration.description);
      expect(bound.executor.inputSchema).toBe(declaration.inputSchema);
    },
  );

  it('keeps an unknown mcp-shaped id Run-fatal when the resolver does not confirm it is configured', async () => {
    const tool = makeTool({ id: 'mcp__missing__search' });
    const declaration = await makeDeclaration(tool);

    await expect(
      resolveBoundExecutableTools([declaration], new Map(), {
        resolveDynamicTool: () => ({ state: 'not_dynamic' }),
      }),
    ).rejects.toThrow('has no registered executor');
  });

  it('keeps an unknown id Run-fatal when no dynamic resolver is installed', async () => {
    const tool = makeTool({ id: 'mcp__missing__search' });
    const declaration = await makeDeclaration(tool);

    await expect(
      resolveBoundExecutableTools([declaration], new Map()),
    ).rejects.toThrow('has no registered executor');
  });

  it.each([
    ['executor id drift', { id: 'mcp__other__search' }],
    [
      'executor classification drift',
      { classification: 'write_low_risk' as const },
    ],
  ])(
    'binds an unavailable executor when the dynamic %s',
    async (_case, executorOverrides) => {
      const tool = makeTool({ id: 'mcp__web__search' });
      const declaration = await makeDeclaration(tool);
      const resolver = {
        resolveDynamicTool: () => ({
          state: 'available' as const,
          declarationHash: hashToolDeclaration(declaration),
          executor: makeTool({ id: tool.id, ...executorOverrides }),
        }),
      };

      const [bound] = await resolveBoundExecutableTools(
        [declaration],
        new Map(),
        resolver,
      );
      expect(bound.executor.id).toBe(declaration.id);
      expect(
        await bound.executor.execute(
          { userId: 'user-1', chatId: 'chat-1', tenantDb: fakeTenantDb },
          { query: 'llame' },
        ),
      ).toMatchObject({ status: 'error', type: 'not_available' });
    },
  );

  it('keeps a code-owned declaration mismatch Run-fatal even with a dynamic resolver', async () => {
    const snapshotted = makeTool();
    const declaration = await makeDeclaration(snapshotted);
    const changed = makeTool({ description: 'Changed live declaration' });

    await expect(
      resolveBoundExecutableTools(
        [declaration],
        new Map([[changed.id, changed]]),
        { resolveDynamicTool: () => ({ state: 'not_dynamic' }) },
      ),
    ).rejects.toThrow('no longer matches');
  });

  it('keeps a code-owned missing executor Run-fatal when the resolver does not claim it', async () => {
    const tool = makeTool();
    const declaration = await makeDeclaration(tool);

    await expect(
      resolveBoundExecutableTools([declaration], new Map(), {
        resolveDynamicTool: () => ({ state: 'not_dynamic' }),
      }),
    ).rejects.toThrow('has no registered executor');
  });

  it('keeps a registered mcp-shaped code-owned declaration on the strict integrity path', async () => {
    const snapshotted = makeTool({ id: 'mcp__code__owned' });
    const declaration = await makeDeclaration(snapshotted);
    const changed = makeTool({
      id: snapshotted.id,
      description: 'Changed registered declaration',
    });
    const resolveDynamicTool = vi.fn(() => ({
      state: 'unavailable' as const,
    }));

    await expect(
      resolveBoundExecutableTools(
        [declaration],
        new Map([[changed.id, changed]]),
        { resolveDynamicTool },
      ),
    ).rejects.toThrow('no longer matches');
    expect(resolveDynamicTool).not.toHaveBeenCalled();
  });
});
