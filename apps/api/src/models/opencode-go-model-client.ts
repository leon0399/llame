import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';

import type { BillingMode, ModelClient } from './model-client';
import type { ModelInput, TokenPrice } from './model-catalog';
import { rejectRedirects } from './openai-codex-model-client';
import {
  createOpenAICompletionsModelClient,
  type OpenAICompletionsModelClientDependencies,
} from './openai-completions-model-client';
import type { ProviderOptionRecord } from './provider-options';
import {
  renderSessionId,
  type RequestHeaderTemplates,
} from './request-headers';
import { createOpenAIModelClient } from './openai-model-client';
import { createAnthropicModelClient } from './anthropic-model-client';
import type { ModelWire } from '../instance-config/provider-routing';

/**
 * The Go gateway's fixed API root: OpenCode Go
 * serves its subscription catalogue under one base URL, and a `type:
 * 'opencode-go'` entry declares no destination of its own, so this constant
 * controls the destination. Every wire client receives this base explicitly;
 * no ambient environment variable can move it.
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
  /** Startup-resolved operator header templates rendered for every request. */
  requestHeaders: RequestHeaderTemplates;
  wire?: ModelWire;
  reasoningDeclared?: boolean;
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
  billing?: BillingMode;
  compactionThresholdTokens?: number;
  input?: ReadonlyArray<ModelInput>;
};

/** Builds the configured Responses or Messages transport for OpenCode Go. */
function createOpenCodeGoWireClient(
  config: OpenCodeGoModelClientConfig,
): ModelClient | undefined {
  if (
    config.wire !== 'openai-responses' &&
    config.wire !== 'anthropic-messages'
  ) {
    return undefined;
  }

  const transport = {
    ...config,
    providerType: 'opencode-go',
    baseUrl: OPENCODE_GO_BASE_URL,
    reasoningDeclared: config.reasoningDeclared ?? false,
    requestHeaders: goRequestHeaders(config.requestHeaders),
    fetch: rejectRedirects(globalThis.fetch),
  };

  const client =
    config.wire === 'openai-responses'
      ? createOpenAIModelClient({ ...transport, provider: 'opencode-go' })
      : createAnthropicModelClient(transport);

  return { ...client, provider: 'opencode-go' };
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
  const wireClient = createOpenCodeGoWireClient(config);

  if (wireClient !== undefined) return wireClient;

  return createOpenAICompletionsModelClient(
    {
      ...config,
      baseUrl: OPENCODE_GO_BASE_URL,
      provider: 'opencode-go',
      providerType: 'opencode-go',
      headers: { [OPENCODE_GO_CLIENT_HEADER]: 'llame' },
      fetch: rejectRedirects(globalThis.fetch),
      // The gateway answers `stream_options.include_usage` with a stream that
      // carries no finish reason and ends in a malformed cost chunk, which
      // fails the Run (anomalyco/opencode#42918); without it the stream is
      // clean, so Go requests never ask.
      includeUsage: false,
      sessionHeader: (chat) => ({
        name: OPENCODE_GO_SESSION_HEADER,
        value: renderSessionId(chat),
      }),
    },
    dependencies,
  );
}

function goRequestHeaders(
  headers: RequestHeaderTemplates,
): RequestHeaderTemplates {
  const nonempty = Object.fromEntries(
    Object.entries(headers).filter(
      ([, parts]) => parts.length > 1 || parts.some((part) => part.length > 0),
    ),
  );

  const names = new Set(
    Object.keys(nonempty).map((name) => name.toLowerCase()),
  );

  return {
    ...(!names.has('x-opencode-client') && { 'x-opencode-client': ['llame'] }),
    ...(!names.has('x-opencode-session') && { 'x-opencode-session': ['', ''] }),
    ...nonempty,
  };
}
