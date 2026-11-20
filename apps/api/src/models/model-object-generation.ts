import type { LanguageModelV3 } from '@ai-sdk/provider';
import { generateText, streamText, tool } from 'ai';

import { agentTelemetry, type ModelObjectInput } from './model-client';

/**
 * Generates schema-constrained objects through a tool call. Request options are
 * composed by the client that owns the selected model wire.
 */
export async function generateToolBoundObject<OBJECT>(
  model: LanguageModelV3,
  input: ModelObjectInput<OBJECT>,
  callSettings: Pick<
    Parameters<typeof streamText>[0],
    'maxOutputTokens' | 'providerOptions'
  > &
    Required<Pick<Parameters<typeof streamText>[0], 'headers'>>,
): Promise<OBJECT> {
  const toolName = input.schemaName ?? 'output';

  const result = await generateText({
    model,
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    experimental_telemetry: agentTelemetry(input.chat),
    ...callSettings,
    maxRetries: 0,
    tools: {
      [toolName]: tool({
        description: input.schemaDescription,
        inputSchema: input.schema,
      }),
    },
    toolChoice: { type: 'tool', toolName },
  });

  // `dynamic` is the discriminant: valid static calls carry schema-typed input.
  const call = result.toolCalls[0];

  if (!call || call.dynamic) {
    throw new Error(`Model did not produce a valid '${toolName}' tool call`);
  }

  return call.input;
}
