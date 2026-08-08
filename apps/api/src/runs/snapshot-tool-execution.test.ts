import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type ModelToolDeclaration } from '../db/schema';
import { type Tool, type JsonSchemaDocument } from '../tools/types';
import { resolveBoundExecutableTools } from './snapshot-tool-execution';

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
  const canonicalize = (v: unknown): unknown =>
    JSON.parse(canonicalJson(v)) as unknown;
  return canonicalize({
    id: tool.id,
    description: tool.description,
    inputSchema: await resolveJsonSchema(tool.inputSchema),
  }) as ModelToolDeclaration;
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
});
