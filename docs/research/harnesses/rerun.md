---
type: Reference
title: "Rerun"
description: "AGPL TypeScript coworker host: an AI SDK tool loop, an in-process SSE buffer, workspace RLS on the product database, and a local libSQL engine store."
resource: "https://github.com/rerun-build/rerun"
tags: [harness, sse, approvals, schedules, multi-tenant]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "195a9070066e76af241b912536dbee0e5d5d22c5"
sources:
  - id: rerun-license
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/package.json#L66"
    title: "Root package license is AGPL-3.0-only"
  - id: rerun-engine-pkg
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/package.json#L22-L37"
    title: "Engine depends on the AI SDK, Hono, libSQL, and Drizzle"
  - id: rerun-loop
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/loop.ts#L457-L465"
    title: "streamText stops the turn when a human-in-the-loop step is over"
  - id: rerun-hitl
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/hitl.ts#L84-L98"
    title: "hitlTool returns HITL_ACK"
  - id: rerun-hitl-tools
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/hitl.ts#L175-L242"
    title: "ask_user, request_approval, suggest_service, and request_secret use hitlTool"
  - id: rerun-hitl-more
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/hitl.ts#L272-L285"
    title: "request_mcp_sign_in and request_takeover use hitlTool"
  - id: rerun-skill-event
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/loop.ts#L130-L134"
    title: "A skill proposal is announced after the run's terminal event"
  - id: rerun-buffer
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/run-streams.ts#L10-L33"
    title: "Run bytes sit in a process map and are deleted three minutes after the stream ends"
  - id: rerun-replay
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/run-streams.ts#L38-L54"
    title: "A new subscriber is enqueued the buffered chunks first"
  - id: rerun-resume
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/stream.ts#L25-L31"
    title: "A missing buffer answers 204"
  - id: rerun-heartbeat
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/stream.ts#L4"
    title: "HEARTBEAT_MS is 15 seconds"
  - id: rerun-route
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/http/routes/runs.ts#L63-L68"
    title: "GET stream returns 204 when the run row is missing"
  - id: rerun-sqlite
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/db/client.ts#L12-L15"
    title: "The engine opens one libSQL file"
  - id: rerun-runs-table
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/db/schema.ts#L34-L54"
    title: "The engine runs table has no workspace column"
  - id: rerun-workspace-fn
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/supabase/migrations/20260812121014_remote_schema.sql#L1050-L1057"
    title: "current_workspace_ids reads workspace_members for auth.uid"
  - id: rerun-agents-policy
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/supabase/migrations/20260812121014_remote_schema.sql#L2223-L2228"
    title: "Agent deletes require a workspace id from current_workspace_ids"
  - id: rerun-shell
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/shell.ts#L16-L31"
    title: "shell_exec checks a regex list, then runs in the agent cwd with the process environment"
  - id: rerun-blocked
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/sandbox.ts#L15"
    title: "The block list is a set of regular expressions"
  - id: rerun-sql-file
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/db/sqlStore.ts#L296-L304"
    title: "The SQL tool rejects libSQL fileio function names"
  - id: rerun-schedule
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/scheduler.ts#L29-L49"
    title: "markFired runs before startHeadlessRun"
  - id: rerun-computer
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/computer.ts#L26-L54"
    title: "The computer tool caps actions and is withheld from the foreman"
  - id: rerun-foreman
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/foreman.ts#L31-L37"
    title: "hubTool calls the hub and optionally runSerially"
  - id: rerun-serial
    resource: "https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/foreman.ts#L12-L17"
    title: "runSerially chains onto a module-level promise"
---

# Rerun

- **Stack:** pnpm workspace. `apps/ui` is Next.js. `apps/engine` (`rerun-engine`) is a Hono process whose loop uses the Vercel AI SDK (`ai` `^6`), with libSQL and Drizzle for its own store. Product tables live in Supabase migrations.[^rerun-engine-pkg][^rerun-sqlite] **License:** AGPL-3.0-only on the root package.[^rerun-license]

Rerun is a host for named coworkers. The engine owns the model loop. Source inspection of `195a9070066e76af241b912536dbee0e5d5d22c5`. The program was not run. README claims about a 200-app catalog and Composio were not traced into a connector implementation here.

