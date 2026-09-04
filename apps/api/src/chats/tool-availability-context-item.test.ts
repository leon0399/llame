import { describe, expect, it } from 'vitest';

import {
  createToolAvailabilityItem,
  deriveToolAvailabilityPayload,
  isToolAvailabilityPayload,
  type ToolAvailabilityPayload,
} from './tool-availability-context-item';
import {
  TOOL_AVAILABILITY_UNOBSERVED,
  type ToolAvailabilityEntry,
  type ToolAvailabilityManifestV1,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

const available = (id: string, declarationHash = 'a'.repeat(64)) => ({
  id,
  state: 'available' as const,
  declarationHash,
});

const unavailable = (id: string, reason: ToolUnavailableReason) => ({
  id,
  state: 'unavailable' as const,
  reason,
});

const manifest = (
  entries: Array<ToolAvailabilityEntry>,
): ToolAvailabilityManifestV1 => ({
  version: 1,
  entries: [...entries].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  ),
});

const payload = (
  overrides: Partial<ToolAvailabilityPayload> = {},
): ToolAvailabilityPayload => ({
  kind: 'delta',
  added: [],
  removed: [],
  unavailable: [],
  becameUnavailable: [],
  nowAvailable: [],
  ...overrides,
});

describe('isToolAvailabilityPayload', () => {
  it('accepts sorted identifiers and every transition vocabulary', () => {
    expect(
      isToolAvailabilityPayload(
        payload({
          added: ['added_tool'],
          removed: ['removed_tool'],
          unavailable: [{ id: 'down_tool', reason: 'source_disconnected' }],
          becameUnavailable: [
            { id: 'changed_tool', reason: 'declaration_refused' },
          ],
          nowAvailable: [
            { id: 'restored_tool', reason: 'declaration_accepted' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['a primitive', null],
    ['an extra top-level key', { ...payload(), extra: true }],
    ['a missing top-level key', { ...payload(), removed: undefined }],
    ['an invalid kind', { ...payload(), kind: 'epoch', added: ['tool'] }],
    ['a non-array identifier field', { ...payload(), added: 'tool' }],
    ['an invalid identifier', { ...payload(), added: ['not valid'] }],
    ['unsorted identifiers', { ...payload(), added: ['z_tool', 'a_tool'] }],
    ['duplicate identifiers', { ...payload(), added: ['same', 'same'] }],
    [
      'an entry with extra keys',
      {
        ...payload(),
        unavailable: [{ id: 'tool', reason: 'tool_missing', extra: true }],
      },
    ],
    [
      'an entry with an invalid reason',
      {
        ...payload(),
        unavailable: [{ id: 'tool', reason: 'unknown' }],
      },
    ],
    [
      'unsorted reason entries',
      {
        ...payload(),
        unavailable: [
          { id: 'z_tool', reason: 'tool_missing' },
          { id: 'a_tool', reason: 'tool_missing' },
        ],
      },
    ],
    [
      'duplicate identifiers across buckets',
      {
        ...payload(),
        added: ['same_tool'],
        nowAvailable: [{ id: 'same_tool', reason: 'tool_restored' }],
      },
    ],
    [
      'an initial payload with a delta field',
      {
        ...payload({ kind: 'initial' }),
        removed: ['removed_tool'],
      },
    ],
    ['an empty payload', payload()],
  ] as const)('rejects %s', (_description, value) => {
    expect(isToolAvailabilityPayload(value)).toBe(false);
  });
});

describe('deriveToolAvailabilityPayload', () => {
  it('emits an initial payload only when current tools are unavailable', () => {
    expect(
      deriveToolAvailabilityPayload({
        current: manifest([available('available_tool')]),
      }),
    ).toBeNull();
    expect(
      deriveToolAvailabilityPayload({
        current: manifest([
          available('available_tool'),
          unavailable('down_tool', 'source_connecting'),
        ]),
      }),
    ).toEqual({
      kind: 'initial',
      added: [],
      removed: [],
      unavailable: [{ id: 'down_tool', reason: 'source_connecting' }],
      becameUnavailable: [],
      nowAvailable: [],
    });
  });

  it('treats the unobserved v0 sentinel as a fresh disclosure epoch', () => {
    expect(
      deriveToolAvailabilityPayload({
        previous: TOOL_AVAILABILITY_UNOBSERVED,
        current: manifest([unavailable('down_tool', 'tool_missing')]),
      }),
    ).toMatchObject({ kind: 'initial', unavailable: [{ id: 'down_tool' }] });
  });

  it('classifies additions, removals, outages, recoveries, and unchanged ids', () => {
    const previous = manifest([
      available('changed_tool'),
      unavailable('down_tool', 'source_disconnected'),
      available('gone_tool'),
      available('same_tool', 'b'.repeat(64)),
      unavailable('stays_down', 'tool_missing'),
    ]);
    const current = manifest([
      unavailable('changed_tool', 'declaration_refused'),
      available('down_tool'),
      available('new_tool'),
      available('same_tool', 'c'.repeat(64)),
      unavailable('stays_down', 'tool_missing'),
      unavailable('new_down', 'discovery_failed'),
    ]);

    expect(deriveToolAvailabilityPayload({ previous, current })).toEqual({
      kind: 'delta',
      added: ['new_tool'],
      removed: ['gone_tool'],
      unavailable: [{ id: 'new_down', reason: 'discovery_failed' }],
      becameUnavailable: [
        { id: 'changed_tool', reason: 'declaration_refused' },
      ],
      nowAvailable: [{ id: 'down_tool', reason: 'source_reconnected' }],
    });
  });

  it('returns null when an observed manifest is unchanged', () => {
    const current = manifest([
      available('same_tool', 'c'.repeat(64)),
      unavailable('down_tool', 'tool_missing'),
    ]);

    expect(
      deriveToolAvailabilityPayload({ previous: current, current }),
    ).toBeNull();
  });

  it('rejects an unobserved current manifest', () => {
    expect(() =>
      deriveToolAvailabilityPayload({
        // @ts-expect-error Exercise the runtime guard for a persisted v0 value.
        current: TOOL_AVAILABILITY_UNOBSERVED,
      }),
    ).toThrow(TypeError);
  });
});

describe('createToolAvailabilityItem', () => {
  it('renders every non-empty transition group with its heading and label', () => {
    const item = createToolAvailabilityItem({
      runId: RUN_ID,
      payload: payload({
        added: ['added_tool'],
        removed: ['removed_tool'],
        unavailable: [{ id: 'down_tool', reason: 'source_disconnected' }],
        becameUnavailable: [
          { id: 'changed_tool', reason: 'declaration_refused' },
        ],
        nowAvailable: [{ id: 'restored_tool', reason: 'declaration_accepted' }],
      }),
    });

    expect(item.data.producer).toBe('tool-availability');
    expect(item.data.form).toBe('notice');
    expect(item.data.text).toContain('The available tools were changed');
    expect(item.data.text).toContain('Added tools:\n- `added_tool`');
    expect(item.data.text).toContain('Removed tools:\n- `removed_tool`');
    expect(item.data.text).toContain(
      'Unavailable tools:\n- `down_tool`: "server disconnected"',
    );
    expect(item.data.text).toContain(
      'Became unavailable:\n- `changed_tool`: "tool declaration refused"',
    );
    expect(item.data.text).toContain(
      'Now available:\n- `restored_tool`: "tool declaration accepted"',
    );
    expect(item.data.text).toContain(
      'Do not simulate removed or unavailable tools or invent their results.',
    );
  });

  it('renders the initial disclosure wording and rejects invalid payloads', () => {
    const item = createToolAvailabilityItem({
      runId: RUN_ID,
      payload: {
        kind: 'initial',
        added: [],
        removed: [],
        unavailable: [{ id: 'down_tool', reason: 'tool_missing' }],
        becameUnavailable: [],
        nowAvailable: [],
      },
    });

    expect(item.data.text).toContain(
      'Some eligible tools are unavailable for this turn:',
    );
    expect(() =>
      createToolAvailabilityItem({
        runId: RUN_ID,
        payload: payload(),
      }),
    ).toThrow(TypeError);
  });
});

describe('isToolAvailabilityPayload ordering and shape', () => {
  it('accepts several code-point-ordered identifiers in one bucket', () => {
    expect(
      isToolAvailabilityPayload(
        payload({ added: ['a_tool', 'b_tool', 'c_tool'] }),
      ),
    ).toBe(true);
  });

  it('accepts several code-point-ordered reason entries in one bucket', () => {
    expect(
      isToolAvailabilityPayload(
        payload({
          unavailable: [
            { id: 'a_tool', reason: 'tool_missing' },
            { id: 'b_tool', reason: 'tool_missing' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('tracks sort order per reason bucket rather than across them', () => {
    // The second bucket starts below where the first ended, so a single
    // ordering cursor shared across buckets would read this as unsorted.
    expect(
      isToolAvailabilityPayload(
        payload({
          unavailable: [
            { id: 'z_one', reason: 'tool_missing' },
            { id: 'z_two', reason: 'tool_missing' },
          ],
          becameUnavailable: [
            { id: 'a_one', reason: 'declaration_refused' },
            { id: 'a_two', reason: 'declaration_refused' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['a non-array reason field', { ...payload(), unavailable: 'nope' }],
    [
      'an initial payload naming a became-unavailable transition',
      {
        ...payload({ kind: 'initial' }),
        becameUnavailable: [{ id: 'gone_tool', reason: 'tool_missing' }],
      },
    ],
    [
      'an initial payload naming a recovery',
      {
        ...payload({ kind: 'initial' }),
        nowAvailable: [{ id: 'back_tool', reason: 'tool_restored' }],
      },
    ],
  ] as const)('rejects %s', (_description, value) => {
    expect(isToolAvailabilityPayload(value)).toBe(false);
  });
});

describe('deriveToolAvailabilityPayload single-transition deltas', () => {
  it.each([
    [
      'an addition alone',
      manifest([available('kept_tool')]),
      manifest([available('kept_tool'), available('new_tool')]),
      { added: ['new_tool'] },
    ],
    [
      'a removal alone',
      manifest([available('kept_tool'), available('old_tool')]),
      manifest([available('kept_tool')]),
      { removed: ['old_tool'] },
    ],
    [
      'a newly-appearing unavailable tool alone',
      manifest([available('kept_tool')]),
      manifest([
        available('kept_tool'),
        unavailable('down_tool', 'tool_missing'),
      ]),
      { unavailable: [{ id: 'down_tool', reason: 'tool_missing' }] },
    ],
    [
      'a newly-unavailable tool alone',
      manifest([available('kept_tool'), available('down_tool')]),
      manifest([
        available('kept_tool'),
        unavailable('down_tool', 'source_disconnected'),
      ]),
      {
        becameUnavailable: [{ id: 'down_tool', reason: 'source_disconnected' }],
      },
    ],
    [
      'a recovery alone',
      manifest([
        available('kept_tool'),
        unavailable('back_tool', 'tool_missing'),
      ]),
      manifest([available('kept_tool'), available('back_tool')]),
      { nowAvailable: [{ id: 'back_tool', reason: 'tool_restored' }] },
    ],
  ] as const)(
    'still reports %s when every other bucket is empty',
    (_description, previous, current, expected) => {
      expect(
        deriveToolAvailabilityPayload({ current, previous }),
      ).toStrictEqual(payload(expected));
    },
  );

  it('reports every addition against a manifest that kept one tool', () => {
    const derived = deriveToolAvailabilityPayload({
      previous: manifest([available('c_tool')]),
      current: manifest([
        available('a_tool'),
        available('b_tool'),
        available('c_tool'),
      ]),
    });

    expect(derived).toStrictEqual(payload({ added: ['a_tool', 'b_tool'] }));
  });

  it('names the manifest that must be observed', () => {
    expect(() =>
      deriveToolAvailabilityPayload({
        // @ts-expect-error Exercise the runtime guard for a persisted v0 value.
        current: TOOL_AVAILABILITY_UNOBSERVED,
      }),
    ).toThrow('Current tool availability must be observed');
  });
});

describe('createToolAvailabilityItem rendering', () => {
  it('separates each group with a blank line and closes with the standing instruction', () => {
    const item = createToolAvailabilityItem({
      runId: RUN_ID,
      payload: payload({
        added: ['added_tool'],
        unavailable: [{ id: 'down_tool', reason: 'source_disconnected' }],
      }),
    });

    expect(item.data.text).toContain(
      [
        'The available tools were changed since the last turn:',
        '',
        'Added tools:',
        '- `added_tool`',
        '',
        'Unavailable tools:',
        '- `down_tool`: "server disconnected"',
        '',
        'Do not simulate removed or unavailable tools or invent their results.',
      ].join('\n'),
    );
  });

  it('names the rejected server-authored payload', () => {
    expect(() =>
      createToolAvailabilityItem({ runId: RUN_ID, payload: payload() }),
    ).toThrow('Invalid server-authored tool availability metadata');
  });
});
