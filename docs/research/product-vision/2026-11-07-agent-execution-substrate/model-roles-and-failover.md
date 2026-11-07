---
type: Research
title: "Model roles, failover, routing and catalogs: prior art"
description: "How LiteLLM, OpenRouter, Vercel AI Gateway, RouteLLM, Not Diamond, oh-my-pi, OpenClaw, Codex and Claude Code name model roles, fail over, promote on context pressure, route by classifier and expose models to an assistant, with what each implies for llame model roles (#1612 F1)."
tags: [model-roles, failover, routing, model-catalog, subagents]
status: draft
generated: { by: "omp/claude-opus-5-5", at: "2026-11-07" }
---

# R0 research: F1 model roles, failover, routing, catalog (prior art)

Scope: tracking issue #1612 (F1 = C1..C7). Facts with sources; "Implications for llame" at the end. Anything not read in source/docs is marked [unverified].

## Pinned sources (all read 2026-11-07)

| Source                                                                     | Pin                                        |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| BerriAI/litellm (checkout `~/.cache/checkouts/github.com/BerriAI/litellm`) | `cdbb4879263091a4cba2943519ae158adf7f8668` |
| lm-sys/RouteLLM                                                            | `0b64fdafe049e596a3f5657c219329f24af24198` |
| can1357/oh-my-pi                                                           | `88a69582c755bd000e8dc0290981fc787a4f400c` |
| openclaw/openclaw                                                          | `d40aa7c6f2ba70e0c59e244d09a325d25e1457b0` |
| openai/codex                                                               | `d92aae550180544fa2b7f656173c837271de6df3` |
| Web docs (LiteLLM, OpenRouter, Vercel, AI SDK, Claude Code, Not Diamond)   | live pages fetched 2026-11-07, URLs inline |

Docs pages are unversioned; they can drift. File:line cites are at the pins above.

---

## 1. LiteLLM Router

Docs: <https://docs.litellm.ai/docs/routing>, <https://docs.litellm.ai/docs/proxy/reliability>, <https://docs.litellm.ai/docs/tutorials/model_fallbacks>, <https://docs.litellm.ai/docs/proxy/tag_routing>, <https://docs.litellm.ai/docs/proxy/provider_budget_routing>, <https://docs.litellm.ai/docs/proxy/auto_routing>.

### 1.1 Alias model: group of deployments

- `model_name` is the alias; several `litellm_params` entries with the same `model_name` form a _model group_ that is load-balanced (routing doc, "Load Balancing"). Fallbacks go "typically from one `model_name` to another `model_name`" (reliability doc, intro).
- So LiteLLM has two levels: group = role (alias), deployment = one concrete provider/account/endpoint. Failover has three separate operations: sibling retry inside the group, `order` failover to a later order level, and cross-group fallback (reliability doc, "Context error fallback precedence").

### 1.2 Three fallback kinds + defaults

- `fallbacks` (all other errors, e.g. `RateLimitError`), `context_window_fallbacks` (`ContextWindowExceededError`), `content_policy_fallbacks` (`ContentPolicyViolationError`) (reliability doc, "Explanation"). Same three keys are per-request overridable (`_PER_REQUEST_FALLBACK_CONTROL_KEYS`, `litellm/router_utils/fallback_event_handlers.py:~365-372`).
- Fallbacks are ordered lists: `[{"a": ["b","c"]}]` tries a, then b, then c. `default_fallbacks` is used when a group is misconfigured; a model-specific chain overrides it. Wildcard keys (`"*"`, `anthropic/*`) are supported; a matched chain is terminal (reliability doc, "Setting Fallbacks for Wildcard Models").
- Precedence after a context error: a matching `context_window_fallbacks` chain wins over later `order` levels and generic `fallbacks`; if that chain is exhausted the request errors instead of continuing into generic fallbacks. Table in the reliability doc "Context error fallback precedence". `max_fallbacks` bounds chains.
- Not every 400 falls back: `is_bad_request_without_fallback` (`fallback_event_handlers.py:~263-275`) treats unsupported-params and provider-labelled generic 400s as terminal, while context-window, content-policy and unsupported-endpoint errors stay fallback-eligible.
- `fallback_on_unsupported_params` toggles that behaviour (same function).

### 1.3 Context-window pre-checks

- `enable_pre_call_checks: true` filters out deployments whose declared `max_input_tokens` is below the prompt size _before_ the call; without it, requests reach the provider regardless of size (reliability doc, "Context Window Fallbacks (Pre-Call Checks + Fallbacks)"). `model_info.max_input_tokens` overrides per deployment. Constructor flag at `litellm/router.py:92`; `pre_call_checks(...)` at `litellm/router_api.py:1650`; list of optional checks `OptionalPreCallChecks` at `litellm/types/router.py:194-205` (`prompt_caching`, `router_budget_limiting`, `deployment_affinity`, `session_affinity`, `encrypted_content_affinity`, `enforce_model_rate_limits`, ...).
- Cross-group promotion example: `context_window_fallbacks: [{"small-model": ["large-model","claude-opus"]}]` (same doc).
- Auto Router has an opt-in `enable_context_window_escalation` with `context_window_escalation_buffer: 0.95` (prompt must fit within 95% of the window) that escalates a tier before dispatch (auto routing doc, full config).
- Vision filter runs by default: text-only deployments are removed for image requests; if every deployment is text-only nothing is removed and the provider error is returned (reliability doc, "Vision Capability Filtering").

### 1.4 Cooldowns and retries

