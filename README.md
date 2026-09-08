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
  `llame.config.json`, supporting OpenAI-compatible endpoints.
- Owner-only Projects for organizing chats, with pinning and reversible archive.
- Bounded tool loop: `search_conversations`, optional line-ranged
  `conversation_read`, and operator-configured Streamable HTTP MCP tools.
- Optional native host file tools: selector-based `read`, exact `edit`, and
  create-only `write`, with durable mutation fencing. See [native file setup](docs/native-files.md).
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
[docs/research/harnesses/REFERENCE-HARNESSES.md](docs/research/harnesses/REFERENCE-HARNESSES.md).

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
`llame.config.json`. `apps/web` is a thin client configured with
`NEXT_PUBLIC_API_URL`. See [AGENTS.md](AGENTS.md) for development setup and
commands.

Personal Knowledge is opt-in. Set an absolute `knowledge.root` in the operator
configuration, mount the same logical stable-ID child directories into every
process that can provision or consume Runs, and add `knowledge_search` and
`read` to `tools.allowed`. Every Run-authoring API must declare the setting for
consistent accept-time availability, even if it does not mount the root.
Configuration loading does not probe the root; provisioning and worker
execution fail closed when their mount is missing. The root and local binding
never enter model context or owner-facing results. See [docs/knowledge.md](docs/knowledge.md).

**Breaking**: `knowledge_read` is deleted. An allowlisted `knowledge_read`
entry now fails boot; remove it from `tools.allowed` before upgrading. Read
Knowledge files through the native `read` tool's `kb://<knowledgeSpaceId>/<path>`
locator instead.

Self-hosted Postgres needs `vector` (pgvector) and `pg_trgm` for
embeddings-backed search. `pnpm db:up` provides both. **Breaking** for
self-hosters on their own Postgres: switch to a pgvector-capable image before
upgrading, or the extension migration fails.

`models[]` entries can set `systemPromptFile` to a prompt file; omitting it uses
the packaged default. Relative paths resolve from the active config file,
invalid overrides fail startup without fallback,
and prompt contents must be safe for the chat owner to inspect. Each Run binds
an immutable receipt of the effective prompt and advertised tools. The owner UI
shows model switches and loads the receipt on demand; host file paths never
enter the model catalog or receipt. Authoring:
[apps/api/AGENTS.md](apps/api/AGENTS.md).

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
- [docs/research/harnesses/REFERENCE-HARNESSES.md](docs/research/harnesses/REFERENCE-HARNESSES.md):
  peer harness / protocol prior art (noncanonical)

TypeScript throughout: Next.js (`apps/web`), NestJS + worker (`apps/api`),
shared components (`packages/ui`).

## License

[MIT](LICENSE). Contributions are welcome; opening a pull request licenses your
contribution under the same terms.
