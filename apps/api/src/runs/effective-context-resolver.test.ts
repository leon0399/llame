import { createHash } from 'node:crypto';

import { z } from 'zod';

import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type Tool } from '../tools/types';
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
    systemPrompt: 'Use the configured prompt.\n',
    systemPromptSource: 'model_override',
    ...overrides,
  }) satisfies SystemModelCatalogEntry;

const tool = (
  id: string,
  inputSchema: z.ZodTypeAny,
  overrides?: Partial<Tool>,
): Tool => ({
  id,
  description: `Description for ${id}`,
  classification: 'read_only',
  inputSchema,
  execute: () => ({ status: 'success' }),
  ...overrides,
});

describe('effective context resolver', () => {
  it('intersects the allowlist with trusted read-only tools and canonicalizes provider-facing schemas', async () => {
    const context = await resolveEffectiveContext({
      model: model(),
      allowedToolIds: new Set(['z_tool', 'a_tool', 'write_tool']),
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
    expect(
      Object.keys(
        (
          context.toolDeclarations[0].inputSchema as {
            properties: { nested: { properties: object } };
          }
        ).properties.nested.properties,
      ),
    ).toEqual(['a', 'z']);
    expect(Object.keys(context).sort()).toEqual([
      'contentHash',
      'promptHash',
      'source',
      'systemPrompt',
      'toolDeclarations',
      'toolHash',
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

  it('orders keys and tool ids by Unicode code point rather than UTF-16 code unit', async () => {
    const bmp = '\uE000';
    const astral = '\u{10000}';

    // UTF-16 would put the astral key first because its high surrogate D800
    // sorts before E000. Unicode scalar order correctly puts E000 first.
    expect(canonicalJson({ [astral]: 'astral', [bmp]: 'bmp' })).toBe(
      `{"${bmp}":"bmp","${astral}":"astral"}`,
    );

    const context = await resolveEffectiveContext({
      model: model(),
      allowedToolIds: new Set([bmp, astral]),
      candidates: [
        tool(astral, z.object({ value: z.string() })),
        tool(bmp, z.object({ value: z.string() })),
      ],
    });
    expect(context.toolDeclarations.map(({ id }) => id)).toEqual([bmp, astral]);
  });

  it('produces stable domain-separated prompt, tool, and combined hashes', async () => {
    const first = await resolveEffectiveContext({
      model: model(),
      allowedToolIds: new Set(['tool']),
      candidates: [tool('tool', z.object({ z: z.string(), a: z.number() }))],
    });
    const repeated = await resolveEffectiveContext({
      model: model(),
      allowedToolIds: new Set(['tool']),
      candidates: [tool('tool', z.object({ z: z.string(), a: z.number() }))],
    });

    expect(repeated).toEqual(first);
    expect(first.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.toolHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      new Set([first.promptHash, first.toolHash, first.contentHash]).size,
    ).toBe(3);
    expect(first.promptHash).not.toBe(
      createHash('sha256').update(first.systemPrompt, 'utf8').digest('hex'),
    );
  });

  it('changes only the relevant component hash and always changes the content hash', async () => {
    const baseInput = {
      allowedToolIds: new Set(['tool']),
      candidates: [tool('tool', z.object({ value: z.string() }))],
    };
    const base = await resolveEffectiveContext({
      model: model(),
      ...baseInput,
    });
    const promptChanged = await resolveEffectiveContext({
      model: model({ systemPrompt: 'A later prompt.\n' }),
      ...baseInput,
    });
    const toolChanged = await resolveEffectiveContext({
      model: model(),
      allowedToolIds: baseInput.allowedToolIds,
      candidates: [
        tool('tool', z.object({ value: z.string() }), {
          description: 'A later declaration',
        }),
      ],
    });

    expect(promptChanged.promptHash).not.toBe(base.promptHash);
    expect(promptChanged.toolHash).toBe(base.toolHash);
    expect(promptChanged.contentHash).not.toBe(base.contentHash);
    expect(toolChanged.promptHash).toBe(base.promptHash);
    expect(toolChanged.toolHash).not.toBe(base.toolHash);
    expect(toolChanged.contentHash).not.toBe(base.contentHash);
  });
});
