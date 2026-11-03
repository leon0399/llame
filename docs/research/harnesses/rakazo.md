---
type: Reference
title: "Rakazo"
description: "TypeScript bot host: Postgres event cursors, in-process run wakeups, a sandbox-provider switch, and approval keys bound to arguments."
resource: "https://github.com/elie222/rakazo/tree/59a7bad31fe7822fbc178965c552c265402eba28"
tags: [harness, events, sandbox, routines, approvals, multi-tenant]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "59a7bad31fe7822fbc178965c552c265402eba28"
sources:
  - id: rakazo-license
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/LICENSE#L1-L3"
    title: "Apache License 2.0 heading"
  - id: rakazo-readme-clients
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/README.md#L12-L15"
    title: "Web, Electron, iPhone, and Android clients"
  - id: rakazo-readme-features
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/README.md#L24-L31"
    title: "Bots, routines, delegation, and named sandbox providers"
  - id: rakazo-readme-stack
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/README.md#L47-L56"
    title: "Hono, Postgres, Graphile Worker, and Pi"
  - id: rakazo-batch
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/src/events.ts#L76"
    title: "Event batches are 200 rows"
  - id: rakazo-follow
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/src/events.ts#L2180-L2234"
    title: "Realtime publishes a cursor; followers read events after that seq"
  - id: rakazo-event-row
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/schema.prisma#L911-L928"
    title: "Event rows are unique on threadId and seq"
  - id: rakazo-run-row
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/schema.prisma#L949-L978"
    title: "Run lease, checkpoint, and one retry of a failed routine run"
  - id: rakazo-routine
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/schema.prisma#L1170-L1205"
    title: "Routine crons, webhook, GitHub, and watch JSON"
  - id: rakazo-factory
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/sandbox-factory.ts#L71-L80"
    title: "Unknown sandbox providers throw; the allowed set is named"
  - id: rakazo-desktop
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/desktop-sandbox.ts#L62-L69"
    title: "Host-command desktop provider is refused outside Electron, development, and test"
  - id: rakazo-missing
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/sandbox-factory.ts#L62-L68"
    title: "A remote provider without its key becomes a none provider"
  - id: rakazo-approval
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/core/src/approval-effect-key.ts#L47-L59"
    title: "Approval key hashes canonical arguments and ignores model tool-call ids"
  - id: rakazo-occurrence
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/core/src/approval-effect-key.ts#L60-L69"
    title: "A later identical call adds an occurrence suffix"
  - id: rakazo-rls
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/migrations/20261021140000_row_level_security/migration.sql#L1-L10"
    title: "Table owners and superusers bypass the policies"
  - id: rakazo-rls-policy
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/migrations/20261021140000_row_level_security/migration.sql#L40-L49"
    title: "RLS is enabled and the tenant policy matches app.space_id"
  - id: rakazo-wakeup
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/run-wakeup.ts#L136-L160"
    title: "run.continue sets wakeAt in Postgres; Graphile run deliveries are leftover no-ops"
  - id: rakazo-cancel
    resource: "https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/apps/api/src/thread-target.ts#L1499-L1526"
    title: "Cancel writes a durable terminal event, then deletes transient progress rows"
---

# Rakazo

