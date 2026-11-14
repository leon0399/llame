import { isRecord } from '@workspace/runtime-safety';
import { type RunEvent } from '../db/schema';
import { wakeStateFromEvents } from './wake-projection';

const runId = '11111111-1111-4111-8111-111111111111';
const createdAt = new Date('2026-10-10T00:00:00.000Z');

function event(
  sequence: number,
  eventType: string,
  payload: RunEvent['payload'],
): RunEvent {
  return { sequence, runId, eventType, payload, createdAt };
}

function firstWakeEvents(
  parts: ReadonlyArray<unknown> = [{ type: 'text', text: 'before', step: 2 }],
) {
  return [
    event(1, 'tool.requested', {
      toolCallId: 'wait-1',
      toolName: 'wait',
      stepNumber: 0,
      permission: {
        policyId: 'policy-1',
        decision: 'allow',
        reason: 'permission_mode_bypass',
        reference: null,
      },
      providerMetadata: { provider: { marker: 'preserve' } },
    }),
    event(2, 'tool.started', {
      toolCallId: 'wait-1',
      classification: 'read_only',
    }),
    event(3, 'run.suspended', {
      generation: 1,
      toolCallId: 'wait-1',
      parts,
      steps: {},
      awaiting: {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'] },
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    }),
    event(4, 'run.resumed', { generation: 1, cause: 'settled' }),
    event(5, 'run.started', { attemptId: 'wake-attempt' }),
    event(6, 'tool.completed', {
      toolCallId: 'wait-1',
      toolName: 'wait',
      output: { status: 'success', value: 'settled' },
    }),
    event(7, 'model.requested', { attemptId: 'wake-attempt' }),
  ];
}

describe('wakeStateFromEvents', () => {
  it('restores the checkpoint and correlated wait result with original activity metadata', () => {
    const state = wakeStateFromEvents(firstWakeEvents(), 'wake-attempt');

    expect(state?.toolCallId).toBe('wait-1');
    expect(state?.parts).toHaveLength(2);
    expect(state?.parts[0]).toEqual({
      type: 'text',
      text: 'before',
      step: 2,
    });
    expect(state?.parts[1]).toMatchObject({
      toolCallId: 'wait-1',
      permission: {
        policyId: 'policy-1',
        decision: 'allow',
        reason: 'permission_mode_bypass',
        reference: null,
      },
      providerMetadata: { provider: { marker: 'preserve' } },
      classification: 'read_only',
      step: 3,
      outcome: 'success',
    });
  });

  it('supports an empty checkpoint and requires the current attempt to persist the result', () => {
    const events = firstWakeEvents([]);

    expect(wakeStateFromEvents(events, 'wake-attempt')?.parts).toHaveLength(1);
    expect(wakeStateFromEvents(events, 'other-attempt')).toBeUndefined();
    expect(
      wakeStateFromEvents(
        events.filter((event) => event.eventType !== 'tool.completed'),
        'wake-attempt',
      ),
    ).toBeUndefined();
  });

  it('uses persisted awaiting input when the model tool request is absent', () => {
    const events = firstWakeEvents().filter(
      (entry) =>
        entry.eventType !== 'tool.requested' &&
        entry.eventType !== 'tool.started',
    );

    expect(wakeStateFromEvents(events, 'wake-attempt')?.parts[1]).toMatchObject(
      {
        toolCallId: 'wait-1',
        input: { jobs: ['job://executor-1'] },
        classification: null,
      },
    );
  });

  it('seeds only the first claim, not a later ordinary retry', () => {
    const events = [
      ...firstWakeEvents(),
      event(8, 'model.completed', { attemptId: 'wake-attempt' }),
      event(9, 'run.started', { attemptId: 'retry-attempt' }),
      event(10, 'model.requested', { attemptId: 'retry-attempt' }),
      event(11, 'tool.completed', {
        toolCallId: 'wait-1',
        toolName: 'wait',
        output: { status: 'success', value: 'settled' },
      }),
    ];

    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeDefined();
    expect(wakeStateFromEvents(events, 'retry-attempt')).toBeUndefined();
  });

  it('uses the latest wait generation and respects the latest delivery boundary', () => {
    const events = [
      ...firstWakeEvents(),
      event(8, 'model.completed', { attemptId: 'wake-attempt' }),
      event(9, 'run.started', { attemptId: 'waiting-again' }),
      event(10, 'model.requested', { attemptId: 'waiting-again' }),
      event(11, 'tool.requested', {
        toolCallId: 'wait-2',
        toolName: 'wait',
        input: { jobs: ['job://executor-2'] },
      }),
      event(12, 'tool.started', {
        toolCallId: 'wait-2',
        classification: 'read_only',
      }),
      event(13, 'run.suspended', {
        generation: 2,
        toolCallId: 'wait-2',
        parts: [{ type: 'text', text: 'between generations' }],
        steps: {},
        awaiting: {
          toolCallId: 'wait-2',
          toolInput: { jobs: ['job://executor-2'] },
          jobIds: ['job://executor-2'],
          deadline: '2026-10-10T01:00:00.000Z',
        },
      }),
      event(14, 'run.resumed', { generation: 2, cause: 'settled' }),
      event(15, 'run.started', { attemptId: 'wake-2' }),
      event(17, 'tool.completed', {
        toolCallId: 'wait-2',
        toolName: 'wait',
        output: { status: 'success', value: 'second settled' },
      }),
    ];

    expect(wakeStateFromEvents(events, 'wake-2')?.toolCallId).toBe('wait-2');
    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
    expect(
      wakeStateFromEvents(
        [...events, event(18, 'run.delivered', { messageId: 'delivered' })],
        'wake-2',
      ),
    ).toBeUndefined();
  });

  it.each([
    ['missing awaiting data', undefined],
    ['non-object awaiting data', null],
    [
      'mismatched tool call id',
      {
        toolCallId: 'other-call',
        toolInput: { jobs: ['job://executor-1'] },
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'missing tool input',
      {
        toolCallId: 'wait-1',
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'non-object tool input',
      {
        toolCallId: 'wait-1',
        toolInput: null,
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'missing jobs',
      {
        toolCallId: 'wait-1',
        toolInput: {},
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'non-array jobs',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: 'job://executor-1' },
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'non-string job entry',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1', 2] },
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'non-number timeout',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'], timeout: 'later' },
        jobIds: ['job://executor-1'],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'missing job ids',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'] },
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'non-array job ids',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'] },
        jobIds: 'job://executor-1',
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'non-string job id',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'] },
        jobIds: ['job://executor-1', 2],
        deadline: '2026-10-10T01:00:00.000Z',
      },
    ],
    [
      'missing deadline',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'] },
        jobIds: ['job://executor-1'],
      },
    ],
    [
      'non-string deadline',
      {
        toolCallId: 'wait-1',
        toolInput: { jobs: ['job://executor-1'] },
        jobIds: ['job://executor-1'],
        deadline: 60,
      },
    ],
  ])('rejects invalid awaiting data: %s', (_description, awaiting) => {
    const events = firstWakeEvents().map((entry) =>
      entry.sequence === 3
        ? event(3, 'run.suspended', {
            generation: 1,
            toolCallId: 'wait-1',
            parts: [],
            steps: {},
            awaiting,
          })
        : entry,
    );

    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
  });

  it.each([
    {
      description: 'no started attempt',
      attemptId: 'wake-attempt',
      prepareEvents: (events: Array<RunEvent>) =>
        events.filter((entry) => entry.eventType !== 'run.started'),
    },
    {
      description: 'started by a different attempt',
      attemptId: 'other-attempt',
      prepareEvents: (events: Array<RunEvent>) => events,
    },
  ])(
    'requires the resumed attempt to be started: $description',
    ({ attemptId, prepareEvents }) => {
      expect(
        wakeStateFromEvents(prepareEvents(firstWakeEvents()), attemptId),
      ).toBeUndefined();
    },
  );

  it.each([
    ['non-array parts', null],
    ['non-record part entry', [null]],
  ])('rejects suspension with %s', (_description, parts) => {
    const events = firstWakeEvents().map((entry) =>
      entry.sequence === 3
        ? event(3, 'run.suspended', {
            generation: 1,
            toolCallId: 'wait-1',
            parts,
            steps: {},
            awaiting: {
              toolCallId: 'wait-1',
              toolInput: { jobs: ['job://executor-1'] },
              jobIds: ['job://executor-1'],
              deadline: '2026-10-10T01:00:00.000Z',
            },
          })
        : entry,
    );

    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
  });

  it('rejects suspension with missing parts', () => {
    const events = firstWakeEvents().map((entry) =>
      entry.sequence === 3
        ? event(3, 'run.suspended', {
            generation: 1,
            toolCallId: 'wait-1',
            steps: {},
            awaiting: {
              toolCallId: 'wait-1',
              toolInput: { jobs: ['job://executor-1'] },
              jobIds: ['job://executor-1'],
              deadline: '2026-10-10T01:00:00.000Z',
            },
          })
        : entry,
    );

    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
  });

  it('selects the matching wait metadata instead of neighboring tool metadata', () => {
    const events = firstWakeEvents();
    events.splice(
      0,
      0,
      event(2, 'tool.requested', {
        toolCallId: 'neighbor-call',
        toolName: 'wait',
        permission: { policyId: 'wrong-policy', decision: 'deny' },
        providerMetadata: { provider: { marker: 'wrong' } },
      }),
    );

    const activity = wakeStateFromEvents(events, 'wake-attempt')?.parts[1];

    expect(activity).toMatchObject({
      toolCallId: 'wait-1',
      permission: {
        policyId: 'policy-1',
        decision: 'allow',
        reason: 'permission_mode_bypass',
        reference: null,
      },
      providerMetadata: { provider: { marker: 'preserve' } },
      classification: 'read_only',
    });
  });

  it('does not use a wait completion from the next attempt', () => {
    const events = [
      ...firstWakeEvents().filter(
        (entry) =>
          !(entry.eventType === 'tool.completed' && entry.sequence === 6),
      ),
      event(8, 'model.completed', { attemptId: 'wake-attempt' }),
      event(9, 'run.started', { attemptId: 'next-attempt' }),
      event(10, 'tool.completed', {
        toolCallId: 'wait-1',
        toolName: 'wait',
        output: { status: 'success', value: 'settled later' },
      }),
    ];

    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
  });

  it('requires a suspension with the resumed generation', () => {
    const events = firstWakeEvents().map((entry) =>
      entry.sequence === 3 && isRecord(entry.payload)
        ? event(3, 'run.suspended', { ...entry.payload, generation: 2 })
        : entry,
    );

    expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
  });

  it('restores checkpoint steps and timeout as the returned wait activity', () => {
    const events = firstWakeEvents([
      { type: 'text', text: 'kept', step: 4 },
      { type: 'text', text: 'unindexed' },
    ]);

    const resumed = [
      ...events.slice(0, 2),
      event(3, 'run.suspended', {
        generation: 1,
        toolCallId: 'wait-1',
        parts: [
          { type: 'text', text: 'kept', step: 4 },
          { type: 'text', text: 'unindexed' },
        ],
        steps: { 'wait-1': 7, ignored: 'not-a-step' },
        awaiting: {
          toolCallId: 'wait-1',
          toolInput: { jobs: ['job://executor-1'], timeout: 30 },
          jobIds: ['job://executor-1'],
          deadline: '2026-10-10T01:00:00.000Z',
        },
      }),
      ...events.slice(3),
    ];

    expect(wakeStateFromEvents(resumed, 'wake-attempt')?.parts).toEqual([
      { type: 'text', text: 'kept', step: 4 },
      { type: 'text', text: 'unindexed' },
      expect.objectContaining({
        toolCallId: 'wait-1',
        input: { jobs: ['job://executor-1'], timeout: 30 },
        step: 7,
        outcome: 'success',
      }),
    ]);
  });

  it('does not use a completion from before the resumed attempt', () => {
    const events = firstWakeEvents();
    const completion = events[5];

    if (completion?.eventType !== 'tool.completed') {
      throw new Error('Expected the wait completion fixture.');
    }

    const outsideAttempt = [
      ...events.slice(0, 4),
      completion,
      ...events.slice(4).filter((entry) => entry !== completion),
    ];

    expect(wakeStateFromEvents(outsideAttempt, 'wake-attempt')).toBeUndefined();
  });
});
