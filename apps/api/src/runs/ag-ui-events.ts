/**
 * Part chunk → AG-UI event encoder: the wire format of a Run's stream.
 *
 * The run-event translator decides the ordered parts of a reply (text,
 * reasoning, tool calls, notices) as `UiChunk`s; this module writes each one
 * as the AG-UI 1.0 events a client reads. The Chat is the AG-UI thread and the
 * Run is the AG-UI run. AG-UI messages are flat, so every text part and every
 * reasoning part is a message of its own, and a client that wants llame's
 * reply reads the events of one run in order: its reply id is the Run id, as
 * it was for the stream this replaces, and reloads read real message ids from
 * history.
 *
 * What AG-UI has no event for travels as `CUSTOM` events under the `llame.`
 * prefix, and a failed tool call is a `TOOL_CALL_RESULT` whose `metadata`
 * carries the failure, because the result event has no error field.
 */

import { EventType, type AGUIEvent } from '@ag-ui/core';

import type { UiChunk } from './run-event-chunks';

/** `CUSTOM` event names this stream emits. */
export const LLAME_CUSTOM_EVENT = {
  /** Per-reply metadata (`{ usage }`), merged into the reply's metadata. */
  messageMetadata: 'llame.message-metadata',
  capNotice: 'llame.cap-notice',
  compactionFailed: 'llame.compaction-failed',
  compactionDisabled: 'llame.compaction-disabled',
  /** The segment ended at a delivered message; the Run goes on. */
  runDelivered: 'llame.run-delivered',
} as const;

/** The failure a `TOOL_CALL_RESULT` carries under `metadata.llame`. */
export type ToolResultFailure = {
  error: true;
  cancelled?: true;
  interrupted?: true;
};

export type AgUiEncoder = {
  encode(chunk: UiChunk): Array<AGUIEvent>;
};

type RunIdentity = {
  /** The Chat id. */
  threadId: string;
  runId: string;
};

const NOTICE_EVENT_NAME = {
  'data-cap-notice': LLAME_CUSTOM_EVENT.capNotice,
  'data-compaction-failed': LLAME_CUSTOM_EVENT.compactionFailed,
  'data-compaction-disabled': LLAME_CUSTOM_EVENT.compactionDisabled,
  'data-run-delivered': LLAME_CUSTOM_EVENT.runDelivered,
} as const;

/** What AG-UI has no event for: a `CUSTOM` event under the `llame.` prefix. */
function encodeCustom(
  chunk: Extract<UiChunk, { type: 'message-metadata' | `data-${string}` }>,
): Array<AGUIEvent> {
  return [
    chunk.type === 'message-metadata'
      ? {
          type: EventType.CUSTOM,
          name: LLAME_CUSTOM_EVENT.messageMetadata,
          value: chunk.messageMetadata,
        }
      : {
          type: EventType.CUSTOM,
          name: NOTICE_EVENT_NAME[chunk.type],
          value: chunk.data,
        },
  ];
}

function partMessageId(runId: string, partId: string): string {
  return `${runId}:${partId}`;
}

function encodeText(
  chunk: Extract<UiChunk, { type: `text-${string}` }>,
  runId: string,
): Array<AGUIEvent> {
  const messageId = partMessageId(runId, chunk.id);

  switch (chunk.type) {
    case 'text-start':
      return [
        { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
      ];
    case 'text-delta':
      return [
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: chunk.delta,
        },
      ];
    case 'text-end':
      return [{ type: EventType.TEXT_MESSAGE_END, messageId }];
  }
}

function encodeReasoning(
  chunk: Extract<UiChunk, { type: `reasoning-${string}` }>,
  runId: string,
): Array<AGUIEvent> {
  const messageId = partMessageId(runId, chunk.id);

  switch (chunk.type) {
    case 'reasoning-start':
      return [
        { type: EventType.REASONING_START, messageId },
        {
          type: EventType.REASONING_MESSAGE_START,
          messageId,
          role: 'reasoning',
        },
      ];
    case 'reasoning-delta':
      return [
        {
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId,
          delta: chunk.delta,
        },
      ];
    case 'reasoning-end':
      return [
        { type: EventType.REASONING_MESSAGE_END, messageId },
        { type: EventType.REASONING_END, messageId },
      ];
  }
}

function encodeToolCall(
  chunk: Extract<UiChunk, { type: 'tool-input-available' }>,
): Array<AGUIEvent> {
  const { toolCallId } = chunk;

  // The input is complete when the Run records the call, so the three call
  // events arrive together with the arguments in one delta.
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: chunk.toolName,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify(chunk.input ?? {}),
    },
    { type: EventType.TOOL_CALL_END, toolCallId },
  ];
}

function encodeToolResult(
  chunk: Extract<
    UiChunk,
    { type: 'tool-output-available' | 'tool-output-error' }
  >,
): Array<AGUIEvent> {
  const { toolCallId } = chunk;

  const result = {
    type: EventType.TOOL_CALL_RESULT,
    messageId: `${toolCallId}:result`,
    toolCallId,
    role: 'tool',
  } as const;

  if (chunk.type === 'tool-output-available') {
    // `undefined` has no JSON form; a tool without output reads back as null.
    return [{ ...result, content: JSON.stringify(chunk.output ?? null) }];
  }

  const failure: ToolResultFailure = {
    error: true,
    ...chunk.providerMetadata?.llame,
  };

  return [
    { ...result, content: chunk.errorText, metadata: { llame: failure } },
  ];
}

/** Terminal outcomes and acceptance preserve the durable Run identity. */
function encodeLifecycle(
  chunk: Extract<UiChunk, { type: 'start' | 'finish' | 'error' }>,
  identity: RunIdentity,
): Array<AGUIEvent> {
  if (chunk.type === 'error') {
    return [{ type: EventType.RUN_ERROR, message: chunk.errorText }];
  }

  return [
    {
      type:
        chunk.type === 'start' ? EventType.RUN_STARTED : EventType.RUN_FINISHED,
      ...identity,
      ...(chunk.type === 'finish' &&
        chunk.cancelled && {
          outcome: { type: 'cancelled' as const },
        }),
    },
  ];
}

/** The encoder of one Run segment's stream. Stateless beyond its identity. */
export function createAgUiEncoder(identity: RunIdentity): AgUiEncoder {
  const { runId } = identity;

  return {
    encode(chunk) {
      switch (chunk.type) {
        case 'start':
        case 'finish':
        case 'error':
          return encodeLifecycle(chunk, identity);
        case 'text-start':
        case 'text-delta':
        case 'text-end':
          return encodeText(chunk, runId);
        case 'reasoning-start':
        case 'reasoning-delta':
        case 'reasoning-end':
          return encodeReasoning(chunk, runId);
        case 'tool-input-available':
          return encodeToolCall(chunk);
        case 'tool-output-available':
        case 'tool-output-error':
          return encodeToolResult(chunk);
        case 'message-metadata':
        case 'data-cap-notice':
        case 'data-compaction-failed':
        case 'data-compaction-disabled':
        case 'data-run-delivered':
          return encodeCustom(chunk);
      }
    },
  };
}
