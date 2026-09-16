import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { afterEach, vi } from 'vitest';

import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type Tool } from '../tools/types';
import { isRecord } from '@workspace/runtime-safety';
import {
  canonicalJson,
  composeAttemptToolCatalog,
  finalizeEffectiveContext,
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
    const catalog = await composeAttemptToolCatalog({
      callTimeoutSeconds: 15,
      allowedToolRules: ['z_tool', 'a_tool', 'write_tool'],
      candidates: [
        tool(
          'z_tool',
          z.strictObject({ zebra: z.string(), alpha: z.number() }),
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

    expect(catalog.declarations.map(({ id }) => id)).toEqual([
      'a_tool',
      'z_tool',
    ]);
    expect(Object.keys(catalog.declarations[0].inputSchema)).toEqual(
      Object.keys(catalog.declarations[0].inputSchema).sort(),
    );
    const properties = catalog.declarations[0].inputSchema.properties;
    if (!isRecord(properties) || !isRecord(properties.nested)) {
      throw new Error('Expected nested JSON Schema properties');
    }
    const nestedProperties = properties.nested.properties;
    if (!isRecord(nestedProperties)) {
      throw new Error('Expected nested JSON Schema properties object');
    }
    expect(Object.keys(nestedProperties)).toEqual(['a', 'z']);
    expect(catalog.admittedIds).toEqual(['a_tool', 'z_tool']);
  });

  it('records observed availability for admitted declarations without persistence fields', async () => {
    const catalog = await composeAttemptToolCatalog({
      callTimeoutSeconds: 15,
      allowedToolRules: ['z_tool', 'a_tool'],
      candidates: [
        tool('z_tool', z.object({ value: z.string() })),
        tool('a_tool', z.object({ value: z.string() })),
      ],
    });

    expect(catalog.availabilityManifest).toMatchObject({
      version: 1,
      entries: [
        { id: 'a_tool', state: 'available' },
        { id: 'z_tool', state: 'available' },
      ],
    });
    expect(catalog.availabilityManifest.entries).toHaveLength(2);
    expect(catalog.availabilityManifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a_tool', state: 'available' }),
        expect.objectContaining({ id: 'z_tool', state: 'available' }),
      ]),
    );
  });

  it('keeps unavailable owner-bound candidates in the attempt catalog', async () => {
    const catalog = await composeAttemptToolCatalog({
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

    expect(catalog.declarations).toEqual([]);
    expect(catalog.availabilityManifest).toEqual({
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
    const catalog = await composeAttemptToolCatalog({
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

    expect(catalog.declarations.map(({ id }) => id)).toEqual([
      'mcp__web__search',
    ]);
    expect(catalog.availabilityManifest.entries.map(({ id }) => id)).toEqual([
      'mcp__web__search',
    ]);
    expect(catalog.admittedIds).not.toContain('mcp__web__*');
  });

  it('returns a system-only receipt input and a domain-separated prompt hash', async () => {
    const prompt = model().systemPromptTemplate;
    const receipt = await resolveEffectiveContext({
      systemPrompt: prompt,
      model: model(),
      callTimeoutSeconds: 15,
      allowedToolRules: ['tool'],
      candidates: [tool('tool', z.object({ value: z.string() }))],
    });

    expect(Object.keys(receipt).sort()).toEqual([
      'promptHash',
      'source',
      'systemPrompt',
    ]);
    expect(receipt.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.source).toBe('model_override');
    expect(receipt.systemPrompt).toBe(prompt);

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

  it('finalizes the receipt from an already-admitted catalog without copying it', async () => {
    const catalog = await composeAttemptToolCatalog({
      callTimeoutSeconds: 15,
      allowedToolRules: ['tool'],
      candidates: [tool('tool', z.object({ value: z.string() }))],
    });
    const receipt = finalizeEffectiveContext({
      model: model(),
      systemPrompt: 'A later prompt.\n',
      catalog,
    });

    expect(receipt).toMatchObject({
      source: 'model_override',
      systemPrompt: 'A later prompt.\n',
    });
    expect(receipt.promptHash).toMatch(/^[0-9a-f]{64}$/);
    // The admitted catalog stays in attempt memory: the persisted receipt is
    // the prompt and its provenance, never a copy of the declarations.
    expect(Object.keys(receipt).sort()).toEqual([
      'promptHash',
      'source',
      'systemPrompt',
    ]);
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
    const catalog = await composeAttemptToolCatalog({
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

    expect(catalog.declarations.map(({ id }) => id)).toEqual([
      'valid_json',
      'valid_zod',
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('malformed');
    expect(warnings.join('\n')).toContain('unsupported');
  });
});
