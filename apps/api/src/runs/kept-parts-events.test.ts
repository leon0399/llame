/**
 * `keptPartEvents` decodes a Continue Run's kept parts into the events that
 * produced them, so the stream bridge replays them through the very handlers a
 * live Run used. Each part shape maps to exactly one event shape, and an
 * unreadable part contributes nothing rather than a mangled replay.
 */

import { isRecord, isString } from '@workspace/runtime-safety';

import { keptPartEvents } from './kept-parts-events';

/** A kept settled `read` call, as the reply stored it. */
const CALL = {
  type: 'tool-read',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { path: '/work/a.txt' },
  output: { status: 'success', text: 'file body' },
  outcome: 'success',
};

describe('keptPartEvents', () => {
  it('replays kept text as a model delta', () => {
    expect(keptPartEvents([{ type: 'text', text: 'reading' }])).toEqual([
      { eventType: 'model.delta', payload: { text: 'reading' } },
    ]);
  });

  it('gives each kept reasoning part its own adapter id', () => {
    const events = keptPartEvents([
      { type: 'reasoning', text: 'first' },
      { type: 'reasoning', text: 'second' },
    ]);

    expect(events).toEqual([
      {
        eventType: 'reasoning.delta',
        payload: { text: 'first', partId: 'kept-reasoning-0' },
      },
      {
        eventType: 'reasoning.delta',
        payload: { text: 'second', partId: 'kept-reasoning-1' },
      },
    ]);
    // Distinct ids are what keeps the two parts apart in the UI stream.
    const ids = events.flatMap(({ payload }) =>
      isRecord(payload) && isString(payload['partId'])
        ? [payload['partId']]
        : [],
    );
    expect(ids).toEqual(['kept-reasoning-0', 'kept-reasoning-1']);
  });

  it('replays a kept settled call as its request and its success completion', () => {
    expect(keptPartEvents([CALL])).toEqual([
      {
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'call-1',
          toolName: 'read',
          input: { path: '/work/a.txt' },
        },
      },
      {
        eventType: 'tool.completed',
        payload: {
          toolCallId: 'call-1',
          toolName: 'read',
          status: 'success',
          output: { status: 'success', text: 'file body' },
        },
      },
    ]);
  });

  it('replays a kept failed call as an error completion with its message', () => {
    const events = keptPartEvents([
      {
        ...CALL,
        state: 'output-error',
        errorText: 'the file is gone',
        outcome: 'not_found',
      },
    ]);

    expect(events[1]).toEqual({
      eventType: 'tool.completed',
      payload: {
        toolCallId: 'call-1',
        toolName: 'read',
        status: 'error',
        output: {
          status: 'error',
          type: 'error',
          message: 'the file is gone',
        },
      },
    });
  });

  it('replays a terminated call as a cancellation', () => {
    const events = keptPartEvents([
      {
        ...CALL,
        state: 'output-error',
        errorText: 'Run cancelled.',
        resultProviderMetadata: { llame: { cancelled: true } },
      },
    ]);

    expect(events[1]).toEqual({
      eventType: 'tool.completed',
      payload: {
        toolCallId: 'call-1',
        toolName: 'read',
        status: 'error',
        output: {
          status: 'error',
          type: 'cancelled',
          message: 'Run cancelled.',
        },
      },
    });
  });

  it('falls back to a generic message for an error part that recorded none', () => {
    const events = keptPartEvents([
      { ...CALL, state: 'output-error', errorText: undefined },
    ]);

    expect(events[1]?.payload).toMatchObject({
      output: { type: 'error', message: 'The tool failed.' },
    });
  });

  it('reads a call only when its type names a tool and its id is a string', () => {
    expect(
      keptPartEvents([
        { type: 'tool-read', toolCallId: 42, state: 'output-available' },
        { type: 'data-context', toolCallId: 'call-2' },
        { type: 'tool-', toolCallId: 'call-3' },
      ]),
    ).toEqual([
      // `tool-` with no name after the prefix is still a tool type, so its
      // request and completion are replayed with an empty name.
      {
        eventType: 'tool.requested',
        payload: { toolCallId: 'call-3', toolName: '', input: undefined },
      },
      {
        eventType: 'tool.completed',
        payload: {
          toolCallId: 'call-3',
          toolName: '',
          status: 'success',
          output: undefined,
        },
      },
    ]);
  });

  it('replays a kept step-cap marker as the cap event', () => {
    expect(
      keptPartEvents([
        { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
      ]),
    ).toEqual([
      {
        eventType: 'run.step_cap_reached',
        payload: { stepsUsed: 4, maxSteps: 4 },
      },
    ]);
  });

  it('contributes nothing for a cap marker whose counts are absent', () => {
    expect(
      keptPartEvents([{ type: 'data-cap-notice', data: { stepsUsed: 4 } }]),
    ).toEqual([]);
  });

  it('contributes nothing for an unreadable part', () => {
    expect(keptPartEvents([null, 'text', 7, { text: 'no type' }])).toEqual([]);
  });

  it('keeps the stored order across part kinds', () => {
    expect(
      keptPartEvents([
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'reading' },
        CALL,
      ]).map(({ eventType }) => eventType),
    ).toEqual([
      'reasoning.delta',
      'model.delta',
      'tool.requested',
      'tool.completed',
    ]);
  });
});
