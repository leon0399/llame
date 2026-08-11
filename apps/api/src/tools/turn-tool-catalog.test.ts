import { z } from 'zod';

import { type Tool } from './types';
import {
  composeTurnToolCatalog,
  hashToolDeclaration,
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

const mcpAvailable = (serverId: string, candidate: Tool) => ({
  source: { type: 'mcp' as const, serverId },
  state: 'available' as const,
  tool: candidate,
});

describe('composeTurnToolCatalog', () => {
  it('admits code-owned and MCP candidates through one source-neutral catalog', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set(['native_search', 'mcp__web__search']),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('native_search')),
        mcpAvailable('web', tool('mcp__web__search')),
      ],
    });

    expect(
      catalog.admitted.map(({ declaration, source }) => ({
        id: declaration.id,
        source,
      })),
    ).toEqual([
      { id: 'mcp__web__search', source: { type: 'mcp', serverId: 'web' } },
      { id: 'native_search', source: { type: 'code_owned' } },
    ]);
  });

  it('keeps unallowlisted MCP discoveries invisible', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set(['native_search']),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('native_search')),
        mcpAvailable('web', tool('mcp__web__private_inventory')),
      ],
    });

    expect(JSON.stringify(catalog)).not.toContain(
      'mcp__web__private_inventory',
    );
  });

  it('uses the exact allowlist plus read-only classification as the execution gate', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set([
        'mcp__web__allowlisted_read',
        'mcp__web__allowlisted_write',
      ]),
      callTimeoutSeconds: 15,
      candidates: [
        mcpAvailable('web', tool('mcp__web__allowlisted_read')),
        mcpAvailable(
          'web',
          tool('mcp__web__allowlisted_write', {
            classification: 'write_high_risk',
          }),
        ),
      ],
    });

    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'mcp__web__allowlisted_read',
    ]);
    expect(JSON.stringify(catalog)).not.toContain(
      'mcp__web__allowlisted_write',
    );
  });

  it('isolates an unavailable MCP source from healthy sibling sources', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set([
        'native_search',
        'mcp__docs__lookup',
        'mcp__web__search',
      ]),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('native_search')),
        mcpAvailable('docs', tool('mcp__docs__lookup')),
        {
          source: { type: 'mcp', serverId: 'web' },
          state: 'unavailable',
          id: 'mcp__web__search',
          classification: 'read_only',
          reason: 'source_disconnected',
        },
      ],
    });

    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'mcp__docs__lookup',
      'native_search',
    ]);
    expect(catalog.manifest.entries).toContainEqual({
      id: 'mcp__web__search',
      state: 'unavailable',
      reason: 'source_disconnected',
    });
  });

  it.each(TOOL_UNAVAILABLE_REASONS)(
    'preserves the closed MCP unavailable reason %s',
    async (reason) => {
      const catalog = await composeTurnToolCatalog({
        allowedToolIds: new Set(['mcp__web__search']),
        callTimeoutSeconds: 15,
        candidates: [
          {
            source: { type: 'mcp', serverId: 'web' },
            state: 'unavailable',
            id: 'mcp__web__search',
            classification: 'read_only',
            reason,
          },
        ],
      });

      expect(catalog.manifest.entries).toEqual([
        {
          id: 'mcp__web__search',
          state: 'unavailable',
          reason,
        },
      ]);
    },
  );

  it('refuses every ASCII-fold collision member across sources', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set(['MCP__WEB__SEARCH', 'mcp__web__search']),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('MCP__WEB__SEARCH')),
        mcpAvailable('web', tool('mcp__web__search')),
      ],
    });

    expect(catalog.admitted).toEqual([]);
    expect(catalog.manifest.entries).toEqual([
      {
        id: 'MCP__WEB__SEARCH',
        state: 'unavailable',
        reason: 'name_collision',
      },
      {
        id: 'mcp__web__search',
        state: 'unavailable',
        reason: 'name_collision',
      },
    ]);
  });

  it('uses the shared declaration hash domain', () => {
    expect(
      hashToolDeclaration({
        id: 'search',
        description: 'Search',
        inputSchema: { type: 'object', properties: {} },
      }),
    ).toBe('a0618502689968f0946fc1a61289dbda94016e838e64f9beb379d5296a3eaa59');
  });

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

  it('refuses every member of an ASCII-case-folded id collision', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set(['Search', 'search', 'safe']),
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('Search')),
        available(tool('search')),
        available(tool('safe')),
      ],
    });

    expect(catalog.manifest.entries).toEqual([
      { id: 'Search', state: 'unavailable', reason: 'name_collision' },
      {
        id: 'safe',
        state: 'available',
        declarationHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      },
      { id: 'search', state: 'unavailable', reason: 'name_collision' },
    ]);
    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'safe',
    ]);
  });

  it('does not publish an id outside the shared provider-safe grammar', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolIds: new Set(['search.docs']),
      callTimeoutSeconds: 15,
      candidates: [available(tool('search.docs'))],
    });

    expect(catalog).toEqual({
      admitted: [],
      manifest: { version: 1, entries: [] },
    });
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

  it.each([0, -1, 0.0001, Number.NaN, Number.POSITIVE_INFINITY, 15.001])(
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