**Study**

1. **The turn is `streamText`, and a question ends it by returning text.** `streamText` is called with the prepared tools and `stopWhen` set to `hitlTurnIsOver`.[^rerun-loop] That predicate is true once a human-in-the-loop tool call sits on an earlier step, or on the last step when the step already has user-visible text (CLI providers stop on the first such step).[^rerun-hitl] `hitlTool`'s `execute` returns `HITL_ACK`: delivered, call no other tool, end the turn, the user replies in chat.[^rerun-hitl] The same helper is what `ask_user`, `request_approval`, `suggest_service`, and `request_secret` pass to `tool()`.[^rerun-hitl-tools] `request_mcp_sign_in` and `request_takeover` use it too.[^rerun-hitl-more] A skill proposal is a different path: the comment above `emitSkillProposalEvent` says the proposal does not pause the run and is announced after the terminal event.[^rerun-skill-event] [The harness owns execution](../../../VISION.md#the-harness-owns-execution), including approvals. A card that asks the model to stop is a conversational convention. llame's current sequence still defers a full allow/ask/deny permission interface, so copying the card would be a proposal, and the pause would belong to the Run.[../../../VISION.md#explicit-deferrals]
2. **Live tokens sit in the engine process.** `registerRunStream` keeps each run's chunks in a `Map` and deletes the entry three minutes after the source ends.[^rerun-buffer] A new subscriber is first enqueued the chunks already in that buffer.[^rerun-replay] `resumeStreamResponse` returns status 204 when `subscribeRunStream` finds no buffer. Otherwise it returns an SSE body passed through `withHeartbeat`, and `HEARTBEAT_MS` is 15 seconds.[^rerun-resume][^rerun-heartbeat] The HTTP route `GET /:rid/stream` also returns 204 when the run row is missing or belongs to another agent id in the path.[^rerun-route] A reconnect after the eviction, or against another engine process, has no bytes to replay. [llame's run-event stream](../../../apps/api/src/runs/runs.controller.ts#L194-L248) reads rows past a cursor, and `Last-Event-ID` wins over the query parameter, so a restarted API still has the tail. That difference is the useful one for a future CLI: the TUI can drop and come back. The CLI that would attach remains unselected backlog.[../../../ROADMAP.md#backlog-standalone-personal-node-and-cli]
3. **Workspace RLS covers the product database. The engine's run log is one file.** `db()` opens `file:` plus a path from `dbPath()` and wraps it in Drizzle.[^rerun-sqlite] The `runs` table has id, agent, session, status, step count, a usage JSON column, provider, model, trigger source and slug, `cost_micros`, separate token columns, start and finish times, and an error column. There is no workspace column.[^rerun-runs-table] Supabase `current_workspace_ids()` is `SECURITY DEFINER` and selects `workspace_members.workspace_id` where `user_id = auth.uid()`.[^rerun-workspace-fn] The agents delete policy allows the delete when `workspace_id` is in that set.[^rerun-agents-policy] Those are two stores. Membership in the product database does not, by itself, filter the engine file. llame keeps tenant isolation in the datastore the Run uses, and fails closed without identity.
4. **Shell, SQL, schedules, and the desktop are host code with narrow guards.** `shell_exec` calls `assertCommandAllowed` and then `exec` in the agent cwd. The environment is `process.env` overlaid with the agent's env.[^rerun-shell] The block list is regular expressions for a few destructive commands (`rm -rf /`, `mkfs`, shutdown, a fork bomb, `dd if=`, and similar).[^rerun-blocked] The agent's SQL helper rejects `readfile`, `writefile`, `fsdir`, and `load_extension` after blanking strings and comments, because the comment says the libSQL build ships SQLite's fileio extension.[^rerun-sql-file] `fireSchedule` calls `markFired` before `startHeadlessRun`, and the comment above that stamp calls the choice at-most-once: a crash mid-run drops that occurrence.[^rerun-schedule] `offersComputer` requires `tools.computer`, a non-ephemeral agent, a kind other than `foreman`, and `computerAvailable()`. The file caps a run at 200 actions, or 60 when the provider is a CLI, because a CLI keeps every screenshot.[^rerun-computer] `hubTool` calls `callHub`. A spec marked `serial` goes through `runSerially`, which chains onto a module-level `serialTail` promise.[^rerun-foreman][^rerun-serial] [Local Sandbox execution](../../../ROADMAP.md#then-local-sandbox-execution) is a later stage. A regex over the command string is a proposal to reject, and the shipped bash contract is the adapter seam named on that roadmap section.

**llame fit**

- High: item 2, as a contrast already settled in llame's favor for anything that must survive a process restart. The remaining work is a CLI consumer, which is backlog.
- Moderate: item 1's explicit end-of-turn on a question, if a later approval design wants the model to stop speaking. The enforcement stays in the Run.
- Moderate: item 3's split, as a reminder that a product membership table and the execution log are different objects.
- Low: item 4's schedule stamp and the foreman's serial hub calls.
- Avoid: the shell regex list, the in-process byte buffer as a resume protocol, and copying AGPL engine code into llame.

**Caution:** AGPL-3.0-only applies to this repository.[^rerun-license] The shell child inherits the engine environment.[^rerun-shell] The computer tool drives a desktop the comment treats as the coworker's screen; this note did not see a per-coworker container. Nothing here was executed, and catalog-size claims on the README were not checked against a connector registry.

[^rerun-license]: [Root package license is AGPL-3.0-only](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/package.json#L66)

[^rerun-engine-pkg]: [Engine depends on the AI SDK, Hono, libSQL, and Drizzle](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/package.json#L22-L37)

[^rerun-loop]: [streamText stops the turn when a human-in-the-loop step is over](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/loop.ts#L457-L465)

[^rerun-hitl]: [hitlTool returns HITL_ACK](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/hitl.ts#L84-L98)

[^rerun-hitl-tools]: [ask_user, request_approval, suggest_service, and request_secret use hitlTool](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/hitl.ts#L175-L242)

[^rerun-hitl-more]: [request_mcp_sign_in and request_takeover use hitlTool](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/hitl.ts#L272-L285)

[^rerun-skill-event]: [A skill proposal is announced after the run's terminal event](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/loop.ts#L130-L134)

[^rerun-buffer]: [Run bytes sit in a process map and are deleted three minutes after the stream ends](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/run-streams.ts#L10-L33)

[^rerun-replay]: [A new subscriber is enqueued the buffered chunks first](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/run-streams.ts#L38-L54)

[^rerun-resume]: [A missing buffer answers 204](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/stream.ts#L25-L31)

[^rerun-heartbeat]: [HEARTBEAT_MS is 15 seconds](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/stream.ts#L4)

[^rerun-route]: [GET stream returns 204 when the run row is missing](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/http/routes/runs.ts#L63-L68)

[^rerun-sqlite]: [The engine opens one libSQL file](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/db/client.ts#L12-L15)

[^rerun-runs-table]: [The engine runs table has no workspace column](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/db/schema.ts#L34-L54)

[^rerun-workspace-fn]: [current_workspace_ids reads workspace_members for auth.uid](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/supabase/migrations/20260812121014_remote_schema.sql#L1050-L1057)

[^rerun-agents-policy]: [Agent deletes require a workspace id from current_workspace_ids](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/supabase/migrations/20260812121014_remote_schema.sql#L2223-L2228)

[^rerun-shell]: [shell_exec checks a regex list, then runs in the agent cwd with the process environment](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/shell.ts#L16-L31)

[^rerun-blocked]: [The block list is a set of regular expressions](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/sandbox.ts#L15)

[^rerun-sql-file]: [The SQL tool rejects libSQL fileio function names](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/db/sqlStore.ts#L296-L304)

[^rerun-schedule]: [markFired runs before startHeadlessRun](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/runtime/scheduler.ts#L29-L49)

[^rerun-computer]: [The computer tool caps actions and is withheld from the foreman](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/computer.ts#L26-L54)

[^rerun-foreman]: [hubTool calls the hub and optionally runSerially](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/foreman.ts#L31-L37)

[^rerun-serial]: [runSerially chains onto a module-level promise](https://github.com/rerun-build/rerun/blob/195a9070066e76af241b912536dbee0e5d5d22c5/apps/engine/src/tools/builtin/foreman.ts#L12-L17)
