# llame

llame is a self-hosted, personal-first AI assistant platform. It keeps chat and
agent execution durable on infrastructure you control, while retaining the
multi-user isolation needed for a household, team, or organization.

## What runs today

- Authenticated multi-user operation with opaque sessions, datastore-enforced
  row-level security, and an organizational identity foundation.
- Durable chat Runs processed through a pg-boss worker. Progress is persisted and
  can be replayed after refresh or reconnect.
- Operator-managed provider, model, and per-model system-prompt configuration in
  `llame.config.json`, with support for OpenAI-compatible endpoints.
- Owner-only Projects for organizing chats, plus pinning and reversible archival.
- A bounded read-only tool loop with native `search_conversations` plus
  operator-configured Streamable HTTP MCP tools.
- Optional owner-scoped chat recency digests: an owner can opt in to send a
  bounded list of their other chats' titles and opening excerpts to the
  operator-configured model provider.

Personal Markdown knowledge, agent-authored knowledge, user BYOK, fine-grained
tool permissions, and subagents are not shipped yet. The next release slices
are tracked in [ROADMAP.md](ROADMAP.md).

## Direction

llame is being built toward an assistant that can use external tools, maintain a
Git-backed Markdown knowledge base, recall prior work, and improve its future
context through recoverable changes. Workspaces, artifacts, child agents,
automation, external coding harnesses, and messaging channels follow only after
that core loop works. See [VISION.md](VISION.md).

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
`NEXT_PUBLIC_API_URL`. See [AGENTS.md](AGENTS.md) for the complete development
setup and commands.

Each `models[]` entry may set `systemPromptFile` to a complete prompt file; an
omitted setting uses llame's packaged project default. Relative paths resolve
from the active config file, invalid overrides fail startup without fallback,
and prompt contents must be safe for the chat owner to inspect. Each Run binds
an immutable receipt of the effective prompt and advertised tools. The owner UI
surfaces model switches and loads that receipt only on demand; host file paths
never enter the public model catalog or receipt. The exact authoring surface is
documented in [apps/api/AGENTS.md](apps/api/AGENTS.md).

`shareRecentChats` defaults off. When an owner enables it, the packaged prompt
can send a frozen, capped digest of their other chats' titles and opening
excerpts to the configured provider; enabling is retroactive over their existing
eligible chats. Disabling stops new baselines, re-bakes, and updates, but does
not remove a digest already bound to another chat; deleting a source chat is not
erasure from those existing prompts or receipts. The digest is framed as
untrusted data and has no chat identifiers. Compaction instructs the
summarizing model to leave the digest out of the checkpoint it writes; that
exclusion, like the framing itself, is carried by instruction and model
compliance rather than structurally enforced.

MCP servers use a top-level `.mcp.json`-shaped `mcpServers` map in
`llame.config.json`, with two transports. A remote entry is exactly
`{ type, url, headers? }`, where `http` and `streamable-http` both select
Streamable HTTP. A local entry is `{ type: "stdio", command, args?, env?, cwd? }`
and llame runs it as a child process — the shape most of the ecosystem ships,
including servers with no HTTP mode.

Secrets use llame's `{env:...}` and `{path:...}` interpolation, and interpolating
a value is what marks it secret: resolved values are redacted from diagnostics,
results, and errors, and are never visible to users or models. A stdio child
receives only its declared `env` over the MCP SDK's small base allowlist, so
llame's own credentials do not reach it, and it runs unsandboxed as the llame
user. Operators must explicitly allowlist each namespaced tool as read-only. See
[docs/mcp-tools.md](docs/mcp-tools.md) for configuration, supported protocol
revisions, trust boundaries, rollout, and troubleshooting.

## Documentation

- [VISION.md](VISION.md): product direction and deliberate deferrals
- [ROADMAP.md](ROADMAP.md): sequenced, unshipped work
- [SPEC.md](SPEC.md): current architecture, invariants, and authority map
- [CHANGELOG.md](CHANGELOG.md): shipped history
- [AGENTS.md](AGENTS.md): repository workflow and engineering rules
- [docs/mcp-tools.md](docs/mcp-tools.md): remote MCP operator runbook

The monorepo is TypeScript end to end: Next.js in `apps/web`, NestJS and the
worker in `apps/api`, and shared UI components in `packages/ui`.
