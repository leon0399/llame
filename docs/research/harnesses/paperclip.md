---
type: Reference
title: "Paperclip"
description: "Node.js and React control plane that runs a company of agents: org chart, issue tickets, heartbeat wakeups, budgets, approvals and routines, driving Claude Code, Codex and others through adapters and ACP."
tags:
  [
    harness,
    orchestration,
    peer-executor,
    acp,
    budgets,
    approvals,
    routines,
    multi-tenant,
  ]
status: draft
resource: "https://github.com/paperclipai/paperclip/tree/317ed367d4e7ef3221cccab2079018534b5be560"
generated:
  by: "claude-code/claude-opus-5-5"
  at: "2026-10-08"
observed:
  date: "2026-10-08"
  revision: "317ed367d4e7ef3221cccab2079018534b5be560"
sources:
  - id: paperclip-site
    resource: "https://paperclip.ing"
    title: "Paperclip landing page"
  - id: readme-l37-l47
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/README.md#L37-L47"
    title: "Product statement: company metaphor and bring-your-own-agent"
  - id: readme-l224-l329
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/README.md#L224-L329"
    title: "Control-plane systems: identity, tasks, heartbeats, governance, budgets, routines"
  - id: spec-l98-l123
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L98-L123"
    title: "Server, Postgres and in-process scheduler; no separate queue"
  - id: spec-l345-l389
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L345-L389"
    title: "heartbeat_runs, cost_events and approvals tables"
  - id: spec-l587-l627
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L587-L627"
    title: "Issue state machine and non-terminal liveness rule"
  - id: spec-l660-l673
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L660-L673"
    title: "Agent API key scope and prohibitions"
  - id: spec-l1234-l1258
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1234-L1258"
    title: "Atomic checkout contract"
  - id: spec-l1371-l1390
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1371-L1390"
    title: "Adapter interface and ACP-by-default local engines"
  - id: spec-l1446-l1463
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1446-L1463"
    title: "Scheduler rules and controller lease"
  - id: spec-l1494-l1537
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1494-L1537"
    title: "Hiring, strategy approval, board override, ask-first tool reviews"
  - id: spec-l1547-l1569
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1547-L1569"
    title: "Budget hard stop and usage receipts"
  - id: spec-l1666-l1677
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1666-L1677"
    title: "Security requirements and company boundary checks"
  - id: exec-l178-l202
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/execution-semantics.md#L178-L202"
    title: "checkoutRunId versus executionRunId and stale-lock recovery"
  - id: acp-l32-l99
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/acp-run-lifecycle.md#L32-L99"
    title: "Run resource ledger, settlement order and staging lease"
  - id: acp-l111-l119
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/acp-run-lifecycle.md#L111-L119"
    title: "Host-lane runtime reuse disabled because run keys are never revoked"
  - id: types-l503-l517
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/adapter-utils/src/types.ts#L503-L517"
    title: "ServerAdapterModule contract"
  - id: claude-l854-l870
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/adapters/claude-local/src/server/execute.ts#L854-L870"
    title: "Claude CLI argv: print, stream-json, resume, max-turns"
  - id: budget-policy-l5-l27
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/db/src/schema/budget_policies.ts#L5-L27"
    title: "Budget policy columns: scope, window, hard stop, unpriced policy"
  - id: wakeup-l15-l40
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/db/src/schema/agent_wakeup_requests.ts#L15-L40"
    title: "Wakeup request queue row: source, coalescedCount, idempotencyKey"
  - id: routines-schema-l37-l38
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/db/src/schema/routines.ts#L37-L38"
    title: "Routine concurrency and catch-up policy defaults"
  - id: modes-l29-l52
    resource: "https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/DEPLOYMENT-MODES.md#L29-L52"
    title: "local_trusted and authenticated deployment modes"
---

# Paperclip

- **Stack:** TypeScript monorepo (Node server, React board UI, Drizzle on Postgres with embedded Postgres by default); MIT; root package version 0.3.1, while releases use calendar tags (the site names
  `v2026.1005.0` as latest)[^readme-l37-l47][^spec-l98-l123][^paperclip-site]

**Status:** Source and documentation inspection only; nothing was run, and the
paperclip.ing landing page was read only for positioning and release claims. Paperclip models a business as
a company of agents: goals, an org chart, issue tickets and budgets sit above
whichever coding agent does the work, and the README summarizes it as "if
OpenClaw is an employee, Paperclip is the company".[^readme-l37-l47] It is a
harness in this bundle's sense because it launches and supervises tool-enabled
agent processes, though it implements no agent loop of its own. It overlaps
llame's meta-harness thesis (own identity and lifecycle, treat agents as
executors) but pitches a single-operator autonomous organization, not a
multi-user chat product. High confidence on the shape; moderate on behavior
under load, since the specs are long and visibly accreted.

