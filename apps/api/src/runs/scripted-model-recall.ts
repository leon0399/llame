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
import { scriptedToolInput } from './scripted-model-step';

/**
 * The recall fields the script reads. Structural rather than the client's own
 * behavior union: this module never points back at the file that wires it.
 */
type RecallScript = {
  readonly query: string;
  readonly continueRead?: boolean;
  readonly finalText?: string;
};

type ConversationRead = {
  path: string;
};

const conversationSearchOutputSchema = z.object({
  status: z.literal('success'),
  results: z.array(
    z.object({
      kind: z.literal('content'),
      locator: z.string(),
    }),
  ),
});

const conversationReadOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  nextOffset: z.number().int().nonnegative().optional(),
});

const readContinuation =
  /\[(?:\d+ more lines\. )?Use [^\r\n]*:L(\d+)-(?:\d+)? to continue\]$/u;

function parseJsonText<T>(value: string, schema: z.ZodType<T>): T | undefined {
  try {
    const decoded: unknown = JSON.parse(value);
    const parsed = schema.safeParse(decoded);

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function parseToolOutput<T>(
  output: LanguageModelV3ToolResultOutput,
  schema: z.ZodType<T>,
): T | undefined {
  if (output.type === 'json') {
    const parsed = schema.safeParse(output.value);

    return parsed.success ? parsed.data : undefined;
  }

  return output.type === 'text'
    ? parseJsonText(output.value, schema)
    : undefined;
}

/** Parses a read's structured error or its native text rendering. */
function parseReadOutput(
  output: LanguageModelV3ToolResultOutput,
): z.output<typeof conversationReadOutputSchema> | undefined {
  if (output.type === 'json') {
    const parsed = conversationReadOutputSchema.safeParse(output.value);

    return parsed.success ? parsed.data : undefined;
  }

  if (output.type !== 'text') return undefined;

  const serialized = parseJsonText(output.value, conversationReadOutputSchema);

  if (serialized !== undefined) return serialized;

  const continuation = readContinuation.exec(output.value);

  if (continuation === null) return { status: 'success' };

  const line = Number(continuation[1]);

  return Number.isSafeInteger(line) && line > 0
    ? { status: 'success', nextOffset: line - 1 }
    : { status: 'success' };
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
      if (content.type !== 'tool-result' || content.toolName !== 'read') {
        continue;
      }

      const parsed = parseReadOutput(content.output);

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
      readonly input: ConversationRead;
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

  const locator = result?.locator;

  if (locator !== undefined && readOutputs.length === 0) {
    return {
      kind: 'read',
      toolCallId: 'conversation-read-1',
      input: { path: locator },
    };
  }

  const continuation = readOutputs[0];
  const selector = locator?.match(/^(.*):L\d+-(\d+)$/u);

  const nextOffset =
    script.continueRead &&
    readOutputs.length === 1 &&
    continuation?.status === 'success'
      ? continuation.nextOffset
      : undefined;

  if (
    selector === null ||
    selector === undefined ||
    nextOffset === undefined ||
    nextOffset + 1 > Number(selector[2])
  ) {
    return { kind: 'answer' };
  }

  const messagePath = selector[1];
  const endLine = selector[2];

  return {
    kind: 'read',
    toolCallId: 'conversation-read-2',
    input: { path: `${messagePath}:L${nextOffset + 1}-${endLine}` },
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
        input: scriptedToolInput('search_conversations', {
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
        toolName: 'read',
        input: scriptedToolInput('read', step.input),
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
