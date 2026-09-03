/**
 * Model catalog TYPES.
 *
 * The catalog itself is config-as-code (providers-and-models-as-code, #167):
 * entries live in `llame.config.json`'s `models[]`/`providers[]` arrays
 * (typed as `LlameConfig.models`/`LlameConfig.providers` in
 * `instance-config/llame-config.ts`) and are resolved by `ModelsService` at
 * boot — there is no compiled-in catalog array here anymore.
 *
 * Public ids are opaque llame ids. Provider execution ids are explicit
 * server-only configuration and must never be derived by parsing the public id.
 */

export type ModelSource = 'system';
export type SystemPromptSource = 'project_default' | 'model_override';

export type ModelPricingUsdPer1M = {
  input?: number;
  cachedInput?: number;
  output?: number;
};

/**
 * One effort level after boot normalization. Config may author a bare string
 * or `{ value, label }`; both become this shape. `label` is omitted when the
 * operator did not supply one — never invented from `value`.
 */
export type EffortLevel = {
  readonly value: string;
  readonly label?: string;
};

/**
 * A model's reasoning-effort contract, as the operator declared it.
 *
 * `effortLevels[].value` are opaque PROVIDER-native tokens, never a llame
 * vocabulary: OpenAI and Anthropic disagree on the value set and both change
 * it between releases, so constraining the strings here — by enum or by
 * pattern — would make every provider release a llame release. Nothing reads
 * meaning out of a value; the API matches it byte-exactly against this list
 * and forwards it. Optional `label` is display metadata only.
 *
 * Order is normative: it is the only scale a client gets, since a token carries
 * no comparable magnitude of its own.
 */
export type ModelReasoning = {
  readonly effortLevels: ReadonlyArray<EffortLevel>;
  readonly defaultEffort: string;
  /**
   * Whether CHANGING effort invalidates this model's provider-side prompt
   * cache — not whether effort does. Operator-declared: Anthropic documents a
   * model-specific blast radius, OpenAI documents nothing while behaving
   * differently per model, and neither is derivable from configuration.
   * Published metadata only; llame's own execution never branches on it.
   */
  readonly cacheInvalidatedByEffortChange: boolean;
};

export interface PublicModelCatalogEntry {
  id: string;
  source: ModelSource;
  name?: string;
  description?: string;
  tags?: Array<string>;
  icon?: string;
  // Required, execution-critical (not display metadata): every executable model
  // MUST declare its context window. It travels onto the model client and sizes
  // the context-compaction trigger (× COMPACTION_WINDOW_RATIO); without it, long
  // chats on a small-window model would overflow before compaction ever fires.
  contextWindowTokens: number;
  pricingUsdPer1M?: ModelPricingUsdPer1M;
  knowledgeCutoff?: string;
  /** Absent when the operator declared no effort vocabulary for this model. */
  reasoning?: ModelReasoning;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
}

/**
 * The internal execution-side entry: adds the server-only provider reference
 * and the optional per-model compaction override, neither of which is
 * display metadata or exposed via `GET /api/v1/models` (same non-exposure
 * rule as `providerModelId`).
 */
/**
 * Raw per-user values for one run, before escaping (add-user-personalization).
 * The caller decides WHICH values may render — the owner's `enabled` and
 * `shareAccountIdentity` toggles; the prompt loader decides HOW: escaping,
 * trimming, and omitting absent values from the render context.
 */
export type PromptUserInput = {
  preferredName?: string | null;
  about?: string | null;
  responsePreferences?: string | null;
  /** Account display name — passed only when the owner shares identity. */
  name?: string | null;
  /** Account email — passed only when the owner shares identity. */
  email?: string | null;
};

export type PromptChatDigestEntry = {
  title: string;
  /** Last-activity date, preformatted by the caller. */
  date: string;
  messageCount: number;
  excerpt?: string | null;
};

export type PromptChatsInput = {
  pinned?: ReadonlyArray<PromptChatDigestEntry>;
  recent?: ReadonlyArray<PromptChatDigestEntry>;
  pinnedShown: number;
  pinnedTotal: number;
  recentShown: number;
  recentTotal: number;
  /** Date the digest was compiled, preformatted by the caller. */
  compiledOn: string;
};

export interface SystemModelCatalogEntry extends PublicModelCatalogEntry {
  /** References a `providers[].id` in the resolved instance config. */
  provider: string;
  providerModelId: string;
  /** Explicit per-model compaction trigger override; falls back to `contextWindowTokens x COMPACTION_WINDOW_RATIO` when absent. */
  compactionThresholdTokens?: number;
  /**
   * This model's complete system-prompt template, read and validated at boot.
   *
   * A template string rather than a rendered one because per-user and per-chat
   * context resolves per run — neither owner nor chat is in scope at boot. A
   * string rather than a render function because a catalog entry is DATA:
   * keeping it so means the entry stays serializable, a test fixture is an
   * object literal, and nothing holds the loader's scope alive for the process
   * lifetime. Rendering is `SystemPromptsService`'s job. Never exposed in the
   * public catalog.
   */
  systemPromptTemplate: string;
  /** Path-free provenance for the resolved prompt. */
  systemPromptSource: SystemPromptSource;
}

/**
 * A single model's resolved pricing, carried on its `ModelClient` (see
 * `model-client.ts`) and consumed by turn-telemetry cost calculation. Unlike
 * `ModelPricingUsdPer1M` (optional per-field display metadata), `input`/
 * `output` are required here — pricing that can't compute a cost is simply
 * absent (`ModelClient.pricing === undefined`), not a partial `TokenPrice`.
 */
export type TokenPrice = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  outputUsdPer1M: number;
};

/**
 * Strip the internal execution-only fields (`provider`, `providerModelId`,
 * `compactionThresholdTokens`, `systemPromptTemplate`, `systemPromptSource`)
 * from a catalog entry — what's left IS the public shape, so a straight
 * destructure-and-spread stays correct as `PublicModelCatalogEntry` grows
 * without needing a matching field-by-field copy here.
 */
export function toPublicModel(
  model: SystemModelCatalogEntry,
): PublicModelCatalogEntry {
  const {
    provider: _provider,
    providerModelId: _providerModelId,
    compactionThresholdTokens: _compactionThresholdTokens,
    systemPromptTemplate: _systemPromptTemplate,
    systemPromptSource: _systemPromptSource,
    ...pub
  } = model;
  return pub;
}

/** Derive the resolved `TokenPrice` a client carries from a catalog entry's display pricing, or `undefined` when incomplete. */
export function toTokenPrice(
  pricing: ModelPricingUsdPer1M | undefined,
): TokenPrice | undefined {
  if (pricing?.input === undefined || pricing.output === undefined) {
    return undefined;
  }
  const price: TokenPrice = {
    inputUsdPer1M: pricing.input,
    outputUsdPer1M: pricing.output,
  };
  if (pricing.cachedInput !== undefined) {
    price.cachedInputUsdPer1M = pricing.cachedInput;
  }
  return price;
}
