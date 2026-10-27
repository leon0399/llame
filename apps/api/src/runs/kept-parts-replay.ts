/**
 * Replay of a Continue Run's kept parts as UI chunks (turn-actions D5).
 *
 * `run.continued` carries the kept parts of the source reply, and it is
 * appended right after `run.created`, so a resumed stream shows the kept text,
 * reasoning, and tool parts before the first new part. Each kept part produces
 * the same chunks it produced while it streamed: a part is opened, delivered,
 * and closed here because the source Run had already finished it. A kept
 * in-Run item has no chunk of its own — the client sees it when it adopts the
 * finalized history, as it does for a live in-Run item.
 */

import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { TOOL_PART_PREFIX } from '../chats/tool-observation-part';
import type { UiChunk } from './run-event-chunks';

/**
 * The part bookkeeping the bridge owns. The replay reads the open text part
 * and advances both part counters through it, so kept parts and new parts keep
 * one numbering and one open-part state.
 */
export interface KeptPartStream {
  closeText(): Array<UiChunk>;
  closeReasoning(): Array<UiChunk>;
  /** The open text part's UI id, or null when none is open. */
  currentTextId(): string | null;
  /** Opens a text part and returns its UI id. */
  startText(): string;
  /** Opens a reasoning part and returns its UI id. */
  startReasoning(): string;
}

/**
 * Each kept reasoning part is complete: it opens, streams, and closes at once,
 * so two consecutive kept parts keep their boundary and the next new delivery
 * opens its own.
 */
function keptReasoning(text: string, stream: KeptPartStream): Array<UiChunk> {
  const id = stream.startReasoning();
  return [
    ...stream.closeText(),
    { type: 'reasoning-start', id },
    { type: 'reasoning-delta', id, delta: text },
    { type: 'reasoning-end', id },
  ];
}

function keptText(text: string, stream: KeptPartStream): Array<UiChunk> {
  const chunks = stream.closeReasoning();
  const open = stream.currentTextId();
  const id = open ?? stream.startText();
  if (open === null) chunks.push({ type: 'text-start', id });
  chunks.push({ type: 'text-delta', id, delta: text });
  return chunks;
}

/** The outcome chunk of a kept call: its recorded result or its recorded error. */
function keptToolOutcome(
  part: UnknownRecord,
  toolCallId: string,
): Array<UiChunk> {
  if (part['state'] !== 'output-error') {
    const output: unknown = part['output'];
    return [
      { type: 'tool-output-available', toolCallId, output, dynamic: true },
    ];
  }
  const errorText = isString(part['errorText'])
    ? part['errorText']
    : 'The tool failed.';
  const metadata = part['resultProviderMetadata'];
  const cancelled =
    isRecord(metadata) &&
    isRecord(metadata['llame']) &&
    metadata['llame']['cancelled'] === true;
  return [
    {
      type: 'tool-output-error',
      toolCallId,
      errorText,
      ...(cancelled && {
        providerMetadata: { llame: { cancelled: true as const } },
      }),
      dynamic: true,
    },
  ];
}

/**
 * A kept settled call: its input and its recorded outcome, emitted together
 * because the source Run had already received both. The UI treats both chunks
 * as `dynamic` tool parts, exactly as it did live.
 */
function keptToolPart(
  part: UnknownRecord,
  stream: KeptPartStream,
): Array<UiChunk> {
  const type = part['type'];
  const toolCallId = part['toolCallId'];
  if (!isString(type) || !type.startsWith(TOOL_PART_PREFIX)) return [];
  if (!isString(toolCallId)) return [];
  return [
    ...stream.closeReasoning(),
    ...stream.closeText(),
    {
      type: 'tool-input-available',
      toolCallId,
      toolName: type.slice(TOOL_PART_PREFIX.length),
      input: part['input'],
      dynamic: true,
    },
    ...keptToolOutcome(part, toolCallId),
  ];
}

/** One kept part as the chunks the same part produced while it streamed. */
function keptPart(part: unknown, stream: KeptPartStream): Array<UiChunk> {
  if (!isRecord(part)) return [];
  const type = part['type'];
  const text = part['text'];
  if (type === 'text' && isString(text)) {
    return text.length === 0 ? [] : keptText(text, stream);
  }
  if (type === 'reasoning' && isString(text)) {
    return text.length === 0 ? [] : keptReasoning(text, stream);
  }
  if (type === 'data-cap-notice') {
    const data = part['data'];
    const stepsUsed = isRecord(data) ? data['stepsUsed'] : undefined;
    const maxSteps = isRecord(data) ? data['maxSteps'] : undefined;
    return isNumber(stepsUsed) && isNumber(maxSteps)
      ? [{ type: 'data-cap-notice', data: { stepsUsed, maxSteps } }]
      : [];
  }
  return keptToolPart(part, stream);
}

/** Every kept part as UI chunks, in stored order. */
export function replayKeptParts(
  parts: ReadonlyArray<unknown>,
  stream: KeptPartStream,
): Array<UiChunk> {
  return parts.flatMap((part) => keptPart(part, stream));
}
