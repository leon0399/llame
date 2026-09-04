import { z } from 'zod';

import { type Tool } from './types';
import { conversationReadTool } from './conversation-read';
import {
  composeTurnToolCatalog,
  hasValidTrustedTimeout,
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
        // SAFETY: JSON.parse returns any; asserting unknown forces
        // parseToolAvailabilityManifest's own narrowing rather than silently
        // inheriting any.
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
  it('requires an exact allowlist entry for code-owned conversation_read', async () => {
    const wildcard = await composeTurnToolCatalog({
      allowedToolRules: ['conversation_*'],
      callTimeoutSeconds: 15,
      candidates: [available(conversationReadTool)],
    });
    const exact = await composeTurnToolCatalog({
      allowedToolRules: ['conversation_read'],
      callTimeoutSeconds: 15,
      candidates: [available(conversationReadTool)],
    });

    expect(wildcard.admitted).toEqual([]);
    expect(exact.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'conversation_read',
    ]);
  });

  it('filters a source inventory by a namespace wildcard and emits only exact ids', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['mcp__web__*'],
      callTimeoutSeconds: 15,
      candidates: [
        mcpAvailable('web', tool('mcp__web__search')),
        mcpAvailable('web', tool('mcp__web__private_inventory')),
        mcpAvailable('webExtra', tool('mcp__webExtra__search')),
      ],
    });

    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'mcp__web__private_inventory',
      'mcp__web__search',
    ]);
    expect(catalog.manifest.entries.map(({ id }) => id)).toEqual([
      'mcp__web__private_inventory',
      'mcp__web__search',
    ]);
    expect(JSON.stringify(catalog)).not.toContain('mcp__web__*');
    expect(JSON.stringify(catalog)).not.toContain('mcp__webExtra__search');
  });

  it('preserves distinct source candidates for existing collision refusal', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['mcp__web__*'],
      callTimeoutSeconds: 15,
      candidates: [
        mcpAvailable('web', tool('mcp__web__Search')),
        mcpAvailable('web', tool('mcp__web__search')),
      ],
    });

    expect(catalog.admitted).toEqual([]);
    expect(catalog.manifest.entries).toEqual([
      {
        id: 'mcp__web__Search',
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

  it('retains one inventory candidate when exact and namespace permissions overlap', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['mcp__web__search', 'mcp__web__*'],
      callTimeoutSeconds: 15,
      candidates: [mcpAvailable('web', tool('mcp__web__search'))],
    });

    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'mcp__web__search',
    ]);
    expect(catalog.manifest.entries).toHaveLength(1);
  });

  it('admits code-owned and MCP candidates through one source-neutral catalog', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['native_search', 'mcp__web__search'],
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
      allowedToolRules: ['native_search'],
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
      allowedToolRules: [
        'mcp__web__allowlisted_read',
        'mcp__web__allowlisted_write',
      ],
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
      allowedToolRules: [
        'native_search',
        'mcp__docs__lookup',
        'mcp__web__search',
      ],
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
        allowedToolRules: ['mcp__web__search'],
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
      allowedToolRules: ['MCP__WEB__SEARCH', 'mcp__web__search'],
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
      allowedToolRules: ['z_tool', 'a_tool', 'write_tool', 'protocol_tool'],
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

    expect(catalog.manifest.version).toBe(1);
    expect(
      catalog.manifest.entries.map((entry) =>
        entry.state === 'available'
          ? { id: entry.id, state: entry.state }
          : entry,
      ),
    ).toEqual([
      { id: 'a_tool', state: 'available' },
      {
        id: 'protocol_tool',
        state: 'unavailable',
        reason: 'protocol_unsupported',
      },
      { id: 'z_tool', state: 'available' },
    ]);
    const [aToolEntry, , zToolEntry] = catalog.manifest.entries;
    if (
      aToolEntry?.state !== 'available' ||
      zToolEntry?.state !== 'available'
    ) {
      throw new Error('Expected a_tool and z_tool available');
    }
    expect(aToolEntry.declarationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(zToolEntry.declarationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'a_tool',
      'z_tool',
    ]);
    expect(JSON.stringify(catalog)).not.toContain('not_allowlisted');
    expect(JSON.stringify(catalog)).not.toContain('write_tool');
  });

  it('keeps declaration-only drift available while changing its declaration hash', async () => {
    const first = await composeTurnToolCatalog({
      allowedToolRules: ['search'],
      callTimeoutSeconds: 15,
      candidates: [available(tool('search'))],
    });
    const changed = await composeTurnToolCatalog({
      allowedToolRules: ['search'],
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
      allowedToolRules: ['Search', 'search', 'safe'],
      callTimeoutSeconds: 15,
      candidates: [
        available(tool('Search')),
        available(tool('search')),
        available(tool('safe')),
      ],
    });

    expect(
      catalog.manifest.entries.map((entry) =>
        entry.state === 'available'
          ? { id: entry.id, state: entry.state }
          : entry,
      ),
    ).toEqual([
      { id: 'Search', state: 'unavailable', reason: 'name_collision' },
      { id: 'safe', state: 'available' },
      { id: 'search', state: 'unavailable', reason: 'name_collision' },
    ]);
    const [, safeEntry] = catalog.manifest.entries;
    if (safeEntry?.state !== 'available') {
      throw new Error('Expected safe available');
    }
    expect(safeEntry.declarationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(catalog.admitted.map(({ declaration }) => declaration.id)).toEqual([
      'safe',
    ]);
  });

  it('does not publish an id outside the shared provider-safe grammar', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['search.docs'],
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
      'knowledge_space_not_configured',
      'knowledge_space_unavailable',
    ]);
  });

  it.each([0, -1, 0.0001, Number.NaN, Number.POSITIVE_INFINITY, 15.001])(
    'refuses an invalid trusted timeout override of %s before advertisement',
    async (timeoutSeconds) => {
      const catalog = await composeTurnToolCatalog({
        allowedToolRules: ['search'],
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
        allowedToolRules: ['search'],
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

describe('hasValidTrustedTimeout', () => {
  it('refuses every tool when the operator call timeout cannot be represented', () => {
    for (const callTimeoutSeconds of [0, -1, 0.0005, 2_147_484, Number.NaN]) {
      expect(hasValidTrustedTimeout(undefined, callTimeoutSeconds)).toBe(false);
      expect(hasValidTrustedTimeout(5, callTimeoutSeconds)).toBe(false);
    }
  });

  it('accepts the largest representable timeout and refuses one millisecond more', () => {
    expect(hasValidTrustedTimeout(undefined, 2_147_483.647)).toBe(true);
    expect(hasValidTrustedTimeout(undefined, 2_147_483.648)).toBe(false);
    expect(hasValidTrustedTimeout(2_147_483.647, 2_147_483.647)).toBe(true);
  });

  it('accepts an absent per-tool override and refuses one above the operator cap', () => {
    expect(hasValidTrustedTimeout(undefined, 30)).toBe(true);
    expect(hasValidTrustedTimeout(30, 30)).toBe(true);
    expect(hasValidTrustedTimeout(31, 30)).toBe(false);
    expect(hasValidTrustedTimeout(0, 30)).toBe(false);
    expect(hasValidTrustedTimeout(0.0005, 30)).toBe(false);
  });
});

describe('parseToolAvailabilityManifest failures', () => {
  it('names a non-object manifest', () => {
    for (const value of [null, undefined, 'v1', 7, []]) {
      expect(() => parseToolAvailabilityManifest(value)).toThrow(
        'Invalid tool availability manifest: expected an object.',
      );
    }
  });

  it('names the exact-shape requirement for an unrecognised version', () => {
    expect(() =>
      parseToolAvailabilityManifest({ version: 2, entries: [] }),
    ).toThrow(
      'Invalid tool availability manifest: expected exact version 0 or version 1 shape.',
    );
    expect(() =>
      parseToolAvailabilityManifest({ version: 1, entries: [], extra: 1 }),
    ).toThrow(
      'Invalid tool availability manifest: expected exact version 0 or version 1 shape.',
    );
    expect(() => parseToolAvailabilityManifest({ version: 1 })).toThrow(
      'Invalid tool availability manifest: expected exact version 0 or version 1 shape.',
    );
  });

  it('names the unobserved-sentinel requirement for version 0', () => {
    expect(() =>
      parseToolAvailabilityManifest({ version: 0, state: 'observed' }),
    ).toThrow(
      'Invalid tool availability manifest: version 0 must be the exact unobserved sentinel.',
    );
  });

  it('names a version 1 entries field that is not an array', () => {
    expect(() =>
      parseToolAvailabilityManifest({ version: 1, entries: {} }),
    ).toThrow(
      'Invalid tool availability manifest: version 1 entries must be an array.',
    );
  });

  it('names a non-record entry and an entry without a usable id', () => {
    for (const entry of ['tool', 7, null]) {
      expect(() =>
        parseToolAvailabilityManifest({ version: 1, entries: [entry] }),
      ).toThrow(
        'Invalid tool availability manifest: entry must contain a string id.',
      );
    }
    expect(() =>
      parseToolAvailabilityManifest({
        version: 1,
        entries: [{ state: 'unavailable', reason: 'tool_missing' }],
      }),
    ).toThrow(
      'Invalid tool availability manifest: entry must contain a string id.',
    );
    expect(() =>
      parseToolAvailabilityManifest({
        version: 1,
        entries: [{ id: '', state: 'unavailable', reason: 'tool_missing' }],
      }),
    ).toThrow(
      'Invalid tool availability manifest: entry must contain a string id.',
    );
  });

  it('requires strictly ascending entry ids, rejecting both duplicates and descending order', () => {
    const entry = (id: string) => ({
      id,
      state: 'unavailable' as const,
      reason: 'tool_missing' as const,
    });

    expect(
      parseToolAvailabilityManifest({
        version: 1,
        entries: [entry('alpha'), entry('beta')],
      }),
    ).toEqual({ version: 1, entries: [entry('alpha'), entry('beta')] });

    expect(() =>
      parseToolAvailabilityManifest({
        version: 1,
        entries: [entry('beta'), entry('alpha')],
      }),
    ).toThrow(
      'Invalid tool availability manifest: entry ids must be non-empty, unique, and sorted.',
    );
    expect(() =>
      parseToolAvailabilityManifest({
        version: 1,
        entries: [entry('alpha'), entry('alpha')],
      }),
    ).toThrow(
      'Invalid tool availability manifest: entry ids must be non-empty, unique, and sorted.',
    );
  });

  it('names an entry whose state payload does not match either closed shape', () => {
    const hash = 'a'.repeat(64);
    expect(
      parseToolAvailabilityManifest({
        version: 1,
        entries: [{ id: 'alpha', state: 'available', declarationHash: hash }],
      }),
    ).toEqual({
      version: 1,
      entries: [{ id: 'alpha', state: 'available', declarationHash: hash }],
    });

    for (const entry of [
      { id: 'alpha', state: 'available' },
      { id: 'alpha', state: 'available', declarationHash: hash, extra: 1 },
      { id: 'alpha', state: 'available', declarationHash: `${hash}0` },
      { id: 'alpha', state: 'available', declarationHash: hash.slice(1) },
      { id: 'alpha', state: 'available', declarationHash: `A${hash.slice(1)}` },
      { id: 'alpha', state: 'available', declarationHash: hash, reason: 'x' },
      { id: 'alpha', state: 'unavailable' },
      { id: 'alpha', state: 'unavailable', reason: 'no_such_reason' },
      { id: 'alpha', state: 'unavailable', reason: 7 },
      { id: 'alpha', state: 'unavailable', reason: 'tool_missing', extra: 1 },
      { id: 'alpha', state: 'pending', reason: 'tool_missing' },
    ]) {
      expect(() =>
        parseToolAvailabilityManifest({ version: 1, entries: [entry] }),
      ).toThrow(
        'Invalid tool availability manifest: entry has an invalid state payload.',
      );
    }
  });

  it('accepts every declared unavailable reason and no others', () => {
    for (const reason of TOOL_UNAVAILABLE_REASONS) {
      expect(
        parseToolAvailabilityManifest({
          version: 1,
          entries: [{ id: 'alpha', state: 'unavailable', reason }],
        }),
      ).toEqual({
        version: 1,
        entries: [{ id: 'alpha', state: 'unavailable', reason }],
      });
    }
  });
});

describe('composeTurnToolCatalog ordering', () => {
  it('returns admitted tools and manifest entries in code-point order regardless of input order', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['zulu_tool', 'alpha_tool', 'mike_tool', 'bravo_tool'],
      callTimeoutSeconds: 30,
      candidates: [
        available(tool('zulu_tool')),
        available(tool('mike_tool')),
        available(tool('alpha_tool')),
        available(tool('bravo_tool')),
      ],
    });

    expect(catalog.admitted.map((entry) => entry.declaration.id)).toEqual([
      'alpha_tool',
      'bravo_tool',
      'mike_tool',
      'zulu_tool',
    ]);
    expect(catalog.manifest.entries.map((entry) => entry.id)).toEqual([
      'alpha_tool',
      'bravo_tool',
      'mike_tool',
      'zulu_tool',
    ]);
    expect(
      catalog.manifest.entries.every((entry) => entry.state === 'available'),
    ).toBe(true);
  });

  it('refuses a tool whose own timeout exceeds the operator call timeout', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['slow_tool'],
      callTimeoutSeconds: 30,
      candidates: [available(tool('slow_tool', { timeoutSeconds: 31 }))],
    });

    expect(catalog.admitted).toEqual([]);
    expect(catalog.manifest.entries).toEqual([
      { id: 'slow_tool', state: 'unavailable', reason: 'declaration_refused' },
    ]);
  });

  it('refuses every tool when the operator call timeout is itself unusable', async () => {
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['ok_tool'],
      callTimeoutSeconds: 0,
      candidates: [available(tool('ok_tool'))],
    });

    expect(catalog.admitted).toEqual([]);
    expect(catalog.manifest.entries).toEqual([
      { id: 'ok_tool', state: 'unavailable', reason: 'declaration_refused' },
    ]);
  });
});

