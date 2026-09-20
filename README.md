# llame

llame is a self-hosted, personal-first **meta-harness**: durable chat and agent
execution on your infrastructure, with multi-user isolation for households,
teams, or organizations. It keeps ownership of Chat and Run identity while
aiming to dispatch peer coding agents over protocols such as ACP and A2A
(similar to goose) as executor adapters — not a second session system.

## What runs today

- Multi-user with opaque sessions, RLS-enforced tenant isolation, and
  organizational identity.
- Durable chat Runs via pg-boss. Progress persists and replays after refresh or
  reconnect.
- Operator-managed providers, models, and per-model system prompts in
  `llame.config.json`. Each provider entry declares the wire it speaks:
  `openai-responses` for the Responses API, `openai-completions` for
  OpenAI-compatible Chat Completions endpoints, `anthropic-messages` for the
  Anthropic Messages wire (the Claude API, or a gateway that speaks it), or
  `openai-codex` for the
  Codex subscription, whose transport and endpoint are fixed by construction.
- Owner-only Projects for organizing chats, with pinning and reversible archive.
- Bounded tool loop: `search_conversations`, optional line-ranged
  `conversation_read`, and operator-configured Streamable HTTP MCP tools.
- Optional native host file tools: selector-based `read`, exact `edit`, and
  create-or-replace `write`, with durable mutation fencing, plus host `bash`
  with per-call literal `cwd` and additive `env`, fresh processes, and bounded
  output. See [native file setup](docs/native-files.md).
- Owner-scoped Markdown Knowledge Spaces: `knowledge_search` over live files
  (including uncommitted changes), plus `kb://` reads through the native
  `read` tool, operator-configured and allowlisted.
- Optional owner-scoped chat recency digests: an owner opts in to send a bounded
  list of their other chats' titles and opening excerpts to the configured
  provider.

Not yet shipped: agent-authored knowledge writes, Git-backed recovery, user
BYOK, fine-grained tool permissions, subagents. See [ROADMAP.md](ROADMAP.md).
Operator setup: [docs/conversation-recall.md](docs/conversation-recall.md),
[docs/knowledge.md](docs/knowledge.md).

## Direction

llame targets an assistant with external tools, a Git-backed Markdown knowledge
base, prior-work recall, and self-improving context through recoverable writes.
Knowledge currently reads live
owner-scoped files; Git-backed writes begin in #212. Workspaces, artifacts, child
agents, automation, peer harness adapters (ACP/A2A and similar), and messaging
channels follow only after that core loop works. See [VISION.md](VISION.md).
Prior art for those adapters:
[docs/research/harnesses/index.md](docs/research/harnesses/index.md).

## Getting started

```bash
pnpm install
cp apps/api/.env.example apps/api/.env.local
cp apps/api/llame.config.json.example apps/api/llame.config.json
pnpm db:up
pnpm db:migrate
pnpm db:provision-rls
pnpm dev
```

`apps/api` needs `POSTGRES_URL` and any provider credentials referenced by
`llame.config.json`. Each provider entry declares its wire: `openai-responses`
calls the Responses API, with an optional `baseUrl` defaulting to OpenAI, and
`openai-completions` calls Chat Completions on its required `baseUrl`.
`anthropic-messages` calls the Anthropic Messages API, with an optional
`baseUrl` defaulting to the Anthropic API (`https://api.anthropic.com/v1`,
the adapter's own default, which the client passes explicitly when the entry
sets no `baseUrl`) — a proxy, gateway, or third-party
server that speaks Messages is that `baseUrl`, not a second type. Its shape is
`{ id, type, key?, baseUrl? }`: `key` and `baseUrl` use the same
interpolation, an empty resolution means keyless, and the credential is sent
as `x-api-key`. The client always passes an explicit base URL, so an ambient
`ANTHROPIC_BASE_URL` never moves a request off the configured destination,
and it sends the same non-empty placeholder as the OpenAI clients in keyless
mode, because the adapter requires an API key to be present. The `type` alone
selects the client: no `id`, `baseUrl`, or host is inspected.
**Breaking**: `type: "openai"` is deleted — re-declare every entry that used it
as one of those two wires, or startup fails naming the entry. `openai-codex`
is unchanged.
`apps/web` is a thin client configured with `NEXT_PUBLIC_API_URL`. See
[AGENTS.md](AGENTS.md) for development setup and commands.

Personal Knowledge is opt-in. Set an absolute `knowledge.root` in the operator
configuration, mount the same logical stable-ID child directories into every
process that can provision or consume Runs, and add `knowledge_search` and
`read` to `tools.allowed`. Every Run-authoring API must declare the setting for
consistent accept-time availability, even if it does not mount the root.
Configuration loading does not probe the root; provisioning and worker
execution fail closed when their mount is missing. The Knowledge API keeps the
root and local binding out of model context and owner-facing results; allowlisted
host `bash` can discover a mounted root through ordinary filesystem commands.
See [docs/knowledge.md](docs/knowledge.md).

