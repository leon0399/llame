import type {
  FinishReason,
  FlexibleSchema,
  LanguageModelUsage,
  ModelMessage,
  StreamTextOnErrorCallback,
  streamText,
  ToolChoice,
  ToolSet,
} from 'ai';

import type { TokenPrice } from './model-catalog';

export interface ModelStreamInput {
  messages: ModelMessage[];
  system?: string;
  abortSignal?: AbortSignal;
  /**
   * Tool-calling loop (MVP): the available tool set for this turn, already
   * PRE-FILTERED by permission (the caller owns the fail-closed allowlist).
   * Each tool's `execute` is the caller's permission-safe, event-emitting
   * wrapper. Absent → answer-only, single generation (today's behavior).
   */
  tools?: ToolSet;
  /** Provider-neutral tool selection policy for this request. */
  toolChoice?: ToolChoice<ToolSet>;
  /**
   * Hard cap on TOOL-REQUESTING steps for the tool loop (SPEC tool-calling
   * §requirement "step cap"). Only meaningful with `tools`. Once this many
   * prior steps have called a tool, the client stops offering tools for the
   * next step (forcing a text-only answer from accumulated context) rather
   * than ending the run mid tool-call — see `onCapReached`.
   */
  maxSteps?: number;
  /**
   * Fired at most once, the moment the client disables tools for the
   * following step because `maxSteps` tool-requesting steps have already
   * run (D6: "the cap-reaching step completes atomically... drives the model
   * to answer from accumulated context"). Lets the executor record the cap
   * as a run event + a persisted cap-marker part.
   */
  onCapReached?: () => void;
  /**
   * Fired when the model's tool call cannot be resolved against the
   * declared `tools` (an unlisted/hallucinated tool name, or arguments that
   * fail the tool's own schema) — the provider-agnostic seam for the D3/D6
   * "recorded, non-fatal tool error" refusal path. The client itself still
   * lets the SDK's own non-crashing fallback produce the model-visible
   * error; this callback is purely for durability (event + persisted part).
   */
  onUnavailableToolCall?: (event: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    reason: 'not_available' | 'invalid_input';
  }) => void;
  /**
   * Called for each streamed text delta (#48/#49): lets the loop persist
   * model.delta run events without consuming the result stream itself.
   * A narrow seam by design — providers map their chunk shapes onto plain text.
   */
  onTextDelta?: (text: string) => void;
  /**
   * Called for each streamed reasoning ("thinking") delta from a reasoning
   * model. Same narrow seam as onTextDelta — providers map their reasoning
   * chunks onto plain text; absent/empty for non-reasoning models.
   */
  onReasoningDelta?: (text: string) => void;
  onError?: StreamTextOnErrorCallback;
  onFinish?: (event: {
    text: string;
    usage: LanguageModelUsage;
    finishReason: FinishReason;
  }) => void | Promise<void>;
}

export interface ModelObjectInput<OBJECT> {
  messages: ModelMessage[];
  system?: string;
  abortSignal?: AbortSignal;
  /**
   * Typed schema handle (the AI SDK's jsonSchema<T>() / zodSchema()): carries
   * both the JSON Schema sent to the provider and the TS type it produces, so
   * the result is typed end-to-end with no casts at the call site.
   */
  schema: FlexibleSchema<OBJECT>;
  /**
   * Tool/schema identity forwarded to the provider (function name and
   * description on backends that route structured output through tool calling).
   */
  schemaName?: string;
  schemaDescription?: string;
}

export interface ModelClient {
  readonly model: string;
  readonly provider: string;
  /**
   * The selected model's context window, in tokens. Carried on the client so
   * post-turn work (compaction) sizes its trigger without re-looking-up the
   * catalog by id. Always present: the client is built from a catalog entry
   * whose `contextWindowTokens` is a required field.
   */
  readonly contextWindowTokens: number;
  /** Resolved per-million-token pricing for cost telemetry; absent when the model has no configured price. */
  readonly pricing?: TokenPrice;
  /**
   * Explicit compaction trigger override for this model (config
   * `models[].compactionThresholdTokens`); absent falls back to
   * `contextWindowTokens x COMPACTION_WINDOW_RATIO` (see compaction.ts).
   */
  readonly compactionThresholdTokens?: number;
  streamText(input: ModelStreamInput): ReturnType<typeof streamText>;
  /**
   * Schema-constrained single object generation via an API-level REQUIRED tool
   * call (toolChoice pinned to the schema's tool). Optional: not every
   * OpenAI-compatible endpoint supports tool calling, and fakes may omit it —
   * callers must keep a plain-text fallback.
   */
  generateObject?<OBJECT>(input: ModelObjectInput<OBJECT>): Promise<OBJECT>;
}

export type ModelCredentialResolver = (
  userId: string,
) => Promise<string | null | undefined> | string | null | undefined;

export class MissingModelCredentialError extends Error {
  readonly code = 'missing_model_credential';

  constructor(readonly userId?: string) {
    super(
      userId
        ? `No model credential configured for user ${userId}.`
        : 'No model credential configured.',
    );
    this.name = 'MissingModelCredentialError';
  }
}

export async function resolveModelCredential(
  userId: string,
  resolveCredential?: ModelCredentialResolver,
): Promise<string> {
  const credential = await resolveCredential?.(userId);

  return requireModelCredential(credential, userId);
}

export function requireModelCredential(
  credential: string | null | undefined,
  userId?: string,
): string {
  const normalizedCredential = credential?.trim();

  if (!normalizedCredential) {
    throw new MissingModelCredentialError(userId);
  }

  return normalizedCredential;
}
