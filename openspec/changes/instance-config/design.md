## Context

llame's operator/system configuration is today a scatter of environment variables read ad hoc via `ConfigService` (`app.module.ts` loads `.env.local`; `DEFAULT_MODEL_ID`, `TITLE_GENERATION_MODEL_ID`, `COMPACTION_TOKEN_THRESHOLD`, `RUN_MAX_OUTPUT_TOKENS`, `MODEL_CONTEXT_WINDOW_TOKENS`, `RUN_HEARTBEAT_*`, `RUN_TIMEOUT_SECONDS`, `TRUST_PROXY`). There is no single version-controllable operator surface and no way to combine JSON structure with env/secret injection.

This change is the first slice of a larger configuration rethink. That rethink (grill/explore session, 2026-07-10) concluded there are **two distinct configuration concerns**, and conflating them into one generic layered "config document" resolver was the wrong model:

```
CAPABILITY COMPOSITION ("what can I use")     SETTINGS ("defaults / thresholds")
  models, tools, connectors — SETS             per-model threshold, default model, …
  system ∪ union(memberships) ∪ mine           each has its OWN natural resolution:
  then policy deny-overrides-allow subtracts     threshold = model-default → user-per-model → per-send
  → available-models + policy subsystems         → typed, not a generic deep-merge
```

Neither concern is served by a generic `configs(scope_type, scope_id, jsonb)` table with flat deep-merge — models compose by union (not merge), and thresholds are model-keyed (their default lives on the model definition, not in a config scope). The generic resolver explored on `stack/split-config-resolver` (**PR #131**) is therefore superseded, **not merged** — it is closed when this change's draft PR opens, with a rationale comment linking here. What survives from it as future work: a per-run *settings snapshot* (typed), tenant (user/chat) settings storage in the DB under RLS, and its corrected ancestor-governance RLS policy + regression test (cherry-pick when an org-scoped table next appears).

This change carves out the unambiguous, unblocking piece: **operator/system config as code** — a file with a strict schema and interpolation. Tenant settings stay in the DB (a shared file would break RLS-enforced isolation) and are out of scope.

## Goals / Non-Goals

**Goals:**
- One version-controllable file for operator/system settings, replacing scattered env vars as the primary path.
- Keep JSON structure while supporting env injection and file-mounted secrets, via `{env:…}` / `{path:…}` interpolation.
- Fail loud on any misconfiguration at boot (config-as-code = deploy-time correctness).
- A stable mechanism that follow-up changes extend rather than reinvent.

**Non-Goals (owned by other changes):**
- **`providers[]` + `models[]` as config-as-code** — the dedicated follow-up change (see below), NOT this slice: duplicable provider entries (`{ id, type: openai|anthropic, key: "{env:…}", baseUrl }` — e.g. native OpenAI + Ollama as `type: openai` + Anthropic side by side) and the model catalog as file entries (`{ id, provider → providers[].id, providerModelId, contextWindowTokens (required), pricing, … }`, superseding the hardcoded `model-catalog.ts`). Requires execution wiring (client per provider `type`, incl. an Anthropic adapter; model→provider→client resolution) — a subsystem, not config loading. `OPENAI_BASE_URL` / `OPENAI_API_KEY` stay in env until then.
- Tenant (user/chat) settings storage — DB + RLS, a separate change.
- The per-run settings snapshot and any explain/provenance surface.
- Any generic cross-scope layered "config document" resolver — explicitly dropped.
- Hot-reload / live file-watching.

## Decisions

### D1. Location: `apps/api/llame.config.json` + `LLAME_CONFIG_PATH` override

The file resolves relative to the API's runtime cwd, exactly like `.env.local` (one mental model; only `apps/api` consumes operator config). A repo-root file would break the moment the API is containerized alone. Containers mount the file anywhere and set `LLAME_CONFIG_PATH`. Repo convention mirrors the env pair: a commented `llame.config.json.example` is committed; the live `llame.config.json` is gitignored (per-deploy, like `.env.local`) — operators who want their instance config version-controlled un-ignore it in their own deploy repo, which is the config-as-code path this change exists for.

### D2. JSONC, `$schema` exemption, published JSON Schema as the validator

JSONC (comments + trailing commas, `tsconfig.json` convention — `.json` name kept) via `jsonc-parser`: an operator config file lives or dies by annotatability (`.env.example` is half comments). YAML vetoed (indentation/implicit-typing footguns in a security-relevant file). The schema is authored **as a JSON Schema document** and validated with **ajv** — the published editor schema and the boot validator are the *same artifact*, so they cannot drift, and schema `description` fields double as hover documentation. A top-level `$schema` key is the single exemption from strict-closed validation. (zod→generated-schema rejected: two artifacts + drift; class-validator rejected: no good schema-publication path — it remains the DTO/HTTP convention, config-at-boot is a different layer.)

### D3. Strict, closed schema (unknown key → boot fail)

For security-relevant config, a silent typo is a governance hole. Strict validation makes each key deliberately registered; consumer changes extending the schema is *good* coupling. Namespaces (`providers`, `models`, `tools`, `policy`) are NOT pre-reserved — strict-closed stays honest; each future consumer adds its own keys (add-when-consumed).

### D4. Interpolation: `{env:NAME}` / `{env:NAME:-default}` / `{path:LOCATION}`, single-pass

Bash/docker-compose `:-` semantics (operator muscle memory). Single-pass, non-recursive — a resolved value is literal, never re-scanned. Placement/typing rules: tokens only in string values; embedded-in-string allowed where the schema type is string (URL composition); non-string types require a whole-value token coerced post-resolution (coercion failure = boot failure). Empty resolution on a nullable key = unset (preserves the established empty-env-means-unset semantics, keeps env-based configs portable). Escaping: `{{` → literal `{` — sigil-doubling per industry norm (compose `$$`, systemd `%%`, k8s `$$()`); backslash escaping rejected because `\{` is not a legal JSON string escape (it would force `\\{`). Quotes/backslashes inside tokens are the JSON parse layer's job. `{path:…}` content runs to the first `}`; a `}` inside a path is unsupported and documented (pathological case; symlink if ever hit).

### D5. File > env > built-in default; env stays honored, not deprecated

One consistent precedence rule per setting, so an operator migrates env→file with no behavior change and existing deploys don't break on upgrade. No deprecation warnings — env is a documented fallback and a legitimate interpolation source, not a legacy path.

### D6. Restart-to-apply, not hot-reload

Operator config is a deploy-time concern. Hot-reload adds file-watching, atomic-swap, and partial-write races on a security-relevant file for the sole benefit of "new work picks up config without restart" — which a restart handles. A bad file failing the boot is the intended fail-loud behavior.

### D7. First-slice surface: shape-stable scalars only, collision-safe placement

Migrated now: `defaults.modelId`, `defaults.titleGenerationModelId`, `runs.{maxOutputTokens, heartbeatSeconds, heartbeatStaleSeconds, timeoutSeconds}`, `http.trustProxy`. The model pointers live under **`defaults.*`, not `models.*`** — `models` is reserved (by convention, not schema) for the follow-up's catalog *list*; parking pointers there would collide object-vs-array. **Killed, not migrated**: `COMPACTION_TOKEN_THRESHOLD` (compaction is model-driven — per-model default → user-per-model → per-send; never an instance knob) and `MODEL_CONTEXT_WINDOW_TOKENS` (every catalog model *requires* `contextWindowTokens`; once models are config-as-code there is no "unknown model" to fall back for — the eval suite's cheap-compaction override moves to per-model/per-send when those land). One loaded, validated, typed `LlameConfig` DI provider is the single read surface — app, worker, and `main.ts` (trust_proxy) repoint to it, which is what makes migrating the run timers cheap enough to include.

