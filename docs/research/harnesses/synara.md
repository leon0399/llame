---
type: Reference
title: "Synara"
description: "Local-first multi-provider coding-agent workspace where each task owns transcript, provider session, environment, and Git changes, with durable delivery journals and reconnect recovery."
tags: [harness, peer-executor, desktop, worktrees, recovery, providers]
status: draft
resource: "https://github.com/Emanuele-web04/synara/tree/df87a48b9f2d403e3d2785ef11502f2ce2922f5b"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "df87a48b9f2d403e3d2785ef11502f2ce2922f5b"
sources:
  - id: synara-readme-l26-l33
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/README.md#L26-L33"
    title: "Project, thread, provider session, workspace tools"
  - id: synara-readme-l67-l80
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/README.md#L67-L80"
    title: "Provider-native local integrations"
  - id: synara-license-l1-l10
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/LICENSE#L1-L10"
    title: "MIT license"
  - id: synara-core-l1-l28
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/core-concepts.md#L1-L28"
    title: "Task ownership hierarchy; worktree-gated provider start"
  - id: synara-core-l114-l120
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/core-concepts.md#L114-L120"
    title: "Post-crash guarded continuation excludes approval-waiting chats"
  - id: synara-providers-l1-l23
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/providers.md#L1-L23"
    title: "Synara hosts no models; supported local runtimes"
  - id: synara-providers-l25-l51
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/providers.md#L25-L51"
    title: "Shared surface; per-task delivery lanes and journal resume"
  - id: synara-recovery-l1-l44
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/connection-recovery.md#L1-L44"
    title: "180s silence reconnect; resume from afterSequence"
  - id: synara-fifo-l1-l9
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/workspace-fifo-recovery.md#L1-L9"
    title: "Nonblocking open rejects named pipes; cancel cannot unblock FIFO open"
  - id: synara-agents-l3-l11
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/AGENTS.md#L3-L11"
    title: "Provider adapters own protocol; session-owned consumers"
  - id: synara-remote-l21-l25
    resource: "https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/REMOTE.md#L21-L25"
    title: "Remote access requires auth token before non-localhost bind"
  - id: synara-site
    resource: "https://www.trysynara.com"
    title: "Synara product site"
---

# Synara

- **Stack:** Bun/Turbo monorepo; Electron desktop, Node server, web client;
  Effect-oriented TypeScript; SQLite; local peer CLIs (Codex, Claude, Cursor,
  OpenCode, Pi, and others).[^synara-readme-l26-l33][^synara-readme-l67-l80]
  **License:** MIT.[^synara-license-l1-l10]

**Status:** Source and documentation inspection only; nothing was run. Local-first
workspace that treats each task as the durable unit: conversation, provider
session, environment, tools, and Git changes.[^synara-core-l1-l28] Neighbours:
[bb](./bb.md), [Orca](./orca.md), [Emdash](./emdash.md). High confidence on
ownership and recovery docs; moderate on delivery-journal guarantees without
running tests.

**Study**

1. **Task-owned hierarchy.** Workspace → Project → Task → Turn, with a provider
   session and an Environment (checkout or isolated worktree). The task appears
   before Git preparation finishes; the provider session starts only after the
   worktree is ready.[^synara-core-l1-l28][^synara-readme-l26-l33] llame's Chat/Run
   should stay similarly ahead of executor cwd readiness without inventing a
   second transcript authority.
2. **Adapters own protocol differences.** Synara does not host models; it wraps
   installed runtimes. Provider adapters own protocol behavior; do not assume
   every peer matches Codex capabilities.[^synara-providers-l1-l23][^synara-agents-l3-l11]
3. **Per-task delivery lanes and journals.** Commands stay ordered within a task;
   independent tasks use separate lanes with bounded concurrency. A receipt
   confirms durable acceptance; after restart Synara resumes from the settled
   event prefix and delivery journal. Orphaned child commands whose owning task
   is missing stay blocked with uncertainty preserved — no silent
   resend.[^synara-providers-l25-l51]
4. **Reconnect without replaying input.** Keepalives every 5 s; 180 s of complete
   silence starts reconnect. Recovery restores each thread from its last applied
   `afterSequence`, not by replaying the original
   input.[^synara-recovery-l1-l44] Same shape as llame run-event replay-then-tail.
5. **Guarded crash continuation.** After unexpected server shutdown, ordinary
   running chats continue with a verify-before-repeat prompt. Chats waiting on
   approval, still starting, archived, native subagents, delegated tasks, goals,
   and Hub/automation work are excluded.[^synara-core-l114-l120]
6. **Filesystem open hazards.** Workspace reads open with `O_NONBLOCK` on POSIX
   and reject non-regular descriptors so named pipes cannot stall the Node
   worker pool after client cancel.[^synara-fifo-l1-l9] Applicable to any host
   that serves repo files into agent or UI paths.

**llame fit**

- High: items 2 to 4 for peer-adapter capability honesty and Run event resume.
- Moderate: items 1 and 5 for task/environment readiness and selective recovery.
- Low: item 6 as a filesystem hygiene note for Workspace file tools.
- Avoid: Synara task/thread IDs or SQLite journals as Chat/Run authority. Peers
  remain executors; RLS stays in llame.

**Caution:** Remote bind without `--auth-token` is explicitly unsafe; token auth
is not tenant RLS.[^synara-remote-l21-l25] Early-stage APIs remain under active
change per README. Product site: [trysynara.com](https://www.trysynara.com).[^synara-site]

[^synara-readme-l26-l33]: [Project, thread, provider session, workspace tools](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/README.md#L26-L33)

[^synara-readme-l67-l80]: [Provider-native local integrations](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/README.md#L67-L80)

[^synara-license-l1-l10]: [MIT license](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/LICENSE#L1-L10)

[^synara-core-l1-l28]: [Task ownership hierarchy; worktree-gated provider start](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/core-concepts.md#L1-L28)

[^synara-core-l114-l120]: [Post-crash guarded continuation excludes approval-waiting chats](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/core-concepts.md#L114-L120)

[^synara-providers-l1-l23]: [Synara hosts no models; supported local runtimes](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/providers.md#L1-L23)

[^synara-providers-l25-l51]: [Shared surface; per-task delivery lanes and journal resume](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/providers.md#L25-L51)

[^synara-recovery-l1-l44]: [180s silence reconnect; resume from afterSequence](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/connection-recovery.md#L1-L44)

[^synara-fifo-l1-l9]: [Nonblocking open rejects named pipes; cancel cannot unblock FIFO open](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/docs/workspace-fifo-recovery.md#L1-L9)

[^synara-agents-l3-l11]: [Provider adapters own protocol; session-owned consumers](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/AGENTS.md#L3-L11)

[^synara-remote-l21-l25]: [Remote access requires auth token before non-localhost bind](https://github.com/Emanuele-web04/synara/blob/df87a48b9f2d403e3d2785ef11502f2ce2922f5b/REMOTE.md#L21-L25)

[^synara-site]: [Synara product site](https://www.trysynara.com)
