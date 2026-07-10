# llame

**A self-hosted, multi-user personal AI assistant platform** — not just a chat UI, but an AI operating layer you run yourself.

llame treats the things a real assistant needs — groups, projects, goals, todos, skills, commands, connectors, model credentials, memories, artifacts, and knowledge bases — as first-class, durable, governed entities. It is designed to serve a single person, a family, a team, or an organization from the same core, with explicit ownership, permissions, and auditability throughout.

## What it does

- **Multi-user from the ground up** — nested groups (org → team → project), roles, and policy-based access (deny-overrides-allow).
- **Projects** — shared workspaces with their own chats, knowledge, connectors, skills, artifacts, and members.
- **Durable agent runs** — every message becomes a worker-processed run with a replayable event stream, so progress survives a page refresh.
- **Wiki-centric knowledge** — Obsidian vaults, Notion, local Markdown, and Git repos normalized into searchable Knowledge Spaces; your notes are the assistant's memory, not an afterthought.
- **Artifacts** — versioned, shareable, executable work products (documents, diagrams, components) linked to chats, projects, and Git.
- **Bring your own model** — works with no instance-wide provider; users/groups/projects supply their own credentials (OpenAI-compatible, Anthropic, local via Ollama, …).
- **MCP & connectors** — first-class Model Context Protocol host plus connectors (GitHub, filesystem, Notion, …) under per-scope capability policy.
- **Skills, slash commands, goals & todos** — durable agent-control primitives, with skills following the open `SKILL.md` Agent Skills format.
- **Messaging channels** — reach the same assistant from the web app, Telegram, Discord, and more.

## Status

Early/WIP. A chat proof-of-concept (auth, model selection, persisted chats, agent orchestration) is in place; active work is building toward the self-hosted MVP. See [ROADMAP.md](ROADMAP.md) for what's planned and [CHANGELOG.md](CHANGELOG.md) for what's shipped.

## Getting started

```bash
pnpm install
pnpm dev        # run all apps in watch mode
```

Copy each app's `.env.example` to `.env.local`, and the api's operator config example to its live file (`cp apps/api/llame.config.json.example apps/api/llame.config.json`): `apps/api` owns the database and chat loop, so it needs `POSTGRES_URL` in env, its model defaults from `llame.config.json` (the example works as-is), and `OPENAI_API_KEY` when the configured OpenAI-compatible endpoint requires a key; `apps/web` is a thin client and only needs `NEXT_PUBLIC_API_URL`. Full developer setup, commands, and architecture live in [AGENTS.md](AGENTS.md) (and per-app `AGENTS.md` files).

## Documentation

- [SPEC.md](SPEC.md) — full product & architecture specification
- [ROADMAP.md](ROADMAP.md) — planned milestones
- [CHANGELOG.md](CHANGELOG.md) — shipped history
- [AGENTS.md](AGENTS.md) — how to work in this repo (dev setup, conventions, structure)

## Architecture at a glance

A pnpm + Turborepo monorepo, TypeScript end-to-end:

- `apps/web` — Next.js front end and BFF
- `apps/api` — NestJS backend, database, and (in progress) the durable run worker
- `packages/ui` — shared shadcn/ui component library
- `packages/config-*` — shared ESLint / TypeScript configs
