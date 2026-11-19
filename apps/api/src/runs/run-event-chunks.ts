/**
 * The part chunks the run-event translator emits — the ordered parts of a
 * reply, in the AI SDK UI-message chunk vocabulary the stored transcript's
 * parts come from — and the payload readers every translator shares. The
 * chunks are internal: `ag-ui-events.ts` writes them to the client as AG-UI
 * events. Split from the bridge so the kept-part replay can name the same
 * chunks without importing the bridge's service.
 */

import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

/** The part chunks of a reply (a subset of the AI SDK UI-message chunks). */
export type UiChunk =
  | { type: 'start'; messageId: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'data-superseded'; data: { partIds: Array<string> } }
  | { type: 'message-metadata'; messageMetadata: unknown }
  | {
      type: 'tool-input-available';
      toolCallId: string;
      toolName: string;
      input: unknown;
      intent?: string;
      dynamic: true;
    }
  | {
      type: 'tool-output-available';
      toolCallId: string;
      output: unknown;
      dynamic: true;
    }
  | {
      type: 'tool-output-error';
      toolCallId: string;
      errorText: string;
      providerMetadata?: { llame: { cancelled?: true; interrupted?: true } };
      dynamic: true;
    }
  | {
      type: 'data-cap-notice';
      data: { stepsUsed: number; maxSteps: number };
    }
  | { type: 'data-compaction-failed'; data: Record<string, never> }
  | { type: 'data-compaction-disabled'; data: Record<string, never> }
  | {
      type: 'data-model-retrying';
      data: { code: string; retry: number; delayMs: number };
    }
  | { type: 'data-run-delivered'; data: { messageId: string } }
  | { type: 'error'; errorText: string }
  | { type: 'finish'; finishReason: 'stop'; cancelled?: true };

export interface RunEventLike {
  eventType: string;
  payload: unknown;
  sequence?: number;
}

/** Raw field off an unknown object payload — the one null-guard every reader shares. */
export function payloadField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return undefined;
  }

  return payload[key];
}

export function payloadString(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- one field off the raw `run_events.payload` JSONB value; `payloadField` and `isString` validate it before any use.
  payload: unknown,
  key: string,
): string | undefined {
  const value = payloadField(payload, key);

  return isString(value) ? value : undefined;
}

export function payloadNumber(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- one field off the raw `run_events.payload` JSONB value; `payloadField` and `isNumber` validate it before any use.
  payload: unknown,
  key: string,
): number | undefined {
  const value = payloadField(payload, key);

  return isNumber(value) ? value : undefined;
}
