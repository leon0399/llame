_Reverse-chronological record of shipped work — features, fixes, and chores. Newest first._

# 2026-06-28

- Authored the product specification ([SPEC.md](SPEC.md)) and refined it to v0.3: single TypeScript stack, Postgres-first architecture, corrected single-`SKILL.md` skill format — verified via a multi-reviewer pass.
- Added hierarchical `CLAUDE.md` context files (root + `apps/web`, `apps/api`, `packages/ui`).
- Pinned Next.js to 15.5.19 for stable Node middleware; documented OpenAI/Anthropic API keys in `.env.example`.

# 2025-10-20

- Dependency updates (Next.js, axios).

# 2025-07-29

- Moved the database out of the Next.js app into the NestJS API.

# 2025-07-28

- Scaffolded the NestJS API app.
- Chat error display; `Alert` UI component.

# 2025-07-18

- Experimented with multi-agent / expert-supervision orchestration.

# 2025-07-16

- Persist and fetch user chats via the API/DB.
- Agent supervisor/orchestrator and ReAct agent for chat.
- Added Sentry.

# 2025-07-15

- User info in the sidebar.

# 2025-07-14

- Theme switch and font-family setting (incl. OpenDyslexic), with server-side cookie persistence.
- Model preview card in the selector; upgraded AI SDK to beta.

# 2025-07-09

- Per-message model selection; styled messages, auto-scroll container, and message components; dropped the completions PoC.

# 2025-07-03

- Stateless chat PoC; test chat + completions APIs; message-input, code-block, and markdown components.

# 2025-07-02

- Models API + query; PoC conversation tree; fixed the auth DB connection in middleware.

# 2025-06-30

- Core chat UI shell: sidebar (mock chats/projects), model selector, and shadcn UI kit (dialog, popover, command, dropdown, sidebar).
- React Query wiring; simple auth/register pages.

# 2025-06-29

- Project bootstrapped (shadcn/ui monorepo); Sonner toaster.