describe('composeTurnToolCatalog identity ordering', () => {
  it('orders admitted tools by their published id, not by the folded grouping key', async () => {
    // 'Zebra_tool' folds after 'apple_tool' but sorts before it by code point,
    // so the two orders disagree and only the published one is correct.
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['Zebra_tool', 'apple_tool'],
      callTimeoutSeconds: 30,
      candidates: [
        available(tool('apple_tool')),
        available(tool('Zebra_tool')),
      ],
    });

    expect(catalog.admitted.map((entry) => entry.declaration.id)).toEqual([
      'Zebra_tool',
      'apple_tool',
    ]);
    expect(catalog.manifest.entries.map((entry) => entry.id)).toEqual([
      'Zebra_tool',
      'apple_tool',
    ]);
  });
});

describe('parseToolAvailabilityManifest key exactness', () => {
  it('rejects a v1 manifest whose second key merely resembles entries', () => {
    expect(() =>
      parseToolAvailabilityManifest({ version: 1, entriez: [] }),
    ).toThrow(
      'Invalid tool availability manifest: expected exact version 0 or version 1 shape.',
    );
  });

  it('rejects a v0 sentinel whose second key merely resembles state', () => {
    expect(() =>
      parseToolAvailabilityManifest({ version: 0, statement: 'unobserved' }),
    ).toThrow(
      'Invalid tool availability manifest: version 0 must be the exact unobserved sentinel.',
    );
  });
});
