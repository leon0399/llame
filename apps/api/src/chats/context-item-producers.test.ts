import {
  deriveToolAvailabilityPayload,
  isToolAvailabilityPayload,
  RECOVERY_REASON_BY_UNAVAILABLE_REASON,
  TOOL_RECOVERY_REASON_LABELS,
  TOOL_RECOVERY_REASONS,
} from './context-item-producers';
import {
  type ToolAvailabilityManifestV1,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';

const unavailable = (
  reason: ToolUnavailableReason,
): ToolAvailabilityManifestV1 => ({
  version: 1,
  entries: [
    {
      id: 'knowledge_search',
      state: 'unavailable',
      reason,
    },
  ],
});

const available: ToolAvailabilityManifestV1 = {
  version: 1,
  entries: [
    {
      id: 'knowledge_search',
      state: 'available',
      declarationHash: 'a'.repeat(64),
    },
  ],
};

describe('Knowledge tool availability metadata', () => {
  it('accepts current and legacy Knowledge reasons in an initial payload', () => {
    for (const reason of [
      'knowledge_space_not_configured',
      'knowledge_space_unavailable',
    ] as const) {
      const payload = deriveToolAvailabilityPayload({
        current: unavailable(reason),
      });

      expect(payload).not.toBeNull();
      expect(isToolAvailabilityPayload(payload)).toBe(true);
      expect(payload?.unavailable).toEqual([
        { id: 'knowledge_search', reason },
      ]);
    }
  });

  it('maps Knowledge recovery transitions to distinct honest reasons', () => {
    expect(TOOL_RECOVERY_REASONS).toContain('knowledge_space_configured');
    expect(TOOL_RECOVERY_REASONS).toContain('knowledge_space_restored');
    expect(
      RECOVERY_REASON_BY_UNAVAILABLE_REASON.knowledge_space_not_configured,
    ).toBe('knowledge_space_configured');
    expect(
      RECOVERY_REASON_BY_UNAVAILABLE_REASON.knowledge_space_unavailable,
    ).toBe('knowledge_space_restored');
    expect(TOOL_RECOVERY_REASON_LABELS.knowledge_space_configured).toMatch(
      /configured/iu,
    );
    expect(TOOL_RECOVERY_REASON_LABELS.knowledge_space_restored).toMatch(
      /restored/iu,
    );

    expect(
      deriveToolAvailabilityPayload({
        previous: unavailable('knowledge_space_not_configured'),
        current: available,
      })?.nowAvailable,
    ).toEqual([
      { id: 'knowledge_search', reason: 'knowledge_space_configured' },
    ]);
    expect(
      deriveToolAvailabilityPayload({
        previous: unavailable('knowledge_space_unavailable'),
        current: available,
      })?.nowAvailable,
    ).toEqual([{ id: 'knowledge_search', reason: 'knowledge_space_restored' }]);
  });
});