**Breaking**: `knowledge_read` is deleted. An allowlisted `knowledge_read`
entry now fails boot; remove it from `tools.allowed` before upgrading. Read
Knowledge files through the native `read` tool's `kb://<knowledgeSpaceId>/<path>`
locator instead.

Self-hosted Postgres needs `vector` (pgvector) and `pg_trgm` for
embeddings-backed search. `pnpm db:up` provides both. **Breaking** for
self-hosters on their own Postgres: switch to a pgvector-capable image before
upgrading, or the extension migration fails.

`models[]` entries can set `systemPromptFile` to a prompt file, and llame-owned
tool descriptions are replaceable through `tools.promptFiles` and
`models[].toolPromptFiles`; omitting either uses the packaged default. Relative
paths resolve from the active config file, invalid overrides fail startup
without fallback, and prompt contents must be safe for the chat owner to
inspect. Each attempt that reaches prompt preparation binds an immutable
system-prompt-only receipt; tool declarations and rendered descriptions stay in
worker memory, so a receipt is not a record of the descriptions the model was
shown. The owner UI shows model switches and loads the receipt on demand; host
file paths never enter the model catalog or receipt. Authoring:
[apps/api/AGENTS.md](apps/api/AGENTS.md), operator runbook:
[docs/tool-prompts.md](docs/tool-prompts.md).

`models[].providerOptions` is a server-only free-form object of provider-native
request options for the adapter the provider `type` selects, keyed as that
adapter documents them (`reasoningSummary` on the Responses wire,
`reasoningEffort` on Chat Completions, `thinking`/`effort`/`cacheControl` on
the Messages wire); llame places it under the wire's provider-options namespace
itself (`openai`, `openaiCompletions` for Chat Completions, or `anthropic` for
Messages). Boot validates shape only — the value must be an object, and
`{env:...}`/`{path:...}` syntax in any string value at any depth fails startup
before any token resolves — so the object is not a credential channel and its
contents are never redacted. Every request composes four layers, highest
first: client invariants (the Codex client always sends `store: false` and
`reasoningSummary: 'auto'`; the Messages client always sends
`sendReasoning: true` and, on every request that carries adaptive thinking,
the drop-on-prefix-mismatch instruction), the run's resolved effort when the
model declares `reasoning`, the entry's object, then per-request defaults (the
Responses client defaults `reasoningSummary: 'auto'` on streaming and
compaction and sends none on structured generation; the Messages client
defaults adaptive thinking with summarized display when the model declares
`reasoning`, and the request-level ephemeral cache control on every request).
Objects merge recursively key by key,
while arrays and scalars replace the value beneath them; `null` at any depth
removes a default but never an invariant. Keys that
would change what the request is rather than how the model answers are
stripped before composition: `conversation`, `previousResponseId`,
`instructions`, `systemMessageMode`, and `allowedTools` on the Responses wire
(both `openai-responses` and `openai-codex`); `model`, `max_tokens`, and
`tool_choice` on the Chat Completions wire; `fallbacks`, `mcpServers`,
`container`, and `thinking.blockBinding` on the Messages wire. The adapter
decides the rest at request time: a value it recognizes and rejects fails that
request under the existing failure contract, and an unrecognized key is dropped
by the Responses and Anthropic adapters or forwarded into the request body by
`openai-completions`.

`models[].maxOutputTokens` is an optional positive integer (or whole-value
interpolation token, like `contextWindowTokens`, validated after resolution —
a non-positive or non-integer value fails startup naming the model id and the
field) sent as every request's `maxOutputTokens` setting; absent, the
adapter's own default applies. The
Responses adapter sends it as `max_output_tokens`; the Chat Completions
adapter sends it as `max_tokens` with no `max_completion_tokens` remapping, so
declaring it on an entry fronting a model that requires `max_completion_tokens`
is rejected by that model. The Messages wire requires `max_tokens` on every
request, so the Anthropic adapter fills it from its own model-id table when
the entry declares no limit — 128k for the recognized current models and for
any unrecognized `claude-` id, 64k or 32k for the 4.5 and older 4.x rows, and
4096 for the Claude 3 Haiku, Claude 2, and Claude Instant rows and for any id
that does not contain `claude-`, such as a gateway-served `glm-5` — with
thinking tokens counted against it, and it warns when an unrecognized
`claude-` id takes the 128k branch. A declared limit makes the adapter add a
manual thinking budget to it silently. An adapter may adjust the value as it
documents — for example lowering one above a ceiling it knows for a recognized
model, warned only when the entry declared the limit —
and the warnings it emits surface in the run. This field caps provider output;
the top-level `runs.maxOutputTokens` remains an admission reserve and does not.
Like `providerOptions`, it is server-only and never returned by
`GET /api/v1/models`.

