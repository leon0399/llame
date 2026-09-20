import type {
  FinishReason,
  FlexibleSchema,
  LanguageModelUsage,
  ModelMessage,
  ProviderMetadata,
  StreamTextOnErrorCallback,
  streamText,
  ToolChoice,
  ToolSet,
} from 'ai';

import type { TokenPrice } from './model-catalog';

export interface ModelStreamInput {
  messages: Array<ModelMessage>;
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
   * Reasoning effort for this request, as an opaque PROVIDER-native token —
   * llame owns no effort vocabulary, so each client maps this string onto its
   * own provider option unchanged (add-reasoning-effort).
   *
   * Presence is what matters, never truthiness: a level denoting disabled
   * reasoning is a real instruction and differs from omitting the parameter,
   * which leaves the provider's own default in force.
   */
  effort?: string;
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
   * Called for each reasoning ("thinking") delivery from a reasoning model:
   * the delta text (possibly empty), the id of the provider part it belongs to,
   * and the opaque metadata that part carries. Same narrow seam as
   * onTextDelta — providers map their reasoning onto plain text, and a client
   * whose adapter supplies part metadata delivers text and metadata from ONE
   * consumer of its stream, so the deliveries keep the stream's order (design
   * D18).
   *
   * `partId` decides persisted part boundaries and is transport plumbing,
   * never display state. It is the adapter's own part id scoped to the
   * provider invocation and step, so a wire that numbers its parts per
   * provider response (restarting at zero on each step of a tool loop) still
   * yields one id per part within the turn. An undefined id means the wire
   * gave no information, not "no part".
   *
   * `providerMetadata` is the opaque metadata the adapter bound to that part
   * (design D15): on the Responses wire the item's `itemId` and its
   * `reasoningEncryptedContent`, on the Messages wire a thinking block's
   * `signature` or its redacted payload. It travels with the persisted part
   * and is replayed with it on a request that continues the same Chat; llame
   * never reads inside it. A wire that supplies none (Chat Completions)
   * leaves it undefined.
   *
   * A call may carry metadata with empty text: that is how a part whose text
   * the provider withheld arrives — a signed thinking block, a redacted one,
   * a Responses item whose summary is empty — and such a delivery starts the
   * part its metadata belongs to rather than binding to a text fragment.
   */
  onReasoningDelta?: (
    text: string,
    partId?: string,
    providerMetadata?: ProviderMetadata,
  ) => void;
  onError?: StreamTextOnErrorCallback;
  onFinish?: (event: {
    text: string;
    usage: LanguageModelUsage;
    finishReason: FinishReason;
  }) => void | Promise<void>;
}

export interface ModelObjectInput<OBJECT> {
  messages: Array<ModelMessage>;
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
   * Schema-constrained single object generation. How the object is obtained
   * is the client's: the OpenAI clients pin a REQUIRED tool call to the
   * schema's tool, while the Messages client asks for the AI SDK's JSON
   * response format and lets the adapter choose its mechanism — the native
   * structured-output format on models its capability table supports, its
   * own JSON tool otherwise (anthropic-provider D12). Optional: not every
   * OpenAI-compatible endpoint supports tool calling, and fakes may omit
   * it — callers must keep a plain-text fallback.
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
