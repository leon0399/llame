/**
 * The whole-step script a scripted model client plays (design D14): one
 * ordered list of the deliveries a provider step makes, expanded into the AI
 * SDK's own provider stream parts so the real `streamText` pipeline — part
 * boundaries, provider metadata, the repair hook, and the step composer — sees
 * exactly what a production wire would send.
 *
 * Split out of `scripted-model-client.ts` so the behavior union, the parts it
 * expands to, and the tests that read them are the same concern, and so each
 * file stays under the size trip-wire on its own.
 */

import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { ProviderMetadata } from 'ai';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';

/** The zero usage every scripted step reports; only the stream shape matters. */
export const PROVIDER_ZERO_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/**
 * One reasoning block: the provider's start, its text, and its end under one
 * adapter part id. The block's opaque metadata rides every part, as a wire is
 * allowed to repeat it; the collector binds it to the stored part.
 */
export type ScriptedReasoning = {
  type: 'reasoning';
  id: string;
  text?: string;
  providerMetadata?: ProviderMetadata;
};

/** One text block, in the same start/delta/end shape as reasoning. */
export type ScriptedText = {
  type: 'text';
  id: string;
  text?: string;
  providerMetadata?: ProviderMetadata;
};

/**
 * One call the provider asks for. `input` is the wire's JSON: an object is
 * stringified, a string is sent verbatim, so a script can send arguments the
 * tool's schema rejects (including malformed JSON) exactly as a model can.
 */
export type ScriptedToolCall = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: string | UnknownRecord;
  providerMetadata?: ProviderMetadata;
};

/** A provider stream failure after everything the step delivered before it. */
export type ScriptedStepFailure = {
  type: 'error';
  message: string;
};

/** One delivery of a scripted provider step. */
export type ScriptedStepPart =
  | ScriptedReasoning
  | ScriptedText
  | ScriptedToolCall
  | ScriptedStepFailure;

/** One provider request of a scripted turn, in the order the SDK makes them. */
export type ScriptedStep = ReadonlyArray<ScriptedStepPart>;

/**
 * Appends a reasoning or text block's start, text, and end parts in wire
 * order. The block's metadata rides every part, and an empty block keeps its
 * start and end without a delta.
 */
function appendSpan(
  parts: Array<LanguageModelV3StreamPart>,
  part: ScriptedReasoning | ScriptedText,
): void {
  const metadata = part.providerMetadata;
  const withMetadata =
    metadata === undefined ? {} : { providerMetadata: metadata };
  const text = part.text ?? '';
  switch (part.type) {
    case 'reasoning':
      parts.push({ type: 'reasoning-start', id: part.id, ...withMetadata });
      if (text.length > 0) {
        parts.push({
          type: 'reasoning-delta',
          id: part.id,
          delta: text,
          ...withMetadata,
        });
      }
      parts.push({ type: 'reasoning-end', id: part.id, ...withMetadata });
      return;
    case 'text':
      parts.push({ type: 'text-start', id: part.id, ...withMetadata });
      if (text.length > 0) {
        parts.push({
          type: 'text-delta',
          id: part.id,
          delta: text,
          ...withMetadata,
        });
      }
      parts.push({ type: 'text-end', id: part.id, ...withMetadata });
  }
}

/** Appends one scripted delivery as its provider stream parts. */
function appendBlock(
  parts: Array<LanguageModelV3StreamPart>,
  part: ScriptedStepPart,
): void {
  switch (part.type) {
    case 'reasoning':
    case 'text':
      appendSpan(parts, part);
      return;
    case 'tool-call':
      parts.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: isString(part.input) ? part.input : JSON.stringify(part.input),
        ...(part.providerMetadata !== undefined && {
          providerMetadata: part.providerMetadata,
        }),
      });
      return;
    case 'error':
      parts.push({ type: 'error', error: new Error(part.message) });
  }
}

/**
 * The provider stream parts one scripted step emits. A step that requested a
 * tool finishes with `tool-calls` (so the SDK executes them and asks for the
 * next step); every other step finishes with `stop`. A step that fails ends
 * at its `error` part — nothing after it is emitted, and no finish, exactly
 * as a dropped provider stream.
 */
export function scriptedStepParts(
  step: ScriptedStep,
): Array<LanguageModelV3StreamPart> {
  const parts: Array<LanguageModelV3StreamPart> = [];
  for (const part of step) {
    appendBlock(parts, part);
    if (part.type === 'error') return parts;
  }
  parts.push({
    type: 'finish',
    finishReason: {
      unified: step.some((part) => part.type === 'tool-call')
        ? 'tool-calls'
        : 'stop',
      raw: undefined,
    },
    usage: PROVIDER_ZERO_USAGE,
  });
  return parts;
}
