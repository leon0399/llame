import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { afterEach, vi } from 'vitest';

import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type Tool } from '../tools/types';
import { isRecord } from '@workspace/runtime-safety';
import {
  canonicalJson,
  resolveEffectiveContext,
} from './effective-context-resolver';

const model = (overrides?: Partial<SystemModelCatalogEntry>) =>
  ({
    id: 'public:model',
    source: 'system',
    name: 'Public Model',
    contextWindowTokens: 128_000,
    provider: 'private-provider',
    providerModelId: 'private-provider-id',
    systemPromptTemplate: 'Use the configured prompt.\n',
    systemPromptSource: 'model_override',
    referencesSkills: false,
    ...overrides,
  }) satisfies SystemModelCatalogEntry;

const tool = (
  id: string,
  inputSchema: Tool['inputSchema'],
  overrides?: Partial<Tool>,
): Tool => ({
  id,
  description: `Description for ${id}`,
  classification: 'read_only',
  inputSchema,
  execute: () => ({ status: 'success' }),
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('effective context resolver', () => {
  it('admits and canonicalizes the allowlisted read-only catalog in memory', async () => {
    const context = await resolveEffectiveContext({
      model: model(),
      systemPrompt: model().systemPromptTemplate,
      callTimeoutSeconds: 15,
      allowedToolRules: ['z_tool', 'a_tool', 'write_tool'],
      candidates: [
        tool(
          'z_tool',
          z.object({ zebra: z.string(), alpha: z.number() }).strict(),
        ),
        tool('write_tool', z.object({ value: z.string() }), {
          classification: 'write_low_risk',
        }),
        tool(
          'a_tool',
          z.object({ nested: z.object({ z: z.string(), a: z.string() }) }),
        ),
        tool('unlisted', z.object({ ignored: z.string() })),
      ],
    });

    expect(context.toolDeclarations.map(({ id }) => id)).toEqual([
      'a_tool',
      'z_tool',
    ]);
    expect(Object.keys(context.toolDeclarations[0].inputSchema)).toEqual(
      Object.keys(context.toolDeclarations[0].inputSchema).sort(),
    );
    const inputSchemaProperties =
      context.toolDeclarations[0].inputSchema.properties;
    if (
      !isRecord(inputSchemaProperties) ||
      !isRecord(inputSchemaProperties.nested)
    ) {
      throw new Error('Expected nested JSON Schema properties');
    }
    const nestedProperties = inputSchemaProperties.nested.properties;
    if (!isRecord(nestedProperties)) {
      throw new Error('Expected nested JSON Schema properties object');
    }
    expect(Object.keys(nestedProperties)).toEqual(['a', 'z']);
    expect(
      context.toolAvailabilityManifest.entries.map(({ id }) => id),
    ).toEqual(['a_tool', 'z_tool']);
  });

  it('records observed availability for admitted declarations without persistence fields', async () => {
    const context = await resolveEffectiveContext({
      model: model(),
      systemPrompt: model().systemPromptTemplate,
      callTimeoutSeconds: 15,
      allowedToolRules: ['z_tool', 'a_tool'],
      candidates: [
        tool('z_tool', z.object({ value: z.string() })),
        tool('a_tool', z.object({ value: z.string() })),
      ],
    });

    expect(context.toolAvailabilityManifest).toMatchObject({
      version: 1,
      entries: [
        { id: 'a_tool', state: 'available' },
        { id: 'z_tool', state: 'available' },
      ],
    });
    expect(context.toolAvailabilityManifest.entries).toHaveLength(2);
    expect(context.toolAvailabilityManifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a_tool', state: 'available' }),
        expect.objectContaining({ id: 'z_tool', state: 'available' }),
      ]),
    );
    for (const entry of context.toolAvailabilityManifest.entries) {
      if (entry.state !== 'available') {
        throw new Error('Expected an available entry');
      }
      // The observation carries the declaration hash — never the declaration
      // body it stands for.
      expect(Object.keys(entry).sort()).toEqual([
        'declarationHash',
        'id',
        'state',
      ]);
      expect(entry.declarationHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('keeps unavailable owner-bound candidates in the resolved context', async () => {
    const context = await resolveEffectiveContext({
      model: model(),
      systemPrompt: model().systemPromptTemplate,
      callTimeoutSeconds: 15,
      allowedToolRules: ['knowledge_search'],
      codeOwnedCandidates: [
        {
          source: { type: 'code_owned' },
          state: 'unavailable',
          id: 'knowledge_search',
          classification: 'read_only',
          reason: 'knowledge_space_unavailable',
        },
      ],
    });

    expect(context.toolDeclarations).toEqual([]);
    expect(context.toolAvailabilityManifest).toEqual({
      version: 1,
      entries: [
        {
          id: 'knowledge_search',
          state: 'unavailable',
          reason: 'knowledge_space_unavailable',
        },
      ],
    });
  });

  it('composes dynamic MCP candidates and applies namespace wildcards to exact ids', async () => {
    const context = await resolveEffectiveContext({
      model: model(),
      systemPrompt: model().systemPromptTemplate,
      callTimeoutSeconds: 15,
      allowedToolRules: ['mcp__web__*'],
      candidates: [],
      dynamicCandidates: [
        {
          source: { type: 'mcp', serverId: 'web' },
          state: 'available',
          tool: tool('mcp__web__search', z.object({ query: z.string() })),
        },
        {
          source: { type: 'mcp', serverId: 'webExtra' },
          state: 'available',
          tool: tool('mcp__webExtra__search', z.object({ query: z.string() })),
        },
      ],
    });

    expect(context.toolDeclarations.map(({ id }) => id)).toEqual([
      'mcp__web__search',
    ]);
    expect(
      context.toolAvailabilityManifest.entries.map(({ id }) => id),
    ).toEqual(['mcp__web__search']);
    expect(context.toolDeclarations.map(({ id }) => id)).not.toContain(
      'mcp__web__*',
    );
  });

  it('returns a system-only receipt input and a domain-separated prompt hash', async () => {
    const prompt = model().systemPromptTemplate;
    const context = await resolveEffectiveContext({
      model: model(),
      systemPrompt: prompt,
      callTimeoutSeconds: 15,
      allowedToolRules: ['tool'],
      candidates: [tool('tool', z.object({ value: z.string() }))],
    });
    const { toolAvailabilityManifest, toolDeclarations, ...receipt } = context;

    // Only the system prompt half is receipt input; the admitted tool contract
    // stays in memory beside it.
    expect(Object.keys(receipt).sort()).toEqual([
      'promptHash',
      'source',
      'systemPrompt',
    ]);
    expect(toolDeclarations.map(({ id }) => id)).toEqual(['tool']);
    expect(toolAvailabilityManifest.entries.map(({ id }) => id)).toEqual([
      'tool',
    ]);
    expect(receipt.source).toBe('model_override');
    expect(receipt.systemPrompt).toBe(prompt);
    expect(receipt.promptHash).toMatch(/^[0-9a-f]{64}$/);

    // The domain tag and digest are persisted contract: pin the literal so a
    // change to the separator, encoding, or digest fails here instead of
    // silently rewriting every stored prompt hash.
    expect(receipt.promptHash).toBe(
      '8d6073494aa6d69d68f40b6bebe9c5888c2a006978de925c92e52fae8185a2f7',
    );
    const repeated = await resolveEffectiveContext({
      model: model({ providerModelId: 'other-provider-id' }),
      systemPrompt: prompt,
      callTimeoutSeconds: 15,
      allowedToolRules: [],
      candidates: [],
    });
    expect(repeated.promptHash).toBe(receipt.promptHash);
    expect(repeated.systemPrompt).toBe(receipt.systemPrompt);
  });

  it('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalJson({
        z: [{ z: 1, a: 2 }, 'second'],
        a: { z: true, a: false },
      }),
    ).toBe('{"a":{"a":false,"z":true},"z":[{"a":2,"z":1},"second"]}');
  });

  it('orders canonical object keys by Unicode code point rather than UTF-16 code unit', () => {
    const bmp = '\uE000';
    const astral = '\u{10000}';
    expect(canonicalJson({ [astral]: 'astral', [bmp]: 'bmp' })).toBe(
      `{"${bmp}":"bmp","${astral}":"astral"}`,
    );
  });

  it('filters malformed and unsupported schemas before they enter the catalog', async () => {
    const warnings: Array<string> = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message) => {
      warnings.push(String(message));
    });
    const validJsonSchema = {
      $schema: 'https://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { value: { type: 'string' } },
    };
    const context = await resolveEffectiveContext({
      model: model(),
      systemPrompt: model().systemPromptTemplate,
      callTimeoutSeconds: 15,
      allowedToolRules: ['valid_json', 'valid_zod', 'malformed', 'unsupported'],
      candidates: [
        tool('valid_json', validJsonSchema),
        tool('valid_zod', z.object({ value: z.string() })),
        tool('malformed', {
          type: 'object',
          properties: { value: { type: 'not-a-json-schema-type' } },
        }),
        tool('unsupported', {
          $schema: 'https://json-schema.org/draft/2099-99/schema',
          type: 'object',
        }),
      ],
    });

    expect(context.toolDeclarations.map(({ id }) => id)).toEqual([
      'valid_json',
      'valid_zod',
    ]);
    expect(context.toolAvailabilityManifest.entries).toMatchObject([
      {
        id: 'malformed',
        state: 'unavailable',
        reason: 'declaration_refused',
      },
      {
        id: 'unsupported',
        state: 'unavailable',
        reason: 'declaration_refused',
      },
      { id: 'valid_json', state: 'available' },
      { id: 'valid_zod', state: 'available' },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('malformed');
    expect(warnings.join('\n')).toContain('unsupported');
  });
});
