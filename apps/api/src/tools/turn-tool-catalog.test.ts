import { z } from 'zod';

import { type Tool } from './types';
import {
  composeTurnToolCatalog,
  hashToolAvailabilityManifest,
  parseToolAvailabilityManifest,
  TOOL_AVAILABILITY_UNOBSERVED,
  TOOL_UNAVAILABLE_REASONS,
} from './turn-tool-catalog';

const tool = (id: string, overrides?: Partial<Tool>): Tool => ({
  id,
  description: `Description for ${id}`,
  classification: 'read_only',
  inputSchema: z.object({ value: z.string() }).strict(),
  execute: () => ({ status: 'success' }),
  ...overrides,
});

describe('tool availability manifest versions', () => {
  it('parses only the exact canonical v0 unobserved sentinel', () => {
    expect(
      parseToolAvailabilityManifest(
        JSON.parse('{"version":0,"state":"unobserved"}') as unknown,
      ),
    ).toEqual(TOOL_AVAILABILITY_UNOBSERVED);

    expect(() =>
      parseToolAvailabilityManifest({
        version: 0,
        state: 'unobserved',
        entries: [],
      }),
    ).toThrow(/version 0/i);
    expect(() =>
      parseToolAvailabilityManifest({ version: 0, state: 'observed' }),
    ).toThrow(/version 0/i);
  });

  it('distinguishes an observed empty v1 catalog and rejects hybrid or malformed versions', () => {
    expect(parseToolAvailabilityManifest({ version: 1, entries: [] })).toEqual({
      version: 1,
      entries: [],
    });

    for (const malformed of [
      { version: 1 },
      { version: 1, state: 'unobserved', entries: [] },
      { version: 2, entries: [] },
      { version: '1', entries: [] },
      { entries: [] },
    ]) {
      expect(() => parseToolAvailabilityManifest(malformed)).toThrow(
        /availability manifest/i,
      );
    }
  });

  it('hashes availability in its own domain', () => {
    const legacyHash = hashToolAvailabilityManifest(
      TOOL_AVAILABILITY_UNOBSERVED,
    );
    const observedEmptyHash = hashToolAvailabilityManifest({
      version: 1,
      entries: [],
    });

    expect(legacyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(observedEmptyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(observedEmptyHash).not.toBe(legacyHash);
  });
});

const available = (candidate: Tool) => ({
  source: { type: 'code_owned' as const },
  state: 'available' as const,
  tool: candidate,
});

describe('composeTurnToolCatalog', () => {
  it('builds a versioned, canonically sorted manifest without exposing ineligible tools', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set([
        'z_tool',
        'a_tool',
        'write_tool',
        'protocol_tool',
      ]),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('z_tool')),
        available(tool('not_allowlisted')),
        available(tool('write_tool', { classification: 'write_low_risk' })),
        {
          source: { type: 'code_owned' },
          state: 'unavailable',
          id: 'protocol_tool',
          classification: 'read_only',
          reason: 'protocol_unsupported',
        },
        available(tool('a_tool')),
      ],
    });

    expect(catalog.manifest).toEqual({
      version: 1,
      entries: [
        {
          id: 'a_tool',
          state: 'available',
          declarationHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        },
        {
          id: 'protocol_tool',
          state: 'unavailable',
          reason: 'protocol_unsupported',
        },
        {
          id: 'z_tool',
          state: 'available',
          declarationHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        },
      ],
    });
    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'a_tool',
      'z_tool',
    ]);
    expect(JSON.stringify(catalog)).not.toContain('not_allowlisted');
    expect(JSON.stringify(catalog)).not.toContain('write_tool');
  });

  it('keeps declaration-only drift available while changing its declaration hash', async () => {
    const first = await composeTurnToolCatalog({
      allowedToolIds: new Set(['search']),
      callTimeoutSeconds: 15,
      candidates: [available(tool('search'))],
    });
    const changed = await composeTurnToolCatalog({
      allowedToolIds: new Set(['search']),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('search', { description: 'Changed declaration' })),
      ],
    });

    expect(first.manifest.entries[0]).toMatchObject({
      id: 'search',
      state: 'available',
    });
    expect(changed.manifest.entries[0]).toMatchObject({
      id: 'search',
      state: 'available',
    });
    expect(changed.manifest.entries[0]).not.toEqual(first.manifest.entries[0]);
  });

  it('uses the complete closed unavailable-reason vocabulary', () => {
    expect(TOOL_UNAVAILABLE_REASONS).toEqual([
      'source_connecting',
      'source_disconnected',
      'protocol_unsupported',
      'discovery_failed',
      'tool_missing',
      'declaration_refused',
      'name_collision',
    ]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 15.001])(
    'refuses an invalid trusted timeout override of %s before advertisement',
    async (timeoutSeconds) => {
      const catalog = await composeTurnToolCatalog({
        allowedToolIds: new Set(['search']),
        callTimeoutSeconds: 15,
        candidates: [available(tool('search', { timeoutSeconds }))],
      });

      expect(catalog.admitted).toEqual([]);
      expect(catalog.manifest).toEqual({
        version: 1,
        entries: [
          {
            id: 'search',
            state: 'unavailable',
            reason: 'declaration_refused',
          },
        ],
      });
    },
  );

  it.each([0.001, 15])(
    'accepts a finite positive trusted timeout override of %s within the global cap',
    async (timeoutSeconds) => {
      const catalog = await composeTurnToolCatalog({
        allowedToolIds: new Set(['search']),
        callTimeoutSeconds: 15,
        candidates: [available(tool('search', { timeoutSeconds }))],
      });

      expect(catalog.admitted).toHaveLength(1);
      expect(catalog.manifest.entries[0]).toMatchObject({
        id: 'search',
        state: 'available',
      });
    },
  );
});