- Settings: `allowed_fails` ("cooldown a deployment once it fails more than N calls within cooldown_time"), `cooldown_time` (seconds), `num_retries`, `request_timeout` (reliability doc "Fallbacks + Retries + Timeouts + Cooldowns"). Defaults in `litellm/constants.py`: `DEFAULT_COOLDOWN_TIME_SECONDS = 5` (:160), `DEFAULT_FAILURE_THRESHOLD_PERCENT = 0.5` (:151), `DEFAULT_FAILURE_THRESHOLD_MINIMUM_REQUESTS = 5` (:224), `DEFAULT_MAX_RETRIES = 2` (:144).
- Which statuses cool down: `_is_cooldown_required` (`litellm/router_utils/cooldown_handlers.py:276-330`): 429, 401, 402, 408, 404 and all non-4xx cool down; other 4xx do not; `APIConnectionError` text never cools down.
- Default cooldown decision (`_should_cooldown_deployment`, `cooldown_handlers.py:479-560`): 429 in a multi-deployment group cools down immediately; otherwise failure _rate_ in the current minute (>50% with >=5 requests; 100% with a lower traffic floor) triggers it; per-deployment `allowed_fails_policy` overrides router-level; a lone deployment with no fallback and a 402 is not cooled down.
- Retry policy per error class: `RetryPolicy` (`litellm/types/router.py:175-191`) has `BadRequestErrorRetries`, `AuthenticationErrorRetries`, `TimeoutErrorRetries`, `RateLimitErrorRetries`, `ContentPolicyViolationErrorRetries`, `InternalServerErrorRetries`, `ServiceUnavailableErrorRetries`, `NotFoundErrorRetries`, `DefaultRetries`. Cooldown also has per-error-class `allowed_fails_policy`.
- If every deployment in a group is cooling down, a fallback may target a specific deployment `model_info.id`, which skips cooldown checks (reliability doc, "Fallback to Specific Model ID").

### 1.5 Routing strategies

`RoutingStrategyName` (`litellm/types/litellm_params.py:46-54`): `simple-shuffle` (default; weighted by `rpm`/`tpm`/`weight`, routing doc: "We recommend ... simple-shuffle"), `least-busy`, `usage-based-routing`, `usage-based-routing-v2`, `latency-based-routing` (`lowest_latency.py`; for streaming, time to first token; `lowest_latency_buffer` default 0; ttl 1 h, lines :35-36), `cost-based-routing` (`lowest_cost.py`, uses `litellm.model_cost` input/output per-token rates), `lar1`. Also `rpd`/`tpd` daily limits enforced via `enforce_model_rate_limits`.

### 1.6 Budgets and tag routing

- Three budget scopes in `router_settings`/`litellm_settings` (budget routing doc): provider budget (`provider_budget_config`, e.g. `openai: {budget_limit: 100, time_period: 1d}`), per-deployment/model budget (`max_budget` + `budget_duration` in `litellm_params`), tag budget (`tag_budget_config`, Enterprise). Routing skips over-budget providers; all over budget -> 429 "No deployments available - crossed budget". Redis is required to share spend across instances. Implementation: `litellm/router_strategy/budget_limiter.py` (`RouterBudgetLimiting`, :149).
- Key/team budgets are enforced at auth time, _against the requested model_. Because a zero-cost primary is exempt, LiteLLM re-checks key and user budget against every fallback target before trying it; over-budget targets are skipped and the caller gets the primary's own error (reliability doc, "Enforce Budget on Fallbacks"). Same for model access: `enforce_fallback_model_access` (default on) skips fallback targets the caller cannot call ("Enforce Key Model Access on Fallbacks"). If the lookup fails the fallback is skipped, not allowed.
- Tag routing: deployments carry `tags`; request `tags` (body or `x-litellm-tags`) filter candidates under `enable_tag_filtering: true`; `default` tag catches untagged requests; `!tag` negation excludes (tag routing doc).
- `disable_fallbacks: true` per request or per key (reliability doc "Disable Fallbacks"), also covers the mid-stream fallback.

### 1.7 Reasoning/tool history on fallback (important for C3)

The reliability doc states: a fallback to a deployment on another provider or API key cannot decrypt encrypted reasoning produced earlier (Responses API `reasoning.encrypted_content`, or `/v1/messages` thinking blocks). LiteLLM _drops what the target cannot decrypt_, keeps each Responses reasoning item's readable summary, drops a thinking block whole, and the target reasons fresh. It happens on every fallback type including a stream that broke mid-stream; there is no per-deployment switch. `encrypted_content_affinity` (`litellm/router_utils/pre_call_checks/encrypted_content_affinity_check.py:7`, :273) tags each reasoning item with the deployment that produced it and avoids the first failed call (`invalid_encrypted_content`) when dispatch goes straight to a different order level. Doc: reliability page, paragraph after "There are 3 types of fallbacks".

### 1.8 Spend attribution on fallback

Spend rows record `attempted_fallbacks` (int) and `original_model_group` in metadata; the row's `model_group` is the model that served (reliability doc, "Track Fallbacks in Spend Logs"). Response header `x-litellm-model-id` names the serving deployment; `x-litellm-attempted-fallbacks` exists (same doc).

### 1.9 Auto Router (decision/complexity routing)

Beta, v1.94+ (auto routing doc). Classifiers: heuristic scorer (7 weighted dimensions, sub-ms, boundaries `simple_medium 0.15 / medium_complex 0.35 / complex_reasoning 0.60`), LLM classifier through the same Router (so budgets/fallbacks apply), JEV (TypeSafe System One Choice question with tier descriptions as `criteria`), keyword rules, custom plugin. Tiers `SIMPLE/MEDIUM/COMPLEX/REASONING` each map to a model, a random pool, or a Thompson-sampled pool (`adaptive: true`). Classifier failure falls back to the heuristic or `complexity_router_default_model`. Opt-in `session_affinity` pins a session to its first-turn model to keep the prompt cache; `classification_mode: user_turn` classifies only new user asks. Decisions log `cause`, `classifier_probabilities`, `classifier_confidence`, `classifier_cost`; classifier spend is logged as a separate row. JEV default timeout 3000 ms with a process-local circuit breaker (30 s cooldown). Source dirs: `litellm/router_strategy/{complexity_router,auto_router,adaptive_router,quality_router}`.

---

## 2. OpenRouter

Docs: <https://openrouter.ai/docs/guides/routing/model-fallbacks>, <https://openrouter.ai/docs/guides/routing/provider-selection>, <https://openrouter.ai/docs/guides/routing/routers/auto-router>, <https://openrouter.ai/docs/guides/routing/routers/jev-router>.

