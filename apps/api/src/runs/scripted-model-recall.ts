/**
 * The conversation-recall script a scripted model client plays: it reads the
 * tool results a previous step returned and decides the next recall call (or
 * the final text-only answer). Split out of `scripted-model-client.ts` so that
 * file stays under the size trip-wire on its own.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
} from '@ai-sdk/provider';
import { z } from 'zod';

/**
 * The recall fields the script reads. Structural rather than the client's own
 * behavior union: this module never points back at the file that wires it.
 */
type RecallScript = {
  readonly query: string;
  readonly continueRead?: boolean;
  readonly finalText?: string;
};

type ConversationCoordinates = {
  chatId: string;
  messageSeq: number;
  offset: number;
  limit: number;
};

const conversationSearchOutputSchema = z.object({
  status: z.literal('success'),
  results: z.array(
    z.object({
      kind: z.literal('content'),
      chatId: z.guid(),
      messageSeq: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().positive().max(2000),
    }),
  ),
});
const conversationReadOutputSchema = z.object({
  status: z.literal('success'),
  nextOffset: z.number().int().nonnegative().optional(),
});

function parseJsonText<T>(value: string, schema: z.ZodType<T>): T | undefined {
  try {
    const decoded: unknown = JSON.parse(value);
    const parsed = schema.safeParse(decoded);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Parses a `tool-result` content's output — JSON already, or JSON-as-text — against `schema`. */
function parseToolOutput<T>(
  output: LanguageModelV3ToolResultOutput,
  schema: z.ZodType<T>,
): T | undefined {
  if (output.type === 'json') {
    const parsed = schema.safeParse(output.value);
    return parsed.success ? parsed.data : undefined;
  }
  if (output.type === 'text') {
    return parseJsonText(output.value, schema);
  }
  return undefined;
}

function findSearchOutputs(prompt: LanguageModelV3CallOptions['prompt']) {
  const outputs: Array<z.output<typeof conversationSearchOutputSchema>> = [];
  for (const message of prompt) {
    if (message.role !== 'tool') continue;
    for (const content of message.content) {
      if (
        content.type !== 'tool-result' ||
        content.toolName !== 'search_conversations'
      )
        continue;
      const parsed = parseToolOutput(
        content.output,
        conversationSearchOutputSchema,
      );
      if (parsed !== undefined) outputs.push(parsed);
    }
  }
  return outputs;
}

function findReadOutputs(prompt: LanguageModelV3CallOptions['prompt']) {
  const outputs: Array<z.output<typeof conversationReadOutputSchema>> = [];
  for (const message of prompt) {
    if (message.role !== 'tool') continue;
    for (const content of message.content) {
      if (
        content.type !== 'tool-result' ||
        content.toolName !== 'conversation_read'
      )
        continue;
      const parsed = parseToolOutput(
        content.output,
        conversationReadOutputSchema,
      );
      if (parsed !== undefined) outputs.push(parsed);
    }
  }
  return outputs;
}

/**
 * One step of the recall script, decided from the tool results the prompt
 * already carries: the read step names the call the step issues.
 */
type RecallStep =
  | { readonly kind: 'search' }
  | {
      readonly kind: 'read';
      readonly toolCallId: string;
      readonly input: ConversationCoordinates;
    }
  | { readonly kind: 'answer' };

/**
 * The recall script's next step: search first, then one bounded read, then a
 * continuation of that read when it is scripted, and finally the answer.
 */
function recallStep(
  prompt: LanguageModelV3CallOptions['prompt'],
  script: RecallScript,
): RecallStep {
  const searchOutputs = findSearchOutputs(prompt);
  if (searchOutputs.length === 0) return { kind: 'search' };

  const readOutputs = findReadOutputs(prompt);
  const result = searchOutputs[0]?.results[0];
  const coordinates: ConversationCoordinates | undefined =
    result === undefined
      ? undefined
      : {
          chatId: result.chatId,
          messageSeq: result.messageSeq,
          offset: result.offset,
          limit: result.limit,
        };
  if (coordinates !== undefined && readOutputs.length === 0) {
    return {
      kind: 'read',
      toolCallId: 'conversation-read-1',
      input: coordinates,
    };
  }

  const offset =
    script.continueRead && readOutputs.length === 1
      ? readOutputs[0]?.nextOffset
      : undefined;
  if (coordinates === undefined || offset === undefined)
    return { kind: 'answer' };
  return {
    kind: 'read',
    toolCallId: 'conversation-read-2',
    input: { ...coordinates, offset, limit: 2 },
  };
}

/** The next scripted step of a conversation-recall turn, from the prompt it is replaying. */
export function conversationRecallParts(
  prompt: LanguageModelV3CallOptions['prompt'],
  script: RecallScript,
): Array<LanguageModelV3StreamPart> {
  const step = recallStep(prompt, script);
  if (step.kind === 'search') {
    return [
      {
        type: 'tool-call',
        toolCallId: 'conversation-search',
        toolName: 'search_conversations',
        input: JSON.stringify({
          mode: 'content',
          query: script.query,
          limit: 5,
        }),
      },
    ];
  }
  if (step.kind === 'read') {
    return [
      {
        type: 'tool-call',
        toolCallId: step.toolCallId,
        toolName: 'conversation_read',
        input: JSON.stringify(step.input),
      },
    ];
  }

  return [
    { type: 'text-start', id: 'answer' },
    {
      type: 'text-delta',
      id: 'answer',
      delta: script.finalText ?? 'The source was read.',
    },
    { type: 'text-end', id: 'answer' },
  ];
}
