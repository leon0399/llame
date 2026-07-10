## 1. Schema + loader

- [x] 1.1 Author the JSON Schema document for `llame.config.json` (strict-closed, `additionalProperties: false`, top-level `$schema` exempted; per-setting `description`s) covering: `defaults.modelId`, `defaults.titleGenerationModelId`, `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`. No `compaction.*`, no context-window fallback, no `providers`/`models` (follow-up).
- [x] 1.2 Implement the loader: resolve path (default `llame.config.json` in the API runtime cwd, `LLAME_CONFIG_PATH` override wins), parse as JSONC via `jsonc-parser`; absent file → built-in defaults; malformed → loud boot failure with parse location.
- [x] 1.3 Validate with ajv against the authored schema (the published artifact IS the validator); unknown key / wrong type → boot failure naming the path.
- [x] 1.4 Expose one typed `LlameConfig` DI provider as the single read surface; boot aborts before serving on any load/validation error.

## 2. Value interpolation

- [x] 2.1 Implement single-pass, non-recursive interpolation over string values: `{env:NAME}`, `{env:NAME:-default}` (`NAME` = `[A-Za-z0-9_]+`), `{path:LOCATION}` (trimmed file contents, token content to first `}`); `{{` → literal `{`. Required-but-unresolved → loud boot failure naming config path + source (variable/file), never the value.
- [x] 2.2 Placement/typing: embedded tokens legal only in string-typed settings; non-string settings accept a whole-value token, coerced post-resolution (coercion failure → boot failure naming the path). Empty resolution on a nullable key → unset (null).
- [x] 2.3 Redact at the boundary: resolved interpolation values never enter logs, errors, or diagnostics.

## 3. Precedence + repointing readers

- [x] 3.1 Implement file → env → built-in-default precedence per setting (no deprecation warnings — env is a legitimate fallback). Done as part of 1.4/the loader — `InstanceConfigService.config` is the single DI provider, so precedence had to be baked in before any consumer could read it; see tasks.md note in the PR/report.
- [x] 3.2 Repoint readers to `LlameConfig`: model/title defaults (`models.service`, `title.service`), run timers (queue/worker deadman + heartbeat), `trust_proxy` (`main.ts`). Behavior identical for env-only deploys.
- [x] 3.3 Keep `COMPACTION_TOKEN_THRESHOLD` / `MODEL_CONTEXT_WINDOW_TOKENS` env reads working untouched (killed as _file_ settings, not removed — the per-model follow-up owns their replacement; eval suite still uses the env var).

## 4. Tests

- [x] 4.1 Loader: valid file; absent→defaults; malformed→fail; comments+trailing commas parse; `LLAME_CONFIG_PATH` override; `$schema` key exempt; unknown-key fail (incl. `compaction.*`); wrong-type fail.
- [x] 4.2 Interpolation: env set / missing-required fail / `:-` default / empty→unset-on-nullable; path present / missing fail / trimmed; embedded-in-string; whole-value numeric coercion + coercion-failure; `{{` literal; no-secret-in-logs (negative assertion).
- [x] 4.3 Precedence: file-over-env, env-fallback, built-in default. Covered alongside 4.1/4.2 in config-loader.spec.ts (see 3.1 note).

## 5. Docs + spec amendments

- [x] 5.1 Ship a commented `apps/api/llame.config.json.example` (committed, mirroring the `.env.example` convention) + publish the JSON Schema (referenced via `$schema`); add `llame.config.json` to `.gitignore` (the live operator config is per-deploy, like `.env.local` — operators who _want_ it version-controlled un-ignore it in their own fork/deploy repo).
- [x] 5.2 Update `.env.example` + deploy docs: env = fallback/interpolation target; restart-to-apply; precedence rule; `LLAME_CONFIG_PATH`.
- [x] 5.3 Amend SPEC (config section): operator config-as-code layer; capability-vs-settings split; operator-code / tenant-data boundary. Add the VISION note.
- [x] 5.4 CHANGELOG entry (same PR).

## 6. Board + follow-ups

- [x] 6.1 Open the draft PR; immediately close PR #131 with the rationale comment (two-concern split; what survives: typed snapshot, tenant settings, ancestor-governance RLS policy) + direct link to the draft PR.
- [x] 6.2 File the `providers-and-models-as-code` follow-up change/issue (providers[] duplicable {id, type, key, baseUrl}; models[] superseding model-catalog.ts; provider creds migrate; per-model compaction defaults).
- [x] 6.3 File the typed tenant-settings + per-run-snapshot follow-up (DB/RLS; supersedes the rest of #131's scope).

## 7. Verification

- [x] 7.1 `pnpm --filter api build` / `typecheck` / `lint` clean.
- [x] 7.2 `pnpm --filter api test` green (loader, interpolation, precedence, repointed readers).
- [x] 7.3 `openspec validate instance-config` clean; every spec scenario maps to at least one executed test.