- `models: []` is an ordered priority list; the next model is tried on any error: context-length validation errors, moderation flags, rate limiting, downtime (model-fallbacks doc, "Fallback behavior"). Billing uses the model that actually served, returned in `model`; a `:free` model followed by a paid one is billed at the paid price. Anthropic Messages endpoint accepts `fallbacks` (max 3, entries only `model`, per-attempt overrides rejected with 400, cannot combine with `models`).
- `provider` object (provider-selection doc, table): `order`, `allow_fallbacks` (default true), `require_parameters`, `data_collection`, `zdr`, `only`, `ignore`, `quantizations`, `sort` (`price|throughput|latency`, or `{by, partition}`), `preferred_min_throughput`, `preferred_max_latency` (soft preferences, never block), `max_price` (hard: blocks the request when no provider meets it).
- `sort.partition`: default `model` groups endpoints by model so the primary's endpoints are tried first; `none` sorts across all `models` globally (provider-selection doc, "Advanced Sorting with Partition").
- Default routing (no preferences): weights by effective price, throughput, TTFT, 429 rate, reliability, tool-call quality; providers near the best share traffic randomly; a provider with far worse errors gets none; follow-up requests stick to the same provider while the prompt cache is warm (provider-selection doc, "Default Routing"). `:nitro` = throughput sort, `:floor` = price sort (shortcut variants; superset of `sort`, also make priority/flex service tiers eligible).
- Auto Router `openrouter/auto`: the current docs say a fast _decision model_ rates eleven aspects of the request (task type, difficulty, speed need, vision, codebase knowledge, ...) and a routing policy picks model _and reasoning effort_ within a `cost_tier`; narrows the pool by guardrails/ZDR/BYOK/`allowed_models`/`excluded_models` first; opt-in `X-OpenRouter-Metadata: enabled` returns `resolved_models`, `candidates` (effort, estimated cost), `reason` (auto-router doc, "How it works"; jev-router doc, "Seeing what the router did"). **The task brief says Auto Router uses NotDiamond: the current OpenRouter docs do not mention NotDiamond at all (grep of the auto-router page: no match). Treat the NotDiamond claim as outdated/[unverified]**; the page now names "Jev" (TypeSafe's decision model) behind `typesafe/jev-router` and `<author>/auto` aliases.
- Session stickiness is explicit: the router "is restrained about" switching because a model switch rebuilds the prompt cache; it prefers an effort change; session recognized by `session_id` or a message fingerprint (auto-router doc, "Session stickiness").
- Include lists are _preferences with fallback_ (relaxed only if the pool is empty); `excluded_models` is hard; an include list matching no catalog model is a 404 and never relaxed (jev-router doc "How the lists apply").

---

## 3. Vercel AI Gateway and AI SDK

Docs: <https://vercel.com/docs/ai-gateway/models-and-providers/provider-options>, <.../model-fallbacks>, <.../session-affinity>, <https://ai-sdk.dev/docs/reference/ai-sdk-core/custom-provider>, <https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry>.

- Gateway `providerOptions.gateway`: `order` (preferred providers, can still fall back), `only` (hard filter, never fails over outside it), `sort` (`cost|ttft|tps`), `models: [...]` (model fallbacks, tried on failure/unavailability), `sessionId`, `sessionAffinity`, `caching: 'auto'`, per-provider timeouts for fast failover (provider-options doc).
- Default routing orders providers by model priority adjusted for recent uptime and latency and fails over to other providers of the same model (provider-options doc, "Provider filtering, ordering, and sorting").
- Session affinity (on by default for chat): pins provider (and exact credential when the caller sent a session ID) per model, up to eight pinned models per session; a failed request removes only that model's pin; on model fallback the model that served is pinned and other pins kept; "AI Gateway can't move a cache from one model to another" (session-affinity doc, "Keep caches warm across models").
- Decision fallbacks: conditional fallback reruns a _successful_ decision request when a confidence or Boolean-probability condition matches (model-fallbacks doc intro; separate doc `decision-fallbacks`, not read, [unverified] beyond this summary).
- AI SDK `customProvider({languageModels, fallbackProvider})` maps ids to models (aliases, per-alias default settings via `wrapLanguageModel` + `defaultSettingsMiddleware`, e.g. a `...-reasoning-high` alias); `createProviderRegistry` resolves `providerId:modelId` strings and accepts `languageModelMiddleware` applied to every model (custom-provider and provider-registry docs). **Neither does failover**: customProvider doc states for decision aliases "model failures ... do not trigger substitution", and no fallback option exists on either API. Failover is gateway-side (above).
- AI SDK docs also expose experimental _decision models_ with aliases and registries (`decisionModels` in `customProvider`, `decisionModel('provider:model')` on the registry) (same pages). [unverified] whether the API is stable.

---

## 4. Learned routers: RouteLLM and Not Diamond

### 4.1 RouteLLM (lm-sys/RouteLLM @ 0b64fda; paper arXiv 2406.18665, ICLR 2025)

- Binary routing between one strong and one weak model. A router implements `calculate_strong_win_rate(prompt)`; if the win rate exceeds the request's cost threshold the strong model is used (README "Adding a new router"; `routellm/routers/routers.py:32-50`). The threshold rides in the model name `router-[name]-[threshold]` (README "Server").
- Routers: `mf` (matrix factorization over embeddings of prompt; recommended; `MatrixFactorizationRouter`, `routers.py:210-245`, `text_dim=1536`, so OpenAI `text-embedding-3-small` embeddings), `sw_ranking` (similarity-weighted Elo over Arena battles; calls the OpenAI embeddings API per prompt, `routers.py:177-190`), `bert` (BERT classifier), `causal_llm` (LLM classifier), `random` (README "Routers").
- Inputs: only the prompt text. Controller routes on the _last message_ only; code comment: "Our current routers were only trained on first turn data" (`routellm/controller.py:~108-112`). No tool, history, or price inputs; the model pair is fixed by the caller.
- Training/eval: trained on Chatbot Arena human preference data augmented with GPT-4-as-judge labels; benchmarks MMLU, GSM8K, MT-Bench; paper reports cost reduction "by over 2 times in certain cases" without losing quality, plus transfer to other strong/weak pairs without retraining (arXiv abstract; README "Routers"). Paper metrics are CPT(x%) (minimum strong-model calls to reach x% of strong-model quality) and APGR (search snippet of arXiv HTML; exact definitions not re-read, [unverified]).
- Threshold calibration is quantile-based: `threshold = quantile(win_rates, 1 - strong_model_pct)` over a calibration set (`routellm/calibrate_threshold.py:~58-63`; README example: 50% strong calls -> threshold 0.11593 for `mf` on Arena data). README warns that the realised split differs on real traffic, so calibrate on data resembling production.

### 4.2 Not Diamond

- Docs: <https://docs.notdiamond.ai/docs/what-is-model-routing>, <https://docs.notdiamond.ai/docs/router-training-quickstart>.
- Predicts, per query, which candidate LLM gives the best response; modes: quality (default), cost, latency (what-is-model-routing). Pre-trained "Chat" and "Code" routers plus custom routers.
- Custom router training inputs: (1) prompts, (2) each candidate model's responses, (3) numeric evaluation scores per response; min 15 samples, up to 5 MB or 10,000 samples per job; training takes minutes to an hour; `preference_id` identifies the router; updating needs `override=True` (router-training-quickstart). Selection call: `model_router.select_model(messages, llm_providers, preference_id)`; returns a session id.
- Internals (embeddings, architecture, evaluation protocol) are not documented on these pages: [unverified].

---

## 5. oh-my-pi deltas (beyond the #1612 summary)

All paths under `packages/coding-agent/src` at 88a6958 unless noted.

### 5.1 Roles

- Selector sigil: `@role` (canonical), legacy `pi/`, `*` = default role (`config/model-roles.ts:18-26`).
- Each role has an `accepts(model)` predicate over catalog _model kind_ (`chat`, `tiny`, `search`, `judge`, `image`, `tts`, `stt`): e.g. `tiny` accepts `tiny|chat`, `web` accepts `search` or chat with `webSearch`, `judge` accepts `judge|tiny|chat`; roles sit in a `chat` or `kind` section (`config/model-roles.ts:37-84`). `roleCandidatePool` = available models filtered by `accepts` (`:103-105`). So the role set is typed by capability, not just by name.
- Built-in roles: default, smol, slow, vision, plan, commit, tiny, memory, task, advisor, widget, image, web, speech, dictation, judge (`config/model-roles.ts:57-84`); extra custom roles come from `cycleOrder`, assignments, and `modelTags` (`getKnownRoleIds`, `:107-`).
- `cycleOrder` (default `["smol","default","slow"]`, `config/model-settings.ts:32,135`) is the carousel for the cycle key; `session.cycleRoleModels(cycleOrder, direction)` (`modes/controllers/input-controller.ts:3044-3045`). UI-only; not a routing input.
- `modelPresets.<name>` = a named snapshot of all `modelRoles` plus `defaultThinkingLevel`; saved in global config, project config may define presets (listed/applied, never copied to global); same-name entries do not merge; roles still owned by another config layer are reported back instead of silently kept (`config/model-presets.ts:1-18, 53-60`).
- Per-agent overrides: agent definition frontmatter `model: "@slow"` / `"@smol"` (`prompts/agents/reviewer.md:6`, `scout.md:5`) and setting `task.agentModelOverrides` (`task/settings.ts:~593`, `task/structured-subagent.ts:558-600`). A per-call `model` on spawn that conflicts with an `agentModelOverrides` entry is an error (`structured-subagent.ts:403`). Per-call model needs grants (`perCallModelGrants`, `task/executor.ts:4650-4700`, `assertPerCallModelApproved`); with grants only exact selectors resolve (`exactOnly: true`, :4675).
- A subagent started with a per-call model never switches to a retry-fallback model (`modelFallbackDisabled`, `session/turn-recovery.ts:278`; also gates context promotion, `session/session-maintenance.ts:~3600`).

### 5.2 How a model switch is communicated to the model

- A switch writes a `model_change` session entry `{model, role?, resolvedModelIsFallback?}` (`session/session-entries.ts:148-155`). Context building uses it only to mark a cache reset for transcript display (`session/session-context.ts:317, 373-389`: `pendingReset`, `cacheMissExplained`). The branches that push messages into model context handle `message`, `custom_message`, `branch_summary`, `compaction` only (`session-context.ts:~420-440`): **no model-visible message announces a model change** [inference from reading those branches; no other emitter found by grepping "model changed/switched" across `packages/*/src`]. The model's own name appears via the system-prompt template `{{#if model}}- Model: {{model}}{{/if}}` (`prompts/system/project-prompt.md:4`), and a fallback swap re-syncs the base system prompt only if edit mode changed (`session/turn-recovery.ts:2265, 2276`, `syncAfterModelChange(..., {retryFallback:true})`).
- User-facing narration instead: event `retry_fallback_applied {from,to,role,reason}` (`turn-recovery.ts:2278`), `retry_fallback_succeeded`, and a retry note on the failed assistant message: "rate-limited; switched model; retried" (`turn-recovery.ts:967-985`).
- Codex CLI is the contrast (section 8): it injects a developer-role message.

### 5.3 Retry/fallback mechanics (additions to #1612's summary)

- Switch point is the _turn_: on a terminal failure the failed assistant message is flagged `retryRecovery` and _excluded from model context_ (`session-context.ts:423-428`: skipped unless `transcript` mode and `message.retryRecovery || isEmptyErrorTurn`), then the whole turn re-runs on the next candidate (`applyRetryFallbackCandidate`, `turn-recovery.ts:2200-2290`). Unexecuted tool calls from the failed turn may be kept when `#unexecutedToolCallsReplaySafe` (`turn-recovery.ts:2698-2701`, `preserveFailedTurn`, issue #8065 comment at :2406).
- Candidate filters: skip suppressed (cooldown) selectors, skip candidates whose context window cannot hold the retry context (`contextFitsModel`, `turn-recovery.ts:2405`), skip candidates whose effort floor exceeds the session ceiling (`:2400`), refusal walks visit each model at most once per turn (`:2330-2336`), a candidate resolving to the same model+effort as the failing one is not a switch (`:2338-2345`).
- Cooldown: `modelRegistry.suppressSelector(selector, now+cooldown)`; if the provider gives no `retry-after`, unknown reasons get 5 minutes, known rate-limit reasons use `calculateRateLimitBackoffMs` (`turn-recovery.ts:1893-1899`). Revert policy `never | cooldown-expiry` (`retry-fallback-chains.ts:~30`, `turn-recovery.ts:802-808, 2566`). Chain-key lookup by specificity: exact selector, `provider/*`, role whose assignment matches, `default` (`turn-recovery.ts:~1905`).
- **Signed-thinking deferral**: when the failing turn replayed thinking signed by model M and M still has retry budget, omp defers falling to a sibling Anthropic candidate (it would lose the signed chain) and retries M first; the deferral is skipped for refusals, non-retryable errors, spent budget, or `retry.rateLimitWalksChain` rate limits (`turn-recovery.ts:2313-2321, 2702-2708, 3013`).
- Context promotion: `#promoteContextModel` switches (`setModelTemporary(target, {ephemeral:true})`) to the model's `contextPromotionTarget` only if enabled, the failing turn belongs to the current model, and the target window is strictly larger (`session/session-maintenance.ts:3578-3620`; setting `contextPromotion.enabled` at `session/context-settings.ts:77`; field `contextPromotionTarget` at `config/model-registry.ts:4372`). The switch is `ephemeral` and used from both overflow and pre-prompt threshold paths.

### 5.4 Reasoning and tool-call history across wires (`packages/ai/src/providers/transform-messages.ts`, `packages/ai/src/dialect/demotion.ts`)

- One conversion function (`transformMessages`, `:875`) runs on the stored history for the _target_ model at request time. Stored transcript is never rewritten for a switch.
- `isSameModelTurn` (provider+api+model all equal) decides native reasoning replay (`:524`). Other-model turns: opaque payloads (thinking signatures, redacted thinking) are dropped on directly-encoded wires; Anthropic-messages -> Anthropic-messages may keep them depending on deployment (`dropsForeignReasoningPayload`, `:563-571`; `DIRECT_REPLAY_APIS` table `:536-555`).
- Same model on another host: `carriesReasoning` + a target native reasoning slot lets plaintext reasoning replay natively (`:910-930`); errored turns keep the text fallback.
- Anthropic signature policy (`:940-985` comments): first-party deployments accept same-deployment cross-model signatures and drop blocks the target cannot read; signatures are stripped when crossing a signing-endpoint boundary (official source or signing target, avoids `400 Invalid signature in thinking block`, #4297); 3p<->3p keeps them as opaque hints (#2265).
- Otherwise reasoning is _demoted to text_: `renderDemotedThinking` (`dialect/demotion.ts`): Anthropic-dialect targets get bare prose (tagged `<thinking>` replay trips Anthropic's `reasoning_extraction` classifier), Harmony/Gemma get `<think>` blocks, other dialects use their own inline-safe form. Comment records that Gemini silently discards a replayed unsigned thought part.
- Tool-call ids: `normalizeToolCallId` (`^[a-zA-Z0-9_-]{1,64}$`, `:44-52`); duplicate-id suffixing (`_dup`); Responses composite `call_id|item_id` canonicalised by `call_` part for cross-provider pairing (`:61-110, 227`); malformed tool calls (bad id/name for the target) and their results dropped before replay (`sanitizeMalformedToolCalls`, `:420`); synthetic aborted results for unresolved calls (`ToolCallStatus.Aborted`, `:35-39`).
- Prefix-bound thinking (`model.thinking.prefixBinding`): assistant turns older than a history rewrite/prune are invalidated (`:~905-925`).

---

## 6. OpenClaw (@ d40aa7c; docs `docs/concepts/model-failover.md`, `docs/concepts/models.md`, `docs/concepts/decision-models.md`)

- Two stages: (1) auth-profile rotation inside the current provider, (2) model fallback along `agents.defaults.model.fallbacks` (model-failover.md:1-12). Per-agent `agents.entries.*.model`; an agent primary is _strict_ unless it has its own `fallbacks` (`[]` makes strictness explicit) (model-failover.md "Selection source policy").
- **Selection source decides whether failover may happen**: configured default (chain allowed), native agent primary (strict unless fallbacks set), auto fallback (temporary, `modelOverrideSource: "auto"`, re-probed every 5 min), user session selection via `/model`/picker/`sessions.patch` = strict (fails visibly rather than answer from another model), cron payload model (job primary with fallbacks unless `payload.fallbacks: []`). Selecting the agent default clears the pin (models.md "Selection source and fallback strictness").
- Fallback does not change the session's selected model: "Fallback execution does not write model-selection fields"; most fallbacks apply to the current turn only; eligible rate-limit fallbacks stay first for later turns via in-memory _session stickiness_, because "Switching models mid-session discards the provider prompt cache" (model-failover.md "Rate-limit fallback stickiness"). Selected vs answering model are distinguished in `/status` and transition notices.
- Aliases: `agents.defaults.models` stores `alias` + per-model settings (`"anthropic/claude-sonnet-4-6": {alias: "Sonnet"}`); aliases cannot redirect an explicit provider ref; `modelPolicy.allow` (exact refs, `provider/*`, `family-*`) is the _override allowlist_, per-agent allowlist replaces default; explicit fallbacks are _not_ filtered by the allowlist ("explicit operator intent") (models.md "Selection order", "Candidate chain rules").
- Auth profiles: `provider:default` or `provider:<email>`; rotation order = stored override, `auth.order[provider]`, configured, stored; default round-robin by type (OAuth, token, API key) then least-recently-used; cooldown/disabled last. Auto-chosen profile is _pinned per session_ for cache warmth; user pin (`/model ...@profile`) survives reset and rotation (model-failover.md "Rotation order", "Session stickiness").
- Cooldowns: rate limits cool down _only for the provider-reported duration_ ("OpenClaw does not invent rate-limit cooldowns"; `Retry-After`, `retry-after-ms`, retry text, Google `RetryInfo`); non-rate-limit failures back off 30 s / 1 min / 5 min by recent error count; billing and permanent-auth failures disable the credential for 10 min; cooldowns can be model-scoped (`cooldownModel`) so a sibling model on the same profile is still usable; persisted as `usageStats` in per-agent SQLite (model-failover.md "Cooldowns", "Billing disables").
- Temporary 402 usage-window / spend-limit messages are classified `rate_limit`, not billing, when retryable ("weekly usage limit exhausted") (model-failover.md note under "Billing disables").
- Same-model bounded recovery runs _before_ rotation/fallback, on the existing transcript: partial output and completed work are preserved, "The agent is instructed to inspect interrupted actions before deciding whether to repeat them" (model-failover.md opening). Rotation/fallback require evidence the replay is safe (committed side effects block it). Only explicit status/classification advances failover; local errors (transcript conflicts, local deadlines/capacity) never trigger fallback (model-failover.md "Runtime flow" and following paragraphs).
- Cost: "Turn usage includes completed model candidates even when their answer is discarded during fallback"; if any candidate's price is unknown the total stays unknown (model-failover.md, 4th paragraph).
- Context overflow fallback: after compaction/oversized-result recovery fails, candidates with known sufficient context are preferred; a visible warning is emitted; not allowed after committed tool effects (model-failover.md "Candidate chain rules" / "Which errors advance fallback").
- Fallback requests "reuse the original user turn and its attachments exactly once"; fresh plugin context for the fallback model is added separately, preserving the prefix already sent (model-failover.md "Use fallback for the current turn" section). Whether the _model_ is told it is a fallback: not stated [unverified].
- User replies announce fallback transitions and recovery once per state change; group channels keep lifecycle events but no post (model-failover.md "Session overrides and live model switching").
- Docs warn that a mid-session switch can reduce continuity, force earlier compaction, lose cache; "Retained reasoning is model-bound on current Claude models" (models.md "Choose a model for a session").
- Decision models: `decisionModel` is a separate role with a typed-answer API (choice/score/boolean probability), separate picker, "never appear in chat, primary, fallback, or utility choices" (models.md selection list; decision-models.md intro).
- `agents.defaults.utilityModel` = cheap model for titles/summaries, accepts `{primary, fallbacks}` (models.md).
- Plugins can return `fallbacksOverride` from `before_model_resolve` per run, including `[]` (model-failover.md "Candidate chain rules").

---

## 7. Claude Code (docs fetched 2026-11-07)

- Subagent `model` frontmatter: alias (`sonnet|opus|haiku|fable`), full id, or `inherit`. Resolution order: per-invocation `model` param (alias only, no full id), definition `model`, `CLAUDE_CODE_SUBAGENT_MODEL`, main model (sub-agents doc, "Choose a model"). `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` makes the env var override all. Blocked by `availableModels` -> newest permitted family version, else inherited model, with a warning naming both. `/tasks` shows each subagent's model. Subagents inherit the main thinking config (v2.1.198+).
- `/model` switches reach subagents that inherit (model-config.md "Setting your model"). Switching models is confirmed when the cache is warm; each model has its own cache; `opusplan` toggles Opus (plan) / Sonnet (execute) so each plan toggle is a model switch (prompt-caching.md "Switching models"; model-config.md "`opusplan` model setting").
- Failover: `--fallback-model sonnet,haiku` or `fallbackModel: [...]`; triggers on overloaded/unavailable/other non-retryable server errors; never on auth, billing, rate-limit, request-size, transport, or org policy denial; switch lasts for the current turn only; max three entries; entries outside `availableModels` dropped; compaction will not fall back to a _smaller_ context window; chain also applies to subagents while the session's model is unchanged (model-config.md "Fallback model chains").
- Content-based fallback (safety classifier flag): re-runs the request on a category-specific fallback model, **the session continues on the fallback**, a notice is shown, "Ask before switching" available (`switchModelsOnFlag`), effort level carries over (model-config.md "Automatic model fallback").
- `PreModelSwitch` hook can block or confirm a requested switch (model-config.md "Setting your model").
- Anthropic-side: advisor tool is an alternative to switching ("Claude decides mid-task when to consult a second model"; model-config.md opusplan section end).

---

## 8. Codex CLI (openai/codex @ d92aae5)

- `spawn_agent` takes optional `model` and `reasoning_effort`; spawned agents inherit the parent's model by default ("Do not set the `model` field unless the user explicitly asks", `codex-rs/core/src/tools/handlers/multi_agents_spec.rs:17-18`). Overrides are validated against the _picker-visible_ catalog; unknown model -> error "Unknown model `X` for spawn_agent. Available models: ..." (`core/src/agent/child_config.rs:327-352`). Reasoning effort validated against the model's supported efforts (`child_config.rs:354`).
- **Assistant-visible model catalog (direct C7 prior art)**: `ModelCatalogState` renders a `<model_catalog>` developer message listing "- `slug`: description Reasoning efforts: low, medium (default). Service tiers: ..." capped at 5 models (`MAX_SPAWN_AGENT_MODEL_OVERRIDES = 5`, `child_config.rs:22`), 250 chars per description, <=1,000 rendered bytes, sorted by slug for stability, XML-escaped, with "Additional model choices omitted." (`core/src/context/world_state/model_catalog.rs:19-100`). Refresh never rewrites earlier messages; an empty catalog emits "The previous spawn_agent model catalog no longer applies." (:122-130). When `model_catalog_in_context` is false the same list is put in the tool description instead (`multi_agents_spec.rs:71-96`).
- **Model-switch narration to the model**: world-state section compares previous vs current model; on change emits a developer-role fragment `<model_instructions>`: "The current model is {model}." plus "The following instructions replace the previous base instructions: ..." or "The previous base instructions no longer apply" (`core/src/context/model_instructions.rs:33-57`, `world_state/model.rs:95-140`). Older fragment `<model_switch>`: "The user was previously using a different model. Please continue the conversation according to the following instructions" (`core/src/context/model_switch_instructions.rs:36-41`). The old model name is not sent, only the new one. Announcement can be suppressed (`suppress_model_change_announcements`, `model.rs:~124`).
- Cross-wire reasoning handling is not applicable (Codex talks one wire family): reasoning-on-switch behaviour [unverified]. HTTP chaining by `previous_response_id` is invalidated on `model_changed` (first branch in the reason chain, `core/src/client.rs:465-466`).
- No documented automatic failover across models in the files read [unverified; not exhaustively searched].

---

## 9. Implications for llame

Format: what the prior art gives, per C-item. These are inputs for grilling Q1/Q2/Q6, not decisions.

### C1 (#1605 providers = vendor accounts, wire per model)

- LiteLLM's model: alias (group) -> deployments; deployment carries credentials, `max_input_tokens`, price, tags, `order`. llame's "provider entry per vendor account + per-model wire" matches the deployment level; roles/aliases (C2) sit above it. Keep a per-model `max_input_tokens`/window override (LiteLLM `model_info.max_input_tokens`) for C4.
- OpenClaw/omp key per-account state (cooldown, disabled-until) by credential/profile, and optionally by model (`cooldownModel`). Wire choice must be known at failover time because replay rules depend on wire (section 5.4, 1.7).
- Both LiteLLM and omp track spend per model actually served; both require a price on the _serving_ model (LiteLLM re-checks budget on fallback; OpenClaw says unknown price makes the total unknown).

### C2 (roles, persisted requested selector + resolved model)

- Selector grammar prior art: omp `@role` sigil plus raw `provider/model`, `*` default; OpenClaw alias + `provider/alias`; LiteLLM plain `model_name`; AI SDK `providerId:modelId`. All distinguish "requested" from "served": LiteLLM `original_model_group` + `model_group`, OpenClaw selected vs answering model, omp `model_change.resolvedModelIsFallback`, OpenRouter returns served `model`. llame's `requested selector + resolved model per request` follows the same split.
- **Selection source matters**: OpenClaw makes a user-picked non-default model strict (no failover) while a configured default may fail over; omp excludes per-call-model subagents from fallback. A role-vs-explicit-model distinction on the Run (Q1) maps onto this. [Design choice for Leo; both systems chose "explicit pick = strict".]
- Typed roles: omp `accepts(kind)` stops a `tiny`/`judge`/`web` role from being assigned a model of the wrong kind; llame already has decision models and rerank models as separate id namespaces, so role -> allowed model kinds is reusable (rerank/decision/chat).
- Presets (omp `modelPresets`): a named snapshot of all role assignments; owner/project layering rule "same-name entries never merge; layer owning the name wins; roles owned by another layer are reported" is a ready answer for Q6 layering.
- Persisting model per request, not only per Run, is necessary because fallback (C3) and promotion (C4) can change it within a Run (omp: `model_change` entry per switch; LiteLLM: metadata per call).

### C3 (failover chains)

- Trigger classes: Claude Code excludes auth/billing/rate-limit/size/transport; OpenClaw includes auth, rate limit, overloaded, timeout, billing, model-not-found and excludes local errors, aborts, and anything after committed side effects; LiteLLM includes everything except unsupported-param 400s and treats 429/401/402/408/404/5xx as cooldown-worthy. llame's trigger set (unavailable, rate limited, quota, auth) is a subset of these; the notable additions in prior art are **replay-safety gating** (OpenClaw) and **excluding local failures** (OpenClaw).
- Cooldown: provider-reported duration only (OpenClaw), failure-rate window (LiteLLM, >50% of >=5 requests/min), fixed default 5 min for unknown (omp), 5 s default (LiteLLM constant). Per-model scoping (OpenClaw) avoids benching a whole account for one model's limit.
- Switch point: all of omp, OpenClaw and Claude Code switch at a _turn/request_ boundary and re-run the whole request; LiteLLM also handles a stream that dies before first chunk. None resumes a half-streamed answer on another model. That matches C3's "never mid-stream".
- **Reasoning/tool history across wires** (the key safety fact): the stored transcript must stay wire-neutral and be re-encoded for the target at each request, as in omp `transformMessages`. Required operations seen in source: drop opaque signed/encrypted reasoning when producer != target (omp `dropsForeignReasoningPayload`; LiteLLM strips undecryptable reasoning, keeps summaries), optionally demote readable reasoning to text (omp; per-dialect form, bare prose for Claude targets), re-id tool calls to the target's id grammar and pair results, drop calls the target cannot replay, synthesise aborted results for unresolved calls (omp). LiteLLM adds an _affinity_ pre-check so an `order` hop avoids the first failing call. Without this, `invalid_encrypted_content` / `Invalid signature in thinking block` 400s occur (both projects cite them).
- **Fallback loses the prompt cache**: OpenClaw sticks a rate-limit fallback for later turns to avoid ping-pong; Vercel pins one provider per model and keeps up to eight pins; OpenRouter auto-router restrains switching. A llame chain therefore needs a "stay on the fallback until cooldown expiry" rule (omp `revert policy cooldown-expiry`, OpenClaw stickiness) rather than retrying the primary every turn.
- Do not defer to a sibling when signed thinking would be lost and the signer can still retry (omp, section 5.3) — relevant because llame Anthropic client currently uses no SDK retry.
- Cost: failed/discarded attempts still bill (OpenClaw counts "completed model candidates even when their answer is discarded"); LiteLLM logs `attempted_fallbacks`. Feeds F2 entry kinds.
- Paid-after-free: LiteLLM's budget re-check on fallback targets (and zero-cost primary exemption bug it fixes) and OpenRouter's "billed at the model that served" show the failure mode to guard: a free primary that falls to a paid model bypasses caps unless the fallback is checked. Supports llame's explicit per-chain paid opt-in.
- Access control on targets: LiteLLM skips fallback targets the caller cannot call; Claude Code drops chain entries outside `availableModels`; OpenClaw does NOT filter explicit fallbacks by allowlist ("explicit operator intent"). Decide which (Q6).
- Cap chain length: Claude Code 3, OpenRouter Anthropic-messages `fallbacks` 3, LiteLLM `max_fallbacks`.

### C4 (context promotion)

- Pre-call check is the distinguishing design: LiteLLM `enable_pre_call_checks` + `context_window_fallbacks`, with a 0.95 fit buffer in Auto Router; omp promotes both on overflow error and on the pre-prompt threshold path; OpenClaw only after compaction fails; Claude Code forbids compaction fallback to a smaller window.
- Promotion is a _model switch_ for cache/reasoning purposes; same transcript re-encode rules as C3 apply; omp makes it `ephemeral` (does not rewrite the persisted selection).
- Strictly-larger-window requirement and "failing turn must belong to the current model" guard (omp) prevent promoting on a stale error.
- A matching context chain should be terminal for context errors (LiteLLM) so a context failure does not wander into unrelated rate-limit fallbacks.
- Cost guard: LiteLLM `fallback_budget_check` hook and budget re-check; omp has no cost guard (off by default). llame's free-256k -> paid-1M promotion needs the F2 ledger/budget check before the switch.

### C5 (quota awareness)

- OpenClaw: quota windows are modelled as cooldowns with provider-reported reset time; temporary 402 usage-window errors map to rate_limit; ChatGPT quota check can replace a saved reset. LiteLLM: provider/model/tag budgets and `rpd/tpd` are _local_ accounting, not provider telemetry. omp: only coding-plan quota reports trusted. OpenRouter/Vercel health is measured from their own traffic. Local spend accounting (F2) can give budget awareness without provider telemetry; provider telemetry only exists for subscription providers.

### C6 (decision routing)

- Two proven shapes: (a) binary strong/weak with a calibrated threshold (RouteLLM; quantile calibration, prompt-only input, trained on preference data; not robust to multi-turn: last message only); (b) tiered classification into named tiers/pools with a cheap classifier plus deterministic keyword overrides and a hard fallback (LiteLLM Auto Router, OpenRouter Auto/Jev, Not Diamond with per-model scored eval data). Every one of the product routers records the routing cause/probabilities/cost on the response or log (LiteLLM `cause`/`classifier_probabilities`/`classifier_cost`; OpenRouter metadata `reason`/`candidates`).
- Evaluation prior art: RouteLLM benchmark scripts + quantile threshold; Not Diamond requires per-candidate scored responses (>=15 samples); LiteLLM ships a heuristic with documented boundaries and "Test Routing" preview endpoint that classifies without calling the tier. llame's labelled-fixture eval (per #1612) is closest to Not Diamond's training input.
- Session stickiness is a first-class option everywhere routing varies by turn (LiteLLM `session_affinity`/`classification_mode: user_turn`, OpenRouter session stickiness, Vercel pins). Routing once per Run or per user turn, not per step, avoids cache loss.
- Classifier privacy: LiteLLM sends prior turns to the classifier endpoint by default (configurable window/char budget; assistant turns off by default). llame needs the egress rule from the objective-rerank note for any routing model.
- Failure policy: classifier timeout/error -> heuristic or default model (LiteLLM), with a circuit breaker. OpenClaw's `decisionModel` is a separate role never offered as a chat model: matches llame's decisionModels/rerankModels id namespace.

### C7 (assistant-visible catalog, per-call model allowlist)

- Closest prior art: Codex `<model_catalog>` developer message, <=5 models, one line each (slug, 250-char description, reasoning efforts, tiers), stable order, bounded to ~1,000 bytes, append-only refresh, validation against the same picker-visible list with an error that lists the available models (section 8). Claude Code: `Agent` tool `model` param restricted to aliases, plus `availableModels` allowlist with documented substitution when blocked; `/tasks` shows each subagent's model. omp: per-call model needs grants, exact selectors only, conflicts with per-agent overrides are errors.
- Defaults: both Codex and Claude Code default to _inherit_ the parent's model and tell the assistant not to override unless asked; omp can have `@role` in agent frontmatter. llame's allowlist + "inherit unless the operator names a role" matches.
- Show the assistant roles (stable names) rather than raw ids where possible: Claude Code exposes only family aliases to the assistant; omp roles; Codex shows slugs.

### Mid-Run model switch safety (summary of what must hold)

1. Transcript stays wire-neutral; each request re-encodes history for the _served_ model (omp `transformMessages`, LiteLLM fallback stripping).
2. Persist per request: requested selector, served model, reason, attempt index (LiteLLM metadata, omp `model_change`, OpenClaw selected-vs-answering).
3. Drop the failed attempt from model context, keep it in the transcript/ledger (omp `retryRecovery` exclusion; OpenClaw "retried failures do not become persisted assistant messages"; costs of discarded attempts still counted).
4. Gate any cross-model re-run on replay safety: no committed tool side effects from the failed attempt, or tell the model to inspect interrupted actions (OpenClaw).
5. Check the target before switching: window fits (omp `contextFitsModel`, LiteLLM pre-call checks), kind/capability fits (LiteLLM vision filter, omp `accepts`), access and budget (LiteLLM), credential present (omp), same-model-and-effort is not a switch (omp).
6. Keep the fallback sticky until cooldown expiry to protect the cache (OpenClaw, Vercel, OpenRouter).

### Narration (to the model and the owner)

- Owner/UI narration is universal: omp `retry_fallback_applied` event and retry note, Claude Code transcript notice, OpenClaw once-per-state-change notice.
- Narration _to the model_: only Codex does it (developer message "The current model is X" + replaced instructions; new model name only). omp does not (section 5.2; inference). OpenClaw: not stated [unverified]. llame's VISION rule (in-band narration) would be ahead of omp/OpenClaw here; Codex's pattern is the template: one append-only context item at the first request after the change, naming the current model, no rewrite of earlier messages. Whether to include the previous model, the reason (rate limit vs promotion), and a "re-check interrupted actions" instruction is open; OpenClaw's instruction text is the only precedent for the last.
