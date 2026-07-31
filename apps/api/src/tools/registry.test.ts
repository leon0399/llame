import { searchConversationsTool } from './search-conversations';
import {
  buildRegistry,
  resolveAdvertisedTools,
  TOOL_REGISTRY,
} from './registry';
import { type Tool } from './types';

describe('tool registry', () => {
  it('registers search_conversations, classified read_only', () => {
    expect(TOOL_REGISTRY.get('search_conversations')).toBe(
      searchConversationsTool,
    );
    expect(searchConversationsTool.classification).toBe('read_only');
  });

  it('ships exactly one tool this slice (D7: no external-network tool)', () => {
    // Pins the slice's scope: the registry contains only the one internal,
    // read-only, own-data tool — no fetch_url/web-search style tool exists
    // to reach the external network (D7's exfiltration-channel concern).
    expect(TOOL_REGISTRY.size).toBe(1);
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
    } as unknown as Tool;
    expect(() => buildRegistry([unclassified])).toThrow(/no classification/);
  });

  it('rejects a duplicate tool id at startup, naming it', () => {
    const dup = { ...searchConversationsTool };
    expect(() => buildRegistry([searchConversationsTool, dup])).toThrow(
      /duplicate id "search_conversations"/,
    );
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
});