## Risks / Trade-offs

- **[Interpolation leaks a secret into logs]** → Resolved `{env:}`/`{path:}` values never enter logs/errors/diagnostics; errors name the source (variable/path), never the value. Explicit spec requirement + negative test.
- **[Recursive/injection interpolation]** → Single-pass, non-recursive; resolved values are literals.
- **[Strict schema couples every consumer change to the schema module]** → Accepted deliberately (D3); the alternative is silent typo no-ops on security-relevant keys.
- **[Bad file fails the boot]** → Intended: a config typo is a failed deploy, not a silent fallback. Documented.
- **[Coercion surprises]** (whole-value token on a number key resolving to garbage) → coercion failure names the path at boot; embedded tokens are simply illegal on non-string keys, caught by schema.
- **[Killing COMPACTION_TOKEN_THRESHOLD breaks the eval suite's cheap-compaction trick]** → The env var keeps working until the per-model threshold change lands (env fallback isn't removed in this slice); the follow-up owns the replacement.

## Migration Plan

1. Add loader (`jsonc-parser`) + interpolation + ajv validation against the authored JSON Schema; expose one typed `LlameConfig` provider; wire boot to fail before serving on any load/validation error.
2. Repoint the migrated settings' readers (models/titles defaults, run timers in the queue/worker path, `trust_proxy` in `main.ts`) from `ConfigService` env reads to `LlameConfig`, with env honored as fallback per D5.
3. Ship a commented `llame.config.json` example + the published JSON Schema; update `.env.example` and deploy docs (env = fallback/interpolation target; restart-to-apply; precedence rule).
4. Amend SPEC (config section) for the operator config-as-code layer; add a VISION note on the operator-code / tenant-data boundary and the capability-vs-settings split.
5. When the draft PR opens: close PR #131 with the rationale comment + direct link to the draft PR.
6. Rollback: the file is optional and env fallbacks remain — reverting to env-only is a config change, not a code rollback.

## Open Questions

None — all resolved in the 2026-07-10 grill session (location/override, JSONC+`$schema`, schema-as-validator via ajv, interpolation placement/typing/escaping semantics, first-slice surface, killed settings, #131 disposition, providers/models follow-up).