**Study**

1. **Executor adapters.** An adapter is `execute`, `testEnvironment`, optional
   session codec, skills sync, model discovery and an `acp` descriptor.[^types-l503-l517]
   The legacy Claude, Codex, Gemini and Kimi local adapters select ACP when no
   engine is named, and a missing prerequisite or ACP failure fails the run
   rather than falling back to a CLI with different session, permission and
   sandbox semantics.[^spec-l1371-l1390] The Claude adapter still builds a
   `--print --output-format stream-json --resume` argv for explicit CLI
   mode.[^claude-l854-l870] Cursor, OpenCode, Pi, Hermes, Grok, OpenClaw gateway,
   HTTP and plain-process adapters also exist.[^readme-l224-l329] The no-silent-fallback
   rule is the part llame should copy.
2. **Heartbeat wakeups.** Agents run when woken: assignment, comment, blocker
   resolution, schedule or manual. Wakeups are rows with `source`,
   `coalescedCount` and `idempotencyKey`; a run is a `heartbeat_runs` row with
   status, `context_snapshot` and external run id.[^wakeup-l15-l40][^spec-l345-l389]
   The scheduler skips a paused agent, an agent with an active run and an agent
   past its hard budget, and a renewable controller lease protects a claimed run
   across overlapping deployments.[^spec-l1446-l1463] Scheduling runs inside the
   server process with no separate queue.[^spec-l98-l123] llame's pg-boss gives
   stronger delivery; the coalescing and skip rules are what transfer.
3. **Tickets as the durable unit.** A task is an issue with one assignee, parent
   and blocker edges, comments, documents and goal ancestry. Checkout is a single
   conditional `UPDATE`, answering 409 with the current owner on loss.[^spec-l1234-l1258]
   `checkoutRunId` (ownership) and `executionRunId` (live path) are separate, and
   finalization compare-and-clears only locks still pointing at the finishing
   run.[^exec-l178-l202] A liveness rule requires every agent-owned non-terminal
   issue to have a live run, a typed wait or an explicit recovery action;
   local PIDs, shells and comments count only as evidence.[^spec-l587-l627]
   Moderate confidence the liveness contract is the most reusable idea here.
4. **Run lifecycle and cleanup.** One coordinator sequences startup, turn,
   settlement and result reproduction. A ledger of six resources (runtime,
   staged workspace, two bridges, managed home, staging lease) is closed in a
   fixed order, errors recorded and later steps still run, and the lease releases
   last so a same-session run never stages into a workspace still in use.[^acp-l32-l99]
5. **Budgets.** Policies scope to company, agent or project with a window,
   warn percent (80 default), `hardStopEnabled` and an `unpricedUsagePolicy`
   defaulting to `block`.[^budget-policy-l5-l27] At 100% the agent is paused and
   checkout and invocation are blocked; usage receipts for cancelled provider
   work are still drained, and incomplete receipts keep blocking admission.[^spec-l1547-l1569]
   Cost events carry provider, model, tokens, cents and a `reported` or
   `unpriced` status.[^spec-l345-l389] The block-on-unpriced default is the
   honest answer to gateways that report no price.
6. **Approvals and governance.** Approval rows cover hiring, CEO strategy,
   budget override and generic board requests; the board can pause, reassign or
   cancel anything.[^spec-l1494-l1537] Connection tool calls can be Allowed, Ask
   first or Off; an ask-first approval runs the stored signed arguments once,
   decline runs nothing, and an interrupted uncertain execution is surfaced, not
   replayed.[^spec-l1494-l1537] Agents cannot bypass approval gates, edit
   budgets or mutate keys.[^spec-l660-l673] Relevant to llame's approvals work
   in #778.
7. **Routines.** Recurring tasks with cron, webhook or API triggers; each firing
   creates a tracked issue and wakes the assignee. Concurrency policy defaults to
   `coalesce_if_active` (alternatives `skip_if_active`, `always_enqueue`) and
   catch-up to `skip_missed`.[^routines-schema-l37-l38][^readme-l224-l329]
   Moderate confidence this is the cleanest published automation contract in the
   bundle; it maps directly onto scheduled llame Runs.
