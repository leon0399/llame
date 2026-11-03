---
type: Reference
title: "Clawboo"
description: "MIT Node service. Orchestration events tail by seq over SSE. Peer coding CLIs run with their own approvals off. A hard budget cap is opt-in."
resource: "https://github.com/clawboo/clawboo/tree/4a3c3068a9278c43e1ab18d8bd35371a0841ed39"
tags: [harness, orchestration, peer-executor, budgets, approvals]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "4a3c3068a9278c43e1ab18d8bd35371a0841ed39"
sources:
  - id: clawboo-license
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/LICENSE#L1-L3"
    title: "MIT License heading"
  - id: clawboo-claude
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/runtimes/claudeCodeDriver.ts#L517-L528"
    title: "Claude Agent SDK runs with bypassPermissions"
  - id: clawboo-codex
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/runtimes/codexDriver.ts#L119-L132"
    title: "codex exec is built with the bypass-approvals-and-sandbox flag"
  - id: clawboo-codex-iso
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/runtimes/codexDriver.ts#L326-L327"
    title: "The Codex spawn comment calls the worktree the isolation boundary"
  - id: clawboo-cap
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/packages/db/src/schema.ts#L765-L781"
    title: "Budget mode defaults to warn; cap is the opt-in hard stop"
  - id: clawboo-preflight
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/budgetPreflight.ts#L1-L36"
    title: "The next run starts only when no relevant cap budget is paused"
  - id: clawboo-obs
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/api/obs.ts#L114-L131"
    title: "The observation stream resumes from Last-Event-ID or since and polls every 750ms"
  - id: clawboo-doc
    resource: "https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/docs/internals/runtime-adapter.md#L87-L89"
    title: "toolApproval on the adapter is not Clawboo asking before the CLI's own tools"
---

# Clawboo

- **Stack:** Node.js 22 service, browser dashboard, pnpm workspace. MIT.[^clawboo-license] The [tierroom board](https://my-tierroom.party/agents/clawboo) and [claw.boo](https://www.claw.boo) are live pages and are not pinned. The board's security notes cite `f8975179` and release 0.5.0. This clone is `4a3c3068`, later than that pin.

Clawboo is a local team studio. The README says Boo Zero splits one request into board tasks and hands them to built-in agents or to Claude Code, Codex, Hermes, or OpenClaw. Source inspection of the peer drivers and the budget gate; nothing was run.

**Study**

1. **Peer coding CLIs are started with their own gates off.** The Claude driver sets `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true`. The comment says `ctx.cwd` only chooses the start directory, a per-task worktree or the team folder, and confines nothing.[^clawboo-claude] `buildCodexExecArgs` always appends `--dangerously-bypass-approvals-and-sandbox`.[^clawboo-codex] The adapter docs say `toolApproval: true` means the runtime can raise prompts, and that Clawboo does not use that capability for these tools. Hermes is documented as `--yolo`.[^clawboo-doc] Connector calls can still ask. The CLI's shell and file tools do not. That is the failure mode [the harness owns execution](../../../VISION.md#the-harness-owns-execution) is written to prevent: the peer is the one that decides.
2. **A worktree is not a sandbox.** The Claude comment says `ctx.cwd` only chooses the start directory, a per-task worktree or the team folder, and confines nothing.[^clawboo-claude] The Codex spawn comment says the worktree is the isolation boundary, which is why the CLI sandbox and approval prompts are bypassed.[^clawboo-codex-iso] A worktree separates git checkouts. It does not confine the process. llame's [Sandbox receives a working copy and scratch](../../../VISION.md#portable-data-isolated-execution), and a worktree is a derived view, not that fence. The managed Sandbox is [still a proposal](../../../ROADMAP.md#then-local-sandbox-execution).
3. **The board tail is a polled seq.** `GET /api/obs/stream` is `text/event-stream`. The cursor is `Last-Event-ID` or `since`, and the handler polls SQLite every 750ms.[^clawboo-obs] It is a database tail, not a push of the model token stream. llame's [run events](../../../SPEC.md#94-run-events) are the execution log the client replays. This stream is the orchestration log.
4. **A hard budget cap blocks the next start, and it is opt-in.** The `budgets.mode` column defaults to `warn`. The comment says warn records spend and never auto-pauses, and `cap` is the kill switch.[^clawboo-cap] `budgetPreflight` checks agent, then mission, then team, and blocks only when a row is `paused` and `mode === 'cap'`. The comment says a warn budget is clamped so it never reads as paused, and that a connected runtime which reports cost only at the end cannot be stopped mid-run by this preflight. The preflight stops the next start.[^clawboo-preflight]

**llame fit**

- High as a caution: item 1. An adapter that launches Codex or Claude Code must not pass a bypass flag and then describe the host as the approval authority.
- High: item 4's default of warn, with an explicit cap mode, and a preflight that refuses a new run when the cap is already paused. llame's run-budget work is open and not this design.
- Moderate: item 3. A seq the client can resume is the right shape. A 750ms poll is a different delivery contract from SSE that carries the events as they commit.
- Moderate: item 2. Say "worktree" when the mechanism is a worktree.
- Low: the board UI and shared memory, which the README describes and this pass did not open. There is no native phone app in the files read here. A shared access token, which the board says is not per-user roles, was not read.

**Caution:** The Claude comment says Clawboo gates risky tools externally.[^clawboo-claude] The same function disables the SDK's permission mode. External gating covers Clawboo's own tool server, per the adapter doc, and does not cover the CLI's shell.[^clawboo-doc] A reader who stops at `toolApproval: true` on the capability object will invert the behavior.

[^clawboo-license]: [MIT License heading](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/LICENSE#L1-L3)

[^clawboo-claude]: [Claude Agent SDK runs with bypassPermissions](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/runtimes/claudeCodeDriver.ts#L517-L528)

[^clawboo-codex]: [codex exec is built with the bypass-approvals-and-sandbox flag](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/runtimes/codexDriver.ts#L119-L132)

[^clawboo-codex-iso]: [The Codex spawn comment calls the worktree the isolation boundary](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/runtimes/codexDriver.ts#L326-L327)

[^clawboo-cap]: [Budget mode defaults to warn; cap is the opt-in hard stop](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/packages/db/src/schema.ts#L765-L781)

[^clawboo-preflight]: [The next run starts only when no relevant cap budget is paused](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/lib/budgetPreflight.ts#L1-L36)

[^clawboo-obs]: [The observation stream resumes from Last-Event-ID or since and polls every 750ms](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/apps/web/server/api/obs.ts#L114-L131)

[^clawboo-doc]: [toolApproval on the adapter is not Clawboo asking before the CLI's own tools](https://github.com/clawboo/clawboo/blob/4a3c3068a9278c43e1ab18d8bd35371a0841ed39/docs/internals/runtime-adapter.md#L87-L89)
