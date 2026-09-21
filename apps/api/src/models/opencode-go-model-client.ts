import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';

import type { ChatIdentity, ModelClient } from './model-client';
import type { TokenPrice } from './model-catalog';
import { rejectRedirects } from './openai-codex-model-client';
import {
  createOpenAICompletionsModelClient,
  type OpenAICompletionsModelClientDependencies,
} from './openai-completions-model-client';
import type { ProviderOptionRecord } from './provider-options';

/**
 * The Go gateway's fixed Chat Completions root (design D1/D2): OpenCode Go
 * serves its subscription catalogue under one base URL, and a `type:
 * 'opencode-go'` entry declares no destination of its own, so this constant
 * is the only place the endpoint exists. No ambient environment variable can
 * move it — `@ai-sdk/openai-compatible` reads none, and the client below
 * always passes this base URL explicitly.
 */
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

/**
 * The gateway's client-identity header (design D6): a fixed value naming
 * llame, never a version (the version belongs in the `User-Agent`) and never
 * a credential.
 */
const OPENCODE_GO_CLIENT_HEADER = 'x-opencode-client';

/** The gateway's session header (design D3/D4): the one header the Chat identity is rendered into. */
const OPENCODE_GO_SESSION_HEADER = 'x-opencode-session';

type OpenCodeGoModelClientConfig = {
  /** The entry's own credential, required by the schema and resolved once at boot. */
  credential: string;
  providerModelId: string;
  modelId: string;
  contextWindowTokens: number;
  /** llame's product token and version (`llame/<version>`), sent per call by the wire client. */
  userAgent: string;
  /**
   * Operator request options (`models[].providerOptions`), forwarded to the
   * wire client as its inner record: it composes them under the namespace the
   * adapter derives from the `opencode-go` provider name (design D2) and
   * strips the Chat Completions wire's reserved paths, exactly as for an
   * `openai-completions` entry.
   */
  providerOptions?: ProviderOptionRecord;
  /** Catalog `models[].maxOutputTokens`, forwarded to every request. */
  maxOutputTokens?: number;
  /**
   * Resolved per-million-token pricing (design D9): Go bills a subscription
   * with usage windows, not a per-token invoice, so the example configuration
   * declares none and the recorded cost is `null` unless the operator
   * declares rates llame accounts against the reported usage.
   */
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
};

/**
 * The Chat identity as the gateway reads it (design D4/D5): the Chat's own
 * id, verbatim for the conversation's lane — the main turn and compaction,
 * whose requests reuse the conversation's prefix — and under the `title:`
 * prefix for title generation, whose prompt shares nothing with it. A prefix,
 * not a suffix, because the gateway picks its first upstream candidate from a
 * hash of the identity's last four characters.
 */
function renderSessionValue(chat: ChatIdentity): string {
  return chat.lane === 'title' ? `title:${chat.id}` : chat.id;
}

/**
 * Creates a model client for an `opencode-go` provider entry: the Chat
 * Completions wire at the endpoint fixed above, carrying the entry's own
 * credential, as the `opencode-go` provider, with the gateway's fixed client
 * header, the Chat identity on the gateway's session header, and the
 * redirect-rejecting transport the Codex client uses — a followed redirect
 * would carry the session header and the request body, and on a same-origin
 * hop the credential, to wherever it pointed. A composition, not a fork: the
 * wire client owns the stream loop, the tool loop, the option composition,
 * and the failure contract (design D2/D7).
 *
 * `modelId` is the opaque llame id used for telemetry and API events.
 * `providerModelId` is the server-only model id sent to the gateway.
 * @returns A model client that streams text using the configured model
 */
export function createOpenCodeGoModelClient(
  config: OpenCodeGoModelClientConfig,
  dependencies: OpenAICompletionsModelClientDependencies = {
    createOpenAICompatible,
    streamText,
  },
): ModelClient {
  return createOpenAICompletionsModelClient(
    {
      credential: config.credential,
      providerModelId: config.providerModelId,
      modelId: config.modelId,
      contextWindowTokens: config.contextWindowTokens,
      userAgent: config.userAgent,
      baseUrl: OPENCODE_GO_BASE_URL,
      provider: 'opencode-go',
      headers: { [OPENCODE_GO_CLIENT_HEADER]: 'llame' },
      fetch: rejectRedirects(globalThis.fetch),
      sessionHeader: (chat) => ({
        name: OPENCODE_GO_SESSION_HEADER,
        value: renderSessionValue(chat),
      }),
      ...(config.providerOptions !== undefined && {
        providerOptions: config.providerOptions,
      }),
      ...(config.maxOutputTokens !== undefined && {
        maxOutputTokens: config.maxOutputTokens,
      }),
      ...(config.pricing !== undefined && { pricing: config.pricing }),
      ...(config.compactionThresholdTokens !== undefined && {
        compactionThresholdTokens: config.compactionThresholdTokens,
      }),
    },
    dependencies,
  );
}
