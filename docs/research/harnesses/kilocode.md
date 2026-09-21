---
type: Reference
title: "Kilo Code"
description: "Provider-gated header tiers, hard permission rulesets, and a fail-closed headless subagent guard"
resource: "https://github.com/Kilo-Org/kilocode"
observed:
  date: "2026-09-21"
  revision: "51509bedee0cdcb6b1d7acceb4184ac705fd4910"
sources:
  - id: packages-opencode-src-session-llm-request-ts-l233-l259
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/session/llm/request.ts#L233-L259"
    title: "provider-gated header set and merge order"
  - id: packages-opencode-src-session-llm-request-ts-l166-l171
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/session/llm/request.ts#L166-L171"
    title: "chat.headers plugin hook"
  - id: packages-opencode-src-kilocode-provider-opencode-session-headers-ts-l3-l15
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/provider/opencode-session-headers.ts#L3-L15"
    title: "opencodeSessionHeaders shim for non-chat callers"
  - id: packages-kilo-vscode-changelog-md-l44
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/kilo-vscode/CHANGELOG.md#L44"
    title: "PR #14015 missing x-opencode-session fix"
  - id: packages-opencode-src-kilocode-enhance-prompt-ts-l56-l57
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/enhance-prompt.ts#L56-L57"
    title: "prompt enhancement mints a random session id"
  - id: packages-opencode-src-kilocode-memory-ports-ts-l197-l199
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/memory/ports.ts#L197-L199"
    title: "memory consolidation carries the real session id"
  - id: packages-opencode-src-kilocode-cli-cmd-roll-call-ts-l315-l338
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/cli/cmd/roll-call.ts#L315-L338"
    title: "roll-call diagnostic attaches the shim"
  - id: packages-opencode-src-session-llm-native-request-ts-l165-l178
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/session/llm/native-request.ts#L165-L178"
    title: "per-model npm selects the wire adapter"
  - id: packages-core-src-models-dev-ts-l170-l179
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/core/src/models-dev.ts#L170-L179"
    title: "models.dev catalogue source and cache"
  - id: packages-opencode-src-provider-transform-ts-l1610-l1613
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/provider/transform.ts#L1610-L1613"
    title: "promptCacheKey and encrypted reasoning for opencode providers"
  - id: packages-opencode-src-provider-transform-ts-l1480-l1484
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/provider/transform.ts#L1480-L1484"
    title: "chat_template_args gated on the exact opencode id"
  - id: packages-opencode-src-plugin-openai-ws-pool-ts-l69-l73
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/plugin/openai/ws-pool.ts#L69-L73"
    title: "websocket pool keyed on session affinity"
  - id: packages-opencode-test-tool-fixtures-models-api-json-l33607-l33613
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/test/tool/fixtures/models-api.json#L33607-L33613"
    title: "catalogue entry for OpenCode Go"
  - id: packages-opencode-test-tool-fixtures-models-api-json-l33652-l33672
    resource: "https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/test/tool/fixtures/models-api.json#L33652-L33672"
    title: "deprecated legacy model kept in the Go catalogue"
  - id: packages-kilo-vscode-src-services-cli-backend-server-manager-ts-l129-l153
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/kilo-vscode/src/services/cli-backend/server-manager.ts#L129-L153"
    title: "extension spawns kilo serve"
  - id: packages-opencode-src-session-session-ts-l62-l260
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/session.ts#L62-L260"
    title: "session table with permission ruleset"
  - id: packages-opencode-src-permission-index-ts-l106-l135
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L106-L135"
    title: "resolve defaults to ask"
  - id: packages-opencode-src-permission-index-ts-l193-l249
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L193-L249"
    title: "hard ruleset and config protection"
  - id: packages-opencode-src-kilocode-permission-headless-ts-l1-l45
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/kilocode/permission/headless.ts#L1-L45"
    title: "headless subagent denial"
  - id: packages-opencode-src-tool-task-ts-l118-l288
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/tool/task.ts#L118-L288"
    title: "task tool depth cap and tool narrowing"
  - id: packages-opencode-src-session-compaction-ts-l96-l300
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/compaction.ts#L96-L300"
    title: "turn budget and pruning"
  - id: packages-opencode-src-mcp-index-ts-l45-l56
    resource: "https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/mcp/index.ts#L45-L56"
    title: "MCP capabilities restricted to roots"
