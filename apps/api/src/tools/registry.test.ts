import { searchConversationsTool } from './search-conversations';
import {
  knowledgeReadTool,
  knowledgeSearchTool,
} from '../knowledge/knowledge-tools';
import {
  buildRegistry,
  resolveAdvertisedTools,
  TOOL_REGISTRY,
} from './registry';
import { matchesAllowedToolId } from '@workspace/harness';
import { type Tool } from './types';

describe('tool registry', () => {
  it('registers all code-owned read-only tools', () => {
    expect(TOOL_REGISTRY.get('search_conversations')).toBe(
      searchConversationsTool,
    );
    expect(TOOL_REGISTRY.get('knowledge_search')).toBe(knowledgeSearchTool);
    expect(TOOL_REGISTRY.get('knowledge_read')).toBe(knowledgeReadTool);
    expect(searchConversationsTool.classification).toBe('read_only');
    expect(knowledgeSearchTool.classification).toBe('read_only');
    expect(knowledgeReadTool.classification).toBe('read_only');
  });

  it('keeps the static registry immutable while allowlisting Knowledge ids', () => {
    expect(
      resolveAdvertisedTools(new Set(['knowledge_search', 'knowledge_read'])),
    ).toEqual([knowledgeSearchTool, knowledgeReadTool]);
    expect(TOOL_REGISTRY.get('knowledge_search')).toBe(knowledgeSearchTool);
    expect(TOOL_REGISTRY.get('knowledge_read')).toBe(knowledgeReadTool);
  });
});

describe('registry startup validation (fail loud, not at call time)', () => {
  // Tests the REAL buildRegistry (exported from registry.ts), not a hand
  // copy — a future edit to the real function's error message/order is
  // caught here, not silently drifted from.
  it('rejects an unclassified tool at startup', () => {
    const unclassified = {
      ...searchConversationsTool,
      id: 'no_classification',
      classification: undefined,
    };
    expect(() => buildRegistry([unclassified])).toThrow(/no classification/);
  });

  it.each([null, '', 'not_a_classification'])(
    'rejects invalid classification %j at startup',
    (classification) => {
      const invalid = {
        ...searchConversationsTool,
        id: 'invalid_classification',
        classification,
      };

      expect(() => buildRegistry([invalid])).toThrow(/classification/);
    },
  );

  it('rejects a duplicate tool id at startup, naming it', () => {
    const dup = { ...searchConversationsTool };
    expect(() => buildRegistry([searchConversationsTool, dup])).toThrow(
      /duplicate id "search_conversations"/,
    );
  });

  it('rejects an id outside the shared provider-safe grammar', () => {
    const invalid = { ...searchConversationsTool, id: 'search.docs' };
    expect(() => buildRegistry([invalid])).toThrow(/invalid id/);
  });

  it('rejects code-owned ids in the reserved MCP namespace', () => {
    const reserved = {
      ...searchConversationsTool,
      id: 'mcp__web__search',
    };
    expect(() => buildRegistry([reserved])).toThrow(/reserved.*mcp__/i);
  });
});

describe('resolveAdvertisedTools (fail-closed gate: allowlisted ∩ read_only)', () => {
  it('default (empty allowlist) advertises nothing', () => {
    expect(resolveAdvertisedTools(new Set())).toEqual([]);
  });

  it('advertises an allowlisted read_only tool', () => {
    const available = resolveAdvertisedTools(new Set(['search_conversations']));
    expect(available.map((t) => t.id)).toEqual(['search_conversations']);
  });

  it('does not advertise a non-read_only tool even if allowlisted', () => {
    const writeTool: Tool = {
      ...searchConversationsTool,
      id: 'write_something',
      classification: 'write_low_risk',
    };
    expect(
      resolveAdvertisedTools(new Set(['write_something']), [writeTool]),
    ).toEqual([]);
  });

  it('does not advertise a registered tool absent from the allowlist', () => {
    expect(resolveAdvertisedTools(new Set(['something_else']))).toEqual([]);
  });

  it('matches a namespace wildcard by exact, case-sensitive id prefix without crossing server boundaries', () => {
    const webTool = {
      ...searchConversationsTool,
      id: 'mcp__web__search',
    };
    const webExtraTool = {
      ...searchConversationsTool,
      id: 'mcp__webExtra__search',
    };

    expect(
      resolveAdvertisedTools(new Set(['mcp__web__*']), [
        webTool,
        webExtraTool,
      ]).map((tool) => tool.id),
    ).toEqual(['mcp__web__search']);
  });

  it('retains a candidate once when exact and namespace permissions overlap', () => {
    const tool = { ...searchConversationsTool, id: 'mcp__web__search' };
    expect(
      resolveAdvertisedTools(new Set(['mcp__web__*', tool.id]), [tool]),
    ).toEqual([tool]);
  });

  it('matches the raw allowlist array without parsing candidate ids or folding case', () => {
    expect(matchesAllowedToolId('mcp__web__search', ['mcp__web__*'])).toBe(
      true,
    );
    expect(matchesAllowedToolId('mcp__webExtra__search', ['mcp__web__*'])).toBe(
      false,
    );
    expect(matchesAllowedToolId('mcp__Web__search', ['mcp__web__*'])).toBe(
      false,
    );
    expect(
      matchesAllowedToolId('search_conversations', ['search_conversations']),
    ).toBe(true);
  });
});
