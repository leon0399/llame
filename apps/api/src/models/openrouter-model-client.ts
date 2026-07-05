import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { stepCountIs, streamText } from 'ai';

import {
  requireModelCredential,
  type ModelClient,
  type ModelStreamInput,
} from './model-client';

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.4-mini';

/**
 * Native OpenRouter model client (#82) — the `@openrouter/ai-sdk-provider`
 * package, NOT an OpenAI-compatible base_url preset (the issue's explicit
 * mandate: OpenRouter-specific behavior — usage accounting, provider
 * routing options, reasoning passthrough — stays available instead of being
 * flattened into the generic surface).
 *
 * Same narrow ModelClient seam as the OpenAI client: the run pipeline is
 * provider-agnostic and only ever sees streamText + callbacks.
 */
export function createOpenRouterModelClient(
  apiKey: string,
  model = DEFAULT_OPENROUTER_MODEL,
): ModelClient {
  const openrouter = createOpenRouter({
    apiKey: requireModelCredential(apiKey),
  });

  return {
    model,
    provider: 'openrouter',
    streamText(input: ModelStreamInput) {
      return streamText({
        model: openrouter.chat(model),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        // Tool-calling loop (MVP): same bounded auto-loop as the OpenAI client.
        ...(input.tools
          ? {
              tools: input.tools,
              stopWhen: stepCountIs(input.maxSteps ?? 4),
            }
          : {}),
        ...(input.onTextDelta
          ? {
              onChunk: ({ chunk }) => {
                if (chunk.type === 'text-delta') {
                  input.onTextDelta?.(chunk.text);
                }
              },
            }
          : {}),
        onError: input.onError,
        onFinish: input.onFinish,
      });
    },
  };
}