---

# Kilo Code

- **Stack:** Bun, TypeScript, Effect, Drizzle/SQLite; hard fork of OpenCode with a shared engine embedded by the CLI and the VS Code extension; MIT

Listed by OpenCode Go as a validated client for the CLI after PR #13752. Both
relays arrive as catalogue entries rather than code: `opencode` and `opencode-go`
are models.dev providers distinguished by id and base URL, and the client's only
special case for them is a provider-id prefix
check[^packages-core-src-models-dev-ts-l170-l179][^packages-opencode-src-session-llm-request-ts-l233-l259]. The
engine is one code path: the extension spawns `kilo serve` with
`KILO_CLIENT=vscode`[^packages-kilo-vscode-src-services-cli-backend-server-manager-ts-l129-l153],
so the CLI/extension distinction on the Go page is not a code-level branch at
this revision. Compare with [OpenCode](./opencode.md) for the upstream.

**Study**

1. **Provider-gated header tiers.** When `providerID` starts with `opencode`,
   the request adds `x-opencode-session` (session id), `x-opencode-request` (the
   inbound message id), `x-opencode-client`, optional `x-opencode-project`, and
   the product User-Agent; every other provider gets the legacy
   `x-session-affinity` and `X-Session-Id` pair plus
   `x-parent-session-id`[^packages-opencode-src-session-llm-request-ts-l233-l259].
   Per-model headers and a `chat.headers` plugin hook merge on
   top[^packages-opencode-src-session-llm-request-ts-l166-l171]. High
   confidence for #809: built-in per-provider headers, operator config, and
   per-request overrides as three tiers, with the relay family named by a
   provider-id prefix rather than by host.
2. **A shim for the callers that bypass the chat path.** Any code that resolves a
   model and calls the SDK directly must attach the header itself, so a
   three-line helper returns `x-opencode-session` plus User-Agent for
   `opencode*` ids and nothing otherwise[^packages-opencode-src-kilocode-provider-opencode-session-headers-ts-l3-l15].
   Three callers use it: memory consolidation with the real session
   id[^packages-opencode-src-kilocode-memory-ports-ts-l197-l199], the roll-call
   diagnostic[^packages-opencode-src-kilocode-cli-cmd-roll-call-ts-l315-l338], and prompt
   enhancement, which passes a fresh `randomUUID()` per
   call[^packages-opencode-src-kilocode-enhance-prompt-ts-l56-l57]. PR #14015 is the
   fix for those three call sites after "missing x-opencode-session" errors from
   OpenCode-managed models[^packages-kilo-vscode-changelog-md-l44]. High
   confidence for #809's auxiliary-call question: the header is per-request state
   that must be re-established on every path, and a helper plus a lint-visible
   name is how this harness keeps that honest.
3. **The wire comes from the model entry, not the provider.** The native adapter
   switches on `model.api.npm` and returns Responses for `@ai-sdk/openai`,
   Messages for `@ai-sdk/anthropic`, and Chat Completions for
   `@ai-sdk/openai-compatible` with an explicit base URL
   requirement[^packages-opencode-src-session-llm-native-request-ts-l165-l178]; models.dev
   supplies `npm` and `api` per model, and an individual model may override its
   provider package[^packages-core-src-models-dev-ts-l170-l179]. Both OpenCode families are
   `@ai-sdk/openai-compatible` in the catalogue fixture, so Go starts on Chat
   Completions and gains another wire only where the model entry says so. The
   fixture in this repo mirrors what models.dev serves: the Go entry carries
   `env: OPENCODE_API_KEY`, `npm: @ai-sdk/openai-compatible`, and
   `api: https://opencode.ai/zen/go/v1`[^packages-opencode-test-tool-fixtures-models-api-json-l33607-l33613],
   alongside per-model costs, limits, and a `status: deprecated` field for legacy
   ids kept in the list[^packages-opencode-test-tool-fixtures-models-api-json-l33652-l33672]. High
   confidence for #809: the same "a base URL, not a second type" shape llame
   uses, with the per-model override carried in the catalogue.
