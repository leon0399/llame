import { EventType } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';

import { createAgUiEncoder } from './ag-ui-events';
import type { UiChunk } from './run-event-chunks';
import { createRunEventTranslator } from './run-stream-bridge';

const THREAD_ID = 'chat-1';
const RUN_ID = 'run-1';

function encodeAll(chunks: Array<UiChunk>) {
  const encoder = createAgUiEncoder({ threadId: THREAD_ID, runId: RUN_ID });

  return chunks.flatMap((chunk) => encoder.encode(chunk));
}

/** The AG-UI events of a Run, from its run events. */
function streamOf(events: Array<{ eventType: string; payload: unknown }>) {
  const translator = createRunEventTranslator(RUN_ID);

  return encodeAll([
    ...translator.prelude(),
    ...events.flatMap((event) => translator.translate(event)),
  ]);
}

describe('createAgUiEncoder', () => {
  it('writes a reply with reasoning, a tool call, and text as schema-valid AG-UI events in order', () => {
    const events = streamOf([
      { eventType: 'reasoning.delta', payload: { text: 'plan' } },
      {
        eventType: 'tool.requested',
        payload: { toolCallId: 'c1', toolName: 'bash', input: { cmd: 'ls' } },
      },
      {
        eventType: 'tool.completed',
        payload: { toolCallId: 'c1', status: 'success', output: { ok: 1 } },
      },
      { eventType: 'model.delta', payload: { text: 'done' } },
      { eventType: 'model.completed', payload: { telemetry: { cost: 1 } } },
      { eventType: 'run.completed', payload: null },
    ]);

    for (const event of events) {
      expect(EventSchemas.safeParse(event).error).toBeUndefined();
    }

    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'REASONING_START',
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_END',
      'REASONING_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'CUSTOM',
      'RUN_FINISHED',
    ]);
  });

  it('names the Chat as the thread and the Run as the run on both lifecycle events', () => {
    expect(
      encodeAll([
        { type: 'start', messageId: RUN_ID },
        { type: 'finish', finishReason: 'stop' },
      ]),
    ).toEqual([
      { type: 'RUN_STARTED', threadId: THREAD_ID, runId: RUN_ID },
      { type: 'RUN_FINISHED', threadId: THREAD_ID, runId: RUN_ID },
    ]);
  });

  it('gives each text part its own message id so text never merges across a tool call or reasoning', () => {
    const events = encodeAll([
      { type: 'text-start', id: 'text-1' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'read',
        input: { path: 'a' },
        dynamic: true,
      },
      { type: 'text-start', id: 'text-2' },
    ]);

    expect(events).toEqual([
      {
        type: 'TEXT_MESSAGE_START',
        messageId: `${RUN_ID}:text-1`,
        role: 'assistant',
      },
      { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'read' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"path":"a"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'c1' },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: `${RUN_ID}:text-2`,
        role: 'assistant',
      },
    ]);
  });

  it('gives each reasoning part its own message id so two parts never merge', () => {
    const ids = encodeAll([
      { type: 'reasoning-start', id: 'reasoning-1' },
      { type: 'reasoning-end', id: 'reasoning-1' },
      { type: 'reasoning-start', id: 'reasoning-2' },
    ])
      .filter((event) => event.type === EventType.REASONING_MESSAGE_START)
      .map((event) => event.messageId);

    expect(ids).toEqual([`${RUN_ID}:reasoning-1`, `${RUN_ID}:reasoning-2`]);
  });

  it('writes a tool output as JSON content, and a missing output as null', () => {
    const [withOutput, withoutOutput] = encodeAll([
      {
        type: 'tool-output-available',
        toolCallId: 'c1',
        output: { status: 'success', lines: ['a'] },
        dynamic: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'c2',
        output: undefined,
        dynamic: true,
      },
    ]);

    expect(withOutput).toMatchObject({
      type: 'TOOL_CALL_RESULT',
      toolCallId: 'c1',
      content: '{"status":"success","lines":["a"]}',
    });
    expect(withOutput).not.toHaveProperty('metadata');
    expect(withoutOutput).toMatchObject({ toolCallId: 'c2', content: 'null' });
  });

  it('marks a failed tool call in the result metadata, with why it ended', () => {
    const [failed, cancelled, interrupted] = encodeAll([
      {
        type: 'tool-output-error',
        toolCallId: 'c1',
        errorText: 'exit 2',
        dynamic: true,
      },
      {
        type: 'tool-output-error',
        toolCallId: 'c2',
        errorText: 'Cancelled.',
        providerMetadata: { llame: { cancelled: true } },
        dynamic: true,
      },
      {
        type: 'tool-output-error',
        toolCallId: 'c3',
        errorText: 'Interrupted.',
        providerMetadata: { llame: { interrupted: true } },
        dynamic: true,
      },
    ]);

    expect(failed).toMatchObject({
      type: 'TOOL_CALL_RESULT',
      content: 'exit 2',
      metadata: { llame: { error: true } },
    });
    expect(cancelled).toMatchObject({
      metadata: { llame: { error: true, cancelled: true } },
    });
    expect(interrupted).toMatchObject({
      metadata: { llame: { error: true, interrupted: true } },
    });
  });

  it('carries notices, reply metadata, and a delivery as llame custom events', () => {
    expect(
      encodeAll([
        { type: 'message-metadata', messageMetadata: { usage: { cost: 2 } } },
        { type: 'data-cap-notice', data: { stepsUsed: 3, maxSteps: 3 } },
        { type: 'data-compaction-failed', data: {} },
        { type: 'data-compaction-disabled', data: {} },
        { type: 'data-run-delivered', data: { messageId: 'm1' } },
      ]),
    ).toEqual([
      {
        type: 'CUSTOM',
        name: 'llame.message-metadata',
        value: { usage: { cost: 2 } },
      },
      {
        type: 'CUSTOM',
        name: 'llame.cap-notice',
        value: { stepsUsed: 3, maxSteps: 3 },
      },
      { type: 'CUSTOM', name: 'llame.compaction-failed', value: {} },
      { type: 'CUSTOM', name: 'llame.compaction-disabled', value: {} },
      {
        type: 'CUSTOM',
        name: 'llame.run-delivered',
        value: { messageId: 'm1' },
      },
    ]);
  });

  it('ends a failed Run with RUN_ERROR carrying the failure message', () => {
    expect(encodeAll([{ type: 'error', errorText: 'Run failed.' }])).toEqual([
      { type: 'RUN_ERROR', message: 'Run failed.' },
    ]);
  });

  it.each(['model.delta', 'reasoning.delta'])(
    'closes an open %s part before reporting a cancelled outcome',
    (eventType) => {
      const events = streamOf([
        { eventType, payload: { text: 'partial' } },
        { eventType: 'run.cancelled', payload: null },
      ]);

      expect(events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        outcome: { type: 'cancelled' },
      });

      const end =
        eventType === 'model.delta'
          ? 'TEXT_MESSAGE_END'
          : 'REASONING_MESSAGE_END';

      expect(events.map((event) => event.type)).toContain(end);

      for (const event of events)
        expect(EventSchemas.safeParse(event).success).toBe(true);
    },
  );
});