- **Stack:** TypeScript monorepo (Hono and oRPC API, React/Vite web, Electron, Expo). PostgreSQL and Prisma. Graphile Worker. Pi for model calls. Apache-2.0.[^rakazo-license][^rakazo-readme-stack] The [tierroom board](https://my-tierroom.party/agents/rakazo) and [rakazo.com](https://rakazo.com) are live pages and are not pinned.

Rakazo is a self-hosted bot host: persistent bots, their threads, and a computer provider the operator selects. Clients are web, Electron, iPhone, and Android.[^rakazo-readme-clients] Source inspection only; nothing was run. The board's feature grid restates the README and is not a separate test.

**Study**

1. **The thread event log is the reconnect cursor.** `events` are unique on `(threadId, seq)`.[^rakazo-event-row] `notifyRealtime` publishes `{ cursor }` on `thread:<id>`. `followThreadEvents` then reads `seq > cursor` in batches of 200 and waits for the next wake, or a poll timeout when realtime is absent.[^rakazo-batch][^rakazo-follow] A missed wake is recovered from the table. That is the same split as llame's [append-only run events](../../../SPEC.md#94-run-events): the database is the log, and the push is a hint. llame streams the events themselves over SSE. Rakazo's follower refetches rows.
2. **A Run is a leased row, and the process that makes it due starts it.** `Run` carries `leaseOwner`, `leaseFence`, `leaseExpiresAt`, and `checkpoint`. A routine failure may be retried once (`retryOfRunId` is unique).[^rakazo-run-row] `RunJobPublisher` writes `wakeAt` and calls an in-process starter for `run.continue`. Its cancel path says legacy Graphile deliveries for a run key can drain as no-ops.[^rakazo-wakeup] The README still lists Graphile Worker in the stack.[^rakazo-readme-stack] Cancel writes `run.cancelled` in the same transaction as the status flip, then deletes transient progress rows. The comment says the new seq stays above every deleted row so a client whose cursor pointed at one does not treat later events as stale.[^rakazo-cancel]
3. **The sandbox provider is a closed switch.** `createSandboxProvider` accepts `none | docker | e2b | novita | daytona | createos | boat | boxd | railway | kubernetes | wuying | desktop | fake` and throws on any other string. A remote kind without its API key returns `NoneSandboxProvider` with an unavailable message.[^rakazo-factory][^rakazo-missing] `SANDBOX_PROVIDER=desktop` throws outside Electron, development, and test, because it runs commands on the host.[^rakazo-desktop] Provider selection therefore does not fall through to the host. This pass did not trace a running computer's crash path. The README also names shared Team Computers and private computers, plus delegation to peer bots or short-lived subagents.[^rakazo-readme-features]
4. **An approval names the arguments.** `approvalEffectKey` is `runId:toolName:` plus a SHA-256 of canonically serialized JSON. The comment says model tool-call ids change on replay, so they stay out of the key.[^rakazo-approval] `toolEffectIdempotencyKey` adds `:occurrence` when that count is greater than zero.[^rakazo-occurrence]
5. **Routines are rows.** Cron expressions, timezone, webhook, GitHub, and a JSON watch live on `Routine`, indexed by `(active, nextRunAt)`.[^rakazo-routine] Overlap policy was not read in the scheduler implementation.

**llame fit**

- High: item 1's durable seq plus a wake that carries only the cursor, and item 3's refusal to select an unnamed provider or a host-command provider on a server.
- High: item 4 for any approval that must survive a replayed tool-call id. llame already treats [the harness as the executor](../../../VISION.md#the-harness-owns-execution).
- Moderate: item 2's lease and single routine retry. llame's queue is pg-boss; the lease shape is the part to compare, and child-agent orchestration remains [behind the personal loop](../../../VISION.md#runs-are-the-unit-of-execution).
- Low: the Expo clients. A phone that attaches to a host matches [a Surface, not a Node](../../../VISION.md#local-capability-is-not-a-thin-client) only when the host keeps Run authority. That split is visible here. The phone apps were not installed.

**Caution:** Row-level security is enabled, with a tenant policy that matches `app.space_id` and a system bypass setting.[^rakazo-rls-policy] The migration says table owners and superusers bypass those policies, and an install that still connects as the owner does not enforce them. `FORCE ROW LEVEL SECURITY` does not appear in that migration tree.[^rakazo-rls] llame forces RLS. A missing remote sandbox key yields a none provider, which is unavailable computers, and this pass did not prove every later failure path stays off the host.

[^rakazo-license]: [Apache License 2.0 heading](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/LICENSE#L1-L3)

[^rakazo-readme-clients]: [Web, Electron, iPhone, and Android clients](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/README.md#L12-L15)

[^rakazo-readme-features]: [Bots, routines, delegation, and named sandbox providers](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/README.md#L24-L31)

[^rakazo-readme-stack]: [Hono, Postgres, Graphile Worker, and Pi](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/README.md#L47-L56)

[^rakazo-batch]: [Event batches are 200 rows](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/src/events.ts#L76)

[^rakazo-follow]: [Realtime publishes a cursor; followers read events after that seq](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/src/events.ts#L2180-L2234)

[^rakazo-event-row]: [Event rows are unique on threadId and seq](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/schema.prisma#L911-L928)

[^rakazo-run-row]: [Run lease, checkpoint, and one retry of a failed routine run](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/schema.prisma#L949-L978)

[^rakazo-routine]: [Routine crons, webhook, GitHub, and watch JSON](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/schema.prisma#L1170-L1205)

[^rakazo-factory]: [Unknown sandbox providers throw; the allowed set is named](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/sandbox-factory.ts#L71-L80)

[^rakazo-desktop]: [Host-command desktop provider is refused outside Electron, development, and test](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/desktop-sandbox.ts#L62-L69)

[^rakazo-missing]: [A remote provider without its key becomes a none provider](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/sandbox-factory.ts#L62-L68)

[^rakazo-approval]: [Approval key hashes canonical arguments and ignores model tool-call ids](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/core/src/approval-effect-key.ts#L47-L59)

[^rakazo-occurrence]: [A later identical call adds an occurrence suffix](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/core/src/approval-effect-key.ts#L60-L69)

[^rakazo-rls]: [Table owners and superusers bypass the policies](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/migrations/20261021140000_row_level_security/migration.sql#L1-L10)

[^rakazo-rls-policy]: [RLS is enabled and the tenant policy matches app.space_id](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/db/prisma/migrations/20261021140000_row_level_security/migration.sql#L40-L49)

[^rakazo-wakeup]: [run.continue sets wakeAt in Postgres; Graphile run deliveries are leftover no-ops](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/packages/adapters/src/run-wakeup.ts#L136-L160)

[^rakazo-cancel]: [Cancel writes a durable terminal event, then deletes transient progress rows](https://github.com/elie222/rakazo/blob/59a7bad31fe7822fbc178965c552c265402eba28/apps/api/src/thread-target.ts#L1499-L1526)
