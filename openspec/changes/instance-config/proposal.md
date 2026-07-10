## Why

Operator/system-wide configuration in llame is a scatter of individual environment variables (`DEFAULT_MODEL_ID`, `TITLE_GENERATION_MODEL_ID`, `COMPACTION_TOKEN_THRESHOLD`, `RUN_MAX_OUTPUT_TOKENS`, `MODEL_CONTEXT_WINDOW_TOKENS`, …). There is no single, version-controllable place for an operator to express how their instance is configured, and no way to keep a JSON structure while still injecting secrets and deploy-time values the 12-factor way. Config-as-code is the mainstream pattern for self-hosted/personal agents (OpenClaw, Claude Code); llame should adopt it for the layer that is genuinely operator-owned.

This change establishes the config-as-code **mechanism** — an optional `llame.config.json` with a strict schema and value interpolation — as the single home for system-wide settings. It is the foundational slice: later changes (model-catalog relocation, per-model defaults) move their operator-owned defaults into this file without re-litigating how operator config is expressed.

Scope note: this is deliberately the _operator_ layer only. Tenant-owned settings (per-user, per-chat) are runtime, concurrent, isolation-critical data and belong in the database under RLS — they are **not** in this change. A prior exploration considered a generic layered "config document" resolver across scopes; it was dropped because every concrete setting resolves differently (models compose by membership **union**; compaction threshold is **per-model**, resolved model-default → user-per-model → per-send) and none fit a generic deep-merge. Those land as their own typed changes; this one ships only the operator file.

## What Changes

- **Introduce `llame.config.json`** (JSONC — comments + trailing commas; default location `apps/api/`, overridable via `LLAME_CONFIG_PATH`) as the optional, version-controllable operator configuration file. When absent, the instance boots on documented built-in defaults; when present-but-invalid, startup fails loudly (never serves on a partial/default config).
- **Value interpolation** inside string config values: `{env:NAME}` (environment variable), `{env:NAME:-default}` (bash/compose-style fallback), and `{path:LOCATION}` (trimmed file contents — Docker/Kubernetes file-mounted secrets). Embedded tokens allowed in string settings; non-string settings take a whole-value token coerced after resolution. `{{` escapes a literal `{`. Required-but-unresolved tokens fail loudly at load; resolved secret values are never logged or echoed.
- **Strict, closed schema, published as JSON Schema.** The schema is authored as a JSON Schema document that is itself the boot validator (editor autocomplete and boot enforcement are the same artifact; a top-level `$schema` key is the sole exemption). Unknown keys and type violations fail at load with the offending path named — a mistyped security-relevant key must never silently no-op.
- **File-over-env precedence.** File wins; the legacy env var is honored only as a fallback (then built-in defaults), so an operator can migrate a setting from env to file with no change in effect.
- **Migrate the shape-stable instance settings**: `defaults.modelId`, `defaults.titleGenerationModelId` (pointers — deliberately not under `models`, which is reserved for the follow-up's catalog list), `runs.{maxOutputTokens, heartbeatSeconds, heartbeatStaleSeconds, timeoutSeconds}`, `http.trustProxy` — env vars keep working as fallbacks/interpolation targets. **Deliberately NOT migrated**: `COMPACTION_TOKEN_THRESHOLD` and `MODEL_CONTEXT_WINDOW_TOKENS` are killed as instance settings (compaction is model-driven — every model declares its context window; threshold resolves model-default → user-per-model → per-send), and `OPENAI_BASE_URL`/`OPENAI_API_KEY` stay in env until the `providers[]` follow-up.
- **Restart-to-apply** semantics: operator config is a deploy-time concern; changes take effect on restart (documented), not via hot file-watching.

## Capabilities

### New Capabilities

- `instance-config`: the operator config-as-code file — its optional presence and defaults, strict typed schema and load-time validation, the `{env:…}` / `{path:…}` value-interpolation primitive (incl. file-secret support and no-secret-logging), and file-over-env precedence.

### Modified Capabilities

<!-- None. Named follow-up changes that CONSUME this mechanism (each amends its own specs):
     1. providers-and-models-as-code — duplicable providers[] ({id, type, key, baseUrl};
        e.g. native OpenAI + Ollama as type:openai + Anthropic) and the model catalog as
        models[] entries superseding the hardcoded model-catalog.ts; OPENAI_BASE_URL /
        OPENAI_API_KEY migrate there; per-model compaction defaults live on the model.
     2. Typed tenant (user/chat) settings storage (DB, RLS) + the per-run settings snapshot. -->

## Impact

- **New operator surface**: optional `llame.config.json` + interpolation loader. `.env.example` and deployment docs updated; the current instance env vars become documented fallbacks/interpolation targets rather than the primary path.
- **Startup path**: config load + validation runs at boot; invalid config fails the boot (a deploy-time failure, the intended fail-loud behavior).
- **No API, no schema/DB migration, no end-user-visible behavior** in this slice — it is purely the operator configuration mechanism.
- **Unblocks (out of scope here)**: model-catalog-as-code relocation (#161 catalog → file), per-model default thresholds, and — separately, on the tenant side — typed user/chat settings and the per-run settings snapshot.
- **Supersedes**: the env-only instance configuration and the generic config-resolver approach explored on `stack/split-config-resolver` (#131), which is not merged.