8. **Isolation and auth.** Every table carries `company_id`, and the
   specification requires "strict company boundary checks on every entity fetch
   and mutation" in application code.[^spec-l1666-l1677] No Postgres row-level
   security appears in the database documentation or specification text I
   searched (moderate confidence; the schema files were not exhaustively
   scanned). Agents authenticate with hashed per-agent bearer keys and
   short-lived run JWTs; humans use `local_trusted` (no login) or `authenticated`
   modes.[^modes-l29-l52][^spec-l660-l673]

**llame fit**

- High: item 1's no-silent-fallback rule and item 4's settlement ledger for any
  executor adapter; item 3's checkout plus liveness contract for child agents.
- High: item 7 for scheduled Runs, with the concurrency and catch-up policies as
  an explicit enum instead of implicit queue behavior.
- Moderate: item 5 for per-owner budget caps; copy the unpriced-blocks default
  and receipt drain, not the company/agent/project scope tree.
- Moderate: item 6's stored-arguments approval and no-replay-on-uncertainty rule.
- Low: the company/CEO/org-chart layer; llame has owners and Projects, not
  employees, and #778 does not need a hiring workflow.
- Avoid: application-only tenant checks. The landing page claims "complete data
  isolation" between companies in one deployment,[^paperclip-site] but the
  inspected source enforces it in application code, not in the datastore.
  llame's RLS-forced isolation is stronger, and Paperclip's pattern would
  regress it.

**Caution:** Host-lane runtime reuse is disabled because a run-minted API key
is a stateless token the control plane never revokes at run end, so a warm
runtime would carry a live credential into the next run.[^acp-l111-l119] Any llame
runtime-pooling design needs per-Run credentials that die with the Run. The
specification is long and carries many dated addenda, and the README positions autonomous 24/7 operation; treat claims of
reliability as unmeasured. Separately, "agents" here are subprocess executors
with ambient host access in `local_trusted` mode, which is incompatible with
llame's multi-user model without sandboxed execution targets.

[^readme-l37-l47]: [Product statement: company metaphor and bring-your-own-agent](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/README.md#L37-L47)

[^readme-l224-l329]: [Control-plane systems: identity, tasks, heartbeats, governance, budgets, routines](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/README.md#L224-L329)

[^spec-l98-l123]: [Server, Postgres and in-process scheduler; no separate queue](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L98-L123)

[^spec-l345-l389]: [heartbeat_runs, cost_events and approvals tables](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L345-L389)

[^spec-l587-l627]: [Issue state machine and non-terminal liveness rule](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L587-L627)

[^spec-l660-l673]: [Agent API key scope and prohibitions](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L660-L673)

[^spec-l1234-l1258]: [Atomic checkout contract](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1234-L1258)

[^spec-l1371-l1390]: [Adapter interface and ACP-by-default local engines](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1371-L1390)

[^spec-l1446-l1463]: [Scheduler rules and controller lease](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1446-L1463)

[^spec-l1494-l1537]: [Hiring, strategy approval, board override, ask-first tool reviews](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1494-L1537)

[^spec-l1547-l1569]: [Budget hard stop and usage receipts](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1547-L1569)

[^spec-l1666-l1677]: [Security requirements and company boundary checks](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/SPEC-implementation.md#L1666-L1677)

[^exec-l178-l202]: [checkoutRunId versus executionRunId and stale-lock recovery](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/execution-semantics.md#L178-L202)

[^acp-l32-l99]: [Run resource ledger, settlement order and staging lease](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/acp-run-lifecycle.md#L32-L99)

[^acp-l111-l119]: [Host-lane runtime reuse disabled because run keys are never revoked](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/acp-run-lifecycle.md#L111-L119)

[^types-l503-l517]: [ServerAdapterModule contract](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/adapter-utils/src/types.ts#L503-L517)

[^claude-l854-l870]: [Claude CLI argv: print, stream-json, resume, max-turns](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/adapters/claude-local/src/server/execute.ts#L854-L870)

[^budget-policy-l5-l27]: [Budget policy columns: scope, window, hard stop, unpriced policy](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/db/src/schema/budget_policies.ts#L5-L27)

[^wakeup-l15-l40]: [Wakeup request queue row: source, coalescedCount, idempotencyKey](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/db/src/schema/agent_wakeup_requests.ts#L15-L40)

[^routines-schema-l37-l38]: [Routine concurrency and catch-up policy defaults](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/packages/db/src/schema/routines.ts#L37-L38)

[^modes-l29-l52]: [local_trusted and authenticated deployment modes](https://github.com/paperclipai/paperclip/blob/317ed367d4e7ef3221cccab2079018534b5be560/doc/DEPLOYMENT-MODES.md#L29-L52)

[^paperclip-site]: [Paperclip landing page](https://paperclip.ing)
