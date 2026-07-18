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
- A bounded read-only tool loop with `search_conversations`, backed by derived
  hybrid chat search.

Remote MCP tools, personal Markdown knowledge, agent-authored knowledge, user
BYOK, fine-grained tool permissions, and subagents are not shipped yet. The next
release slices are tracked in [ROADMAP.md](ROADMAP.md).

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

## Documentation

- [VISION.md](VISION.md): product direction and deliberate deferrals
- [ROADMAP.md](ROADMAP.md): sequenced, unshipped work
- [SPEC.md](SPEC.md): current architecture, invariants, and authority map
- [CHANGELOG.md](CHANGELOG.md): shipped history
- [AGENTS.md](AGENTS.md): repository workflow and engineering rules

The monorepo is TypeScript end to end: Next.js in `apps/web`, NestJS and the
worker in `apps/api`, and shared UI components in `packages/ui`.