4. **Two Go-aware request transforms, one exact-id trap.** When the provider id
   starts with `opencode`, the request sets `promptCacheKey` to the session id and
   asks for encrypted reasoning with `reasoningSummary: "auto"`; opting out
   through `providerOptions.setCacheKey === false` is
   honored[^packages-opencode-src-provider-transform-ts-l1610-l1613]. A second transform
   sets `chat_template_args.enable_thinking` for Kimi and GLM thinking models, but
   it compares the provider id to the literal `opencode`, so Go models never get
   it[^packages-opencode-src-provider-transform-ts-l1480-l1484]. Moderate confidence for
   #809: gate on the relay family consistently, and treat an exact-id check as a
   defect waiting to happen.
5. **Session affinity without the OpenCode header is a local transport detail.**
   A websocket pool for the OpenAI Responses path keys its connection on
   `x-session-affinity` or `session-id` and falls back to HTTP when neither is
   present[^packages-opencode-src-plugin-openai-ws-pool-ts-l69-l73]. That is the
   consumer of the else-branch header pair, and it never sees an `opencode*`
   provider. Moderate confidence for #881: this is prior art for a reusable
   session-keyed transport, not for Go traffic.
6. **Permission ruleset on the session row and hard rules.** Sessions persist
   their permission ruleset[^packages-opencode-src-session-session-ts-l62-l260];
   unmatched permission/pattern pairs resolve to
   `ask`[^packages-opencode-src-permission-index-ts-l106-l135], and a hard
   ruleset plus config-file protection override saved
   approvals[^packages-opencode-src-permission-index-ts-l193-l249]. High
   confidence as a shape for llame approvals (#778): saved grants must not
   override operator restrictions.
7. **Fail-closed headless subagent guard.** Non-interactive root sessions are
   marked headless and any permission ask from their descendants is denied
   rather than left pending
   forever[^packages-opencode-src-kilocode-permission-headless-ts-l1-l45].
   High confidence for llame's pg-boss Runs with no attached terminal (#765).
8. **`task` tool bounds.** Depth cap from config, child tool set stripped of
   `question`, `todowrite`, and `task`, child session persisted with
   `parentID`[^packages-opencode-src-tool-task-ts-l118-l288]. High confidence
   for #765's depth and allowlist narrowing.
9. **Separate pruning and compaction.** A turn budget preserves the recent
   tail while `prune()` erases old tool outputs behind a step floor and
   protects named tools[^packages-opencode-src-session-compaction-ts-l96-l300].
   Moderate confidence for llame's compaction design.

**Caution**

- Single-user server: permission state is one in-memory structure per
  instance, not scoped by identity.
- Several guards swallow errors into permissive defaults (project id, machine
  id, trusted-skill lookup); audit each before copying.
- MCP client capabilities are limited to `roots` because upstream bugs, not
  policy, disabled sampling, elicitation, and
  tasks[^packages-opencode-src-mcp-index-ts-l45-l56].
- No immutable per-turn record of the system prompt and tool declarations;
  prompts are assembled fresh per request.
- The auxiliary header shim does not preserve the contract it documents:
  prompt enhancement mints a throwaway `randomUUID()` for `x-opencode-session`
  while memory consolidation passes the real
  one[^packages-opencode-src-kilocode-enhance-prompt-ts-l56-l57][^packages-opencode-src-kilocode-memory-ports-ts-l197-l199],
  so a relay that keys cache or backend affinity on that header sees a new
  conversation on every enhancement call.
- No session-presence failure has a dedicated classifier here; a missing header
  would surface as whatever generic status the relay returns.

[^packages-opencode-src-session-llm-request-ts-l233-l259]: [provider-gated header set and merge order](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/session/llm/request.ts#L233-L259)

[^packages-opencode-src-session-llm-request-ts-l166-l171]: [`chat.headers` plugin hook](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/session/llm/request.ts#L166-L171)

[^packages-opencode-src-kilocode-provider-opencode-session-headers-ts-l3-l15]: [`opencodeSessionHeaders` shim for non-chat callers](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/provider/opencode-session-headers.ts#L3-L15)

[^packages-kilo-vscode-changelog-md-l44]: [PR #14015 missing `x-opencode-session` fix](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/kilo-vscode/CHANGELOG.md#L44)

[^packages-opencode-src-kilocode-enhance-prompt-ts-l56-l57]: [prompt enhancement mints a random session id](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/enhance-prompt.ts#L56-L57)

[^packages-opencode-src-kilocode-memory-ports-ts-l197-l199]: [memory consolidation carries the real session id](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/memory/ports.ts#L197-L199)

[^packages-opencode-src-kilocode-cli-cmd-roll-call-ts-l315-l338]: [roll-call diagnostic attaches the shim](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/kilocode/cli/cmd/roll-call.ts#L315-L338)

[^packages-opencode-src-session-llm-native-request-ts-l165-l178]: [per-model `npm` selects the wire adapter](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/session/llm/native-request.ts#L165-L178)

[^packages-core-src-models-dev-ts-l170-l179]: [models.dev catalogue source and cache](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/core/src/models-dev.ts#L170-L179)

[^packages-opencode-src-provider-transform-ts-l1610-l1613]: [`promptCacheKey` and encrypted reasoning for opencode providers](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/provider/transform.ts#L1610-L1613)

[^packages-opencode-src-provider-transform-ts-l1480-l1484]: [`chat_template_args` gated on the exact opencode id](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/provider/transform.ts#L1480-L1484)

[^packages-opencode-src-plugin-openai-ws-pool-ts-l69-l73]: [websocket pool keyed on session affinity](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/src/plugin/openai/ws-pool.ts#L69-L73)

[^packages-opencode-test-tool-fixtures-models-api-json-l33607-l33613]: [catalogue entry for OpenCode Go](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/test/tool/fixtures/models-api.json#L33607-L33613)

[^packages-opencode-test-tool-fixtures-models-api-json-l33652-l33672]: [deprecated legacy model kept in the Go catalogue](https://github.com/Kilo-Org/kilocode/blob/51509bedee0cdcb6b1d7acceb4184ac705fd4910/packages/opencode/test/tool/fixtures/models-api.json#L33652-L33672)

[^packages-kilo-vscode-src-services-cli-backend-server-manager-ts-l129-l153]: [extension spawns `kilo serve`](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/kilo-vscode/src/services/cli-backend/server-manager.ts#L129-L153)

[^packages-opencode-src-session-session-ts-l62-l260]: [session table with permission ruleset](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/session.ts#L62-L260)

[^packages-opencode-src-permission-index-ts-l106-l135]: [resolve defaults to ask](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L106-L135)

[^packages-opencode-src-permission-index-ts-l193-l249]: [hard ruleset and config protection](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/permission/index.ts#L193-L249)

[^packages-opencode-src-kilocode-permission-headless-ts-l1-l45]: [headless subagent denial](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/kilocode/permission/headless.ts#L1-L45)

[^packages-opencode-src-tool-task-ts-l118-l288]: [`task` tool depth cap and tool narrowing](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/tool/task.ts#L118-L288)

[^packages-opencode-src-session-compaction-ts-l96-l300]: [turn budget and pruning](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/session/compaction.ts#L96-L300)

[^packages-opencode-src-mcp-index-ts-l45-l56]: [MCP capabilities restricted to `roots`](https://github.com/Kilo-Org/kilocode/blob/2151ac907ca51f10592b07fb220b4b158e9d25f5/packages/opencode/src/mcp/index.ts#L45-L56)
