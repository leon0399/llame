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

  it('rejects incomplete wait checkpoint receipts', () => {
    const awaiting = {
      toolCallId: 'wait-1',
      toolInput: { jobs: ['job://executor-1'] },
      jobIds: ['job://executor-1'],
      deadline: '2026-10-10T01:00:00.000Z',
    };

    const checkpoint = {
      generation: 1,
      toolCallId: 'wait-1',
      parts: [],
      steps: {},
      awaiting,
    };

    const invalid = [
      event(3, 'run.suspended', { ...checkpoint, toolCallId: 1 }),
      event(3, 'run.suspended', {
        ...checkpoint,
        awaiting: { ...awaiting, toolCallId: 'other-call' },
      }),
      event(3, 'run.suspended', {
        ...checkpoint,
        awaiting: {
          ...awaiting,
          toolInput: { jobs: ['job://executor-1'], timeout: 'later' },
        },
      }),
    ];

    for (const suspension of invalid) {
      const events = firstWakeEvents().map((entry) =>
        entry.sequence === 3 ? suspension : entry,
      );

      expect(wakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
    }
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
