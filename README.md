# llame

llame is a self-hosted, personal-first **meta-harness**: durable chat and agent
execution on your own infrastructure, with multi-user isolation for households,
teams, or organizations. It owns Chat and Run identity and aims to drive peer
coding agents over protocols such as ACP and A2A as executor adapters, not as a
second session system.

## What runs today

- **Multi-user and isolated.** Opaque sessions, tenant isolation enforced by
  Postgres row-level security, and organizational identity.
- **Durable Runs.** Every Chat Run executes on a queue; progress persists and
  replays after a refresh or reconnect.
- **Operator-managed models.** Providers, models, model roles, and per-model
  system prompts live in one instance configuration file. See
  [provider routing](docs/product/operator/providers/routing.md) and
  [model request settings](docs/product/operator/providers/model-settings.md).
- **Projects** group an owner's Chats, with pinning and reversible archive.
- **Native tools** on the host or a remote Machine: `read`, `grep`, `edit`,
  `write`, `bash`, and Workspace entry, under per-call permission rules and
  per-Run permission modes. See
  [native files](docs/product/operator/native-files.md) and
  [Machines](docs/product/operator/machines.md).
- **Web access**: `http(s)://` reads through `read`, with publisher Markdown
  first and address pinning, and `web_search` over a configured engine chain.
  See [web reads](docs/product/operator/web-read.md) and
  [web search](docs/product/operator/web-search.md).
- **Personal Knowledge**: owner-scoped Markdown Knowledge Spaces, searchable
  and editable through the same tools. See
  [Knowledge](docs/product/operator/knowledge.md).
- **Recall**: search and read the owner's own earlier Chats, and an opt-in
  recency digest. See
  [conversation recall](docs/product/operator/conversation-recall.md).
- **MCP tools** from operator-configured remote and stdio servers. See
  [MCP tools](docs/product/operator/mcp-tools.md).

Not yet shipped: llame-owned Git history for Knowledge, user BYOK,
interactive tool approvals, and subagents. See [ROADMAP.md](ROADMAP.md) and
[VISION.md](VISION.md) for where it is going.

## Getting started

```bash
pnpm install
cp apps/api/.env.example apps/api/.env.local
cp apps/api/llame.config.jsonc.example apps/api/llame.config.jsonc
pnpm db:up
pnpm db:migrate
pnpm db:provision-rls
pnpm dev
```

`apps/api` needs `POSTGRES_URL` and the provider credentials the configuration
references. The configuration may be JSONC, YAML, or TOML; `LLAME_CONFIG_PATH`
overrides its location ([operator guide](docs/product/operator/index.md)).
`apps/web` is a thin client configured with `NEXT_PUBLIC_API_URL`.
Running on your own Postgres: see
[Postgres prerequisites](docs/product/operator/scaling.md#postgres-prerequisites).

## Documentation

- [docs/product/operator](docs/product/operator/index.md): configuration,
  deployment, and provider runbooks
- [docs/product/reference](docs/product/reference/index.md): tool, locator,
  and selector behavior as the assistant sees it
- [SPEC.md](SPEC.md): architecture, invariants, and the authority map
- [VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md): direction and
  sequenced, unshipped work
- [CHANGELOG.md](CHANGELOG.md): shipped history
- [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md): delivery
  policy and engineering rules
- [docs/index.md](docs/index.md): the whole documentation map

TypeScript for the web app (Next.js), API and workers (NestJS); Rust for the
Machine daemon.

## License

[MIT](LICENSE). Contributions are welcome; opening a pull request licenses your
contribution under the same terms.
