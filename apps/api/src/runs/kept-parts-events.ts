/**
 * The run events that produced a Continue Run's kept parts (turn-actions D5).
 *
 * `run.continued` carries the kept parts of a source reply; decoding them back
 * into the events that produced them lets the stream bridge replay them
 * through the very handlers a live Run used, so the kept text, reasoning, and
 * tool chunks cannot drift from the ones the source Run streamed.
 */

import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  isCancelledMetadata,
  TOOL_PART_PREFIX,
} from '../chats/tool-observation-part';
import type { RunEventLike } from './run-event-chunks';

/** One kept reasoning part's synthetic adapter id, unique inside the turn. */
function reasoningPartId(index: number): string {
  return `kept-reasoning-${index}`;
}

/** The request/completion pair of a kept settled call. */
function toolEvents(part: UnknownRecord): Array<RunEventLike> {
  const type = part['type'];
  const toolCallId = part['toolCallId'];
  if (!isString(type) || !type.startsWith(TOOL_PART_PREFIX)) return [];
  if (!isString(toolCallId)) return [];
  const toolName = type.slice(TOOL_PART_PREFIX.length);
  const requested: RunEventLike = {
    eventType: 'tool.requested',
    payload: { toolCallId, toolName, input: part['input'] },
  };
  // The completion carries the result shape the live event carried, so the
  // bridge's own handler renders the kept outcome exactly as it rendered the
  // live one.
  const output =
    part['state'] === 'output-error'
      ? {
          status: 'error' as const,
          type: isCancelledMetadata(part['resultProviderMetadata'])
            ? 'cancelled'
            : 'error',
          message: isString(part['errorText'])
            ? part['errorText']
            : 'The tool failed.',
        }
      : part['output'];
  const completed: RunEventLike = {
    eventType: 'tool.completed',
    payload: {
      toolCallId,
      toolName,
      status: part['state'] === 'output-error' ? 'error' : 'success',
      output,
    },
  };
  return [requested, completed];
}

/** One kept part as the events a live Run emitted for it. */
function partEvents(part: unknown, index: number): Array<RunEventLike> {
  if (!isRecord(part)) return [];
  const type = part['type'];
  const text = part['text'];
  if (type === 'text' && isString(text)) {
    return [{ eventType: 'model.delta', payload: { text } }];
  }
  if (type === 'reasoning' && isString(text)) {
    return [
      {
        eventType: 'reasoning.delta',
        payload: { text, partId: reasoningPartId(index) },
      },
    ];
  }
  if (type === 'data-cap-notice') {
    const data = part['data'];
    const stepsUsed = isRecord(data) ? data['stepsUsed'] : undefined;
    const maxSteps = isRecord(data) ? data['maxSteps'] : undefined;
    return isNumber(stepsUsed) && isNumber(maxSteps)
      ? [
          {
            eventType: 'run.step_cap_reached',
            payload: { stepsUsed, maxSteps },
          },
        ]
      : [];
  }
  return toolEvents(part);
}

/** Every kept part as the events a live Run emitted for it, in stored order. */
export function keptPartEvents(
  parts: ReadonlyArray<unknown>,
): Array<RunEventLike> {
  return parts.flatMap(partEvents);
}