The `anthropic-messages` wire owns thinking and caching defaults, and both are
`providerOptions` defaults rather than fixed behavior. When a model entry
declares `reasoning`, the client asks for adaptive thinking with summarized
display, so the owner's effort governs thinking depth and the provider's
summaries stay visible as reasoning parts; `{ "thinking": { "display": null } }`
keeps adaptive thinking but drops the display, a budget-only model gets manual
thinking through `{ "thinking": { "type": "enabled", "budgetTokens": N } }`,
and `{ "thinking": { "type": "disabled" } }` turns it off. Two documented
ceilings follow. First, the drop-on-prefix-mismatch instruction llame sets for
you is carried only on the adaptive shape the pinned adapter emits, so an entry
that declares no `reasoning` sends no thinking configuration and no
instruction, and an operator override to a manual-budget or disabled shape
gives the instruction up for that model: on a model that thinks by default, a
compaction or prompt-receipt change can then be rejected by the provider under
the account's own default enforcement. The remedy is to declare `reasoning`
for such a model. Second, the adapter's effort option is a closed enumeration
of the provider's levels (`low`, `medium`, `high`, `xhigh`, `max`), so an
effort level outside it fails that request at the adapter before any call — a
gateway whose vocabulary is not Anthropic's cannot be driven through this
option — while an operator `effort` on an entry that declares no `reasoning`
is forwarded as written. The adapter may also lower `xhigh`/`max` to `high`
with a warning when thinking is disabled on a model it knows rejects that
combination; the run surfaces the warning and nothing is retried or rewritten.
Prompt caching is the other default: every request carries the top-level
ephemeral cache control with the provider's 5-minute lifetime, the provider
places and moves the breakpoint itself, and llame authors no block-level
breakpoints. Replace the default with the provider's longer lifetime or remove
it with `cacheControl: null` for a gateway that rejects the option; a gateway
that ignores it simply serves the request without caching.

`models[].pricingUsdPer1M.cacheWrite` is an optional per-million rate for the
provider's cache-creation tokens. The adapter's input total already includes
them, so cost prices them at that rate when the entry declares one and at the
entry's input rate when it does not, which leaves the computed cost identical
to the result before the field existed. The count is provider-reported and
never inferred or backfilled: a turn that reports none records zero, an
endpoint whose cache-read plus cache-write counts exceed its input total is
bounded to a zero uncached term rather than a negative cost, and a model entry
with no `pricingUsdPer1M` keeps its unknown-cost contract (`costUsd: null`).
The web usage panel shows the count as an `of which cache write` row beneath
Input, the way cached input is shown.

`shareRecentChats` defaults off. Enabling sends a frozen, capped digest of the
owner's other chats' titles and opening excerpts to the configured provider;
retroactive over existing eligible chats. Disabling stops new baselines,
re-bakes, and updates, but does
not remove a digest already bound to another chat; deleting a source chat is not
erasure from those existing prompts or receipts. The digest is framed as
untrusted data and has no chat identifiers. Compaction excludes the digest from
checkpoints by instruction, not structural enforcement.

MCP servers use a top-level `.mcp.json`-shaped `mcpServers` map in
`llame.config.json`, with two transports. A remote entry is exactly
`{ type, url, headers? }`, where `http` and `streamable-http` both select
Streamable HTTP. A local entry is `{ type: "stdio", command, args?, env?, cwd? }`,
run as a child process — the shape most MCP servers ship.

Secrets use `{env:...}` and `{path:...}` interpolation. Interpolation marks a
value secret: resolved values are redacted from diagnostics, results, and
errors, never visible to users or models. A stdio child receives only its
declared `env` plus the MCP SDK's base allowlist — llame's own credentials do
not reach it. Runs unsandboxed as the
llame user. Operators must explicitly allowlist each namespaced tool as
read-only. See [docs/mcp-tools.md](docs/mcp-tools.md).

## Documentation

- [VISION.md](VISION.md): product direction and deliberate deferrals
- [ROADMAP.md](ROADMAP.md): sequenced, unshipped work
- [SPEC.md](SPEC.md): current architecture, invariants, and authority map
- [CHANGELOG.md](CHANGELOG.md): shipped history
- [AGENTS.md](AGENTS.md): repository workflow and engineering rules
- [docs/knowledge.md](docs/knowledge.md): personal Knowledge operator runbook
- [docs/mcp-tools.md](docs/mcp-tools.md): remote MCP operator runbook
- [docs/tool-prompts.md](docs/tool-prompts.md): tool description template
  operator runbook
- [docs/codex-subscription.md](docs/codex-subscription.md): ChatGPT/Codex
  subscription operator runbook
- [docs/research/harnesses/index.md](docs/research/harnesses/index.md):
  peer harness / protocol prior art (noncanonical)

TypeScript throughout: Next.js (`apps/web`), NestJS + worker (`apps/api`),
shared components (`packages/ui`).

## License

[MIT](LICENSE). Contributions are welcome; opening a pull request licenses your
contribution under the same terms.
