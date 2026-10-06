---
type: Reference
title: "AG-UI (Agent–User Interaction Protocol)"
description: "Event protocol connecting agent runs to user-facing applications; candidate durable llame Run stream adapter"
resource: "https://docs.ag-ui.com/spec/1.0"
tags:
  - agent-user-interaction
  - event-streaming
  - human-in-the-loop
  - state-synchronization
  - protocol
status: stable
generated:
  by: "human:leon0399"
  at: "2026-10-06"
observed:
  date: "2026-10-06"
  revision: "e0e6bff83b747ffd26feb780c22a546d0ceb87b8"
sources:
  - id: agui-announcement
    resource: "https://www.copilotkit.ai/blog/ag-ui-1.0"
    title: "Introducing AG-UI 1.0: a stable spec for connecting any agent to any application"
  - id: agui-readme
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/README.md#L41-L68"
    title: "AG-UI repository overview and protocol stack"
  - id: agui-license
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/LICENSE#L1-L21"
    title: "AG-UI repository license"
  - id: agui-spec-architecture
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/architecture.mdx#L6-L108"
    title: "AG-UI 1.0 architecture and run model"
  - id: agui-schema
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/spec/1.0/schema.json#L1-L80"
    title: "AG-UI 1.0 JSON Schema event set"
  - id: agui-generated-version
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/core/src/generated/version.ts#L1-L11"
    title: "Generated TypeScript protocol version"
  - id: agui-core-package
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/core/package.json#L1-L8"
    title: "@ag-ui/core package protocol metadata"
  - id: agui-spec-package
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/spec/package.json#L1-L7"
    title: "AG-UI schema package metadata"
  - id: agui-spec-input
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/run-input.mdx#L6-L145"
    title: "AG-UI 1.0 run input"
  - id: agui-spec-state
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/state.mdx#L6-L96"
    title: "AG-UI 1.0 state and message snapshots"
  - id: agui-spec-tools
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/tool-calls.mdx#L6-L217"
    title: "AG-UI 1.0 tool calls and frontend tools"
  - id: agui-spec-metadata
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/metadata.mdx#L6-L79"
    title: "AG-UI 1.0 metadata"
  - id: agui-spec-interrupts
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/patterns/interrupt-resume.mdx#L6-L115"
    title: "AG-UI 1.0 interrupts and resume"
  - id: agui-spec-lifecycle
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/lifecycle.mdx#L6-L193"
    title: "AG-UI 1.0 run lifecycle and replay"
  - id: agui-spec-transports
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/transports/index.mdx#L6-L70"
    title: "AG-UI 1.0 transport binding contract"
  - id: agui-spec-sse
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/transports/http-sse.mdx#L6-L55"
    title: "AG-UI 1.0 HTTP and SSE binding"
  - id: agui-client-agent
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/agent.ts#L296-L400"
    title: "AG-UI TypeScript AbstractAgent run pipeline"
  - id: agui-client-connect
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/agent.ts#L406-L484"
    title: "AG-UI TypeScript connectAgent extension point"
  - id: agui-client-input
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/agent.ts#L578-L689"
    title: "AG-UI TypeScript input preparation and resume checks"
  - id: agui-client-reducer
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/apply/default.ts#L384-L830"
    title: "AG-UI TypeScript state, tool and message reducer"
  - id: agui-client-reducer-init
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/apply/default.ts#L135-L180"
    title: "AG-UI TypeScript reducer initialization"
  - id: agui-client-lifecycle-reducer
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/apply/default.ts#L1086-L1141"
    title: "AG-UI TypeScript lifecycle reducer"
  - id: agui-client-verifier
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/verify/verify.ts#L220-L277"
    title: "AG-UI TypeScript stream verifier"
  - id: agui-client-verifier-closing
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/verify/verify.ts#L946-L1028"
    title: "AG-UI TypeScript verifier run closure rules"
  - id: agui-spec-subagents
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/subagents.mdx#L6-L127"
    title: "AG-UI 1.0 subagent attribution"
  - id: agui-client-enforcement
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/enforce/enforce.ts#L50-L120"
    title: "AG-UI TypeScript event enforcement boundary"
  - id: agui-client-transport
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/http.ts#L41-L103"
    title: "AG-UI TypeScript HTTP agent"
  - id: agui-client-sse
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/transform/sse.ts#L20-L126"
    title: "AG-UI TypeScript SSE parser"
  - id: agui-client-compact
    resource: "https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/compact/compact.ts#L77-L115"
    title: "AG-UI TypeScript event compaction"
---

# AG-UI (Agent–User Interaction Protocol)

- **Status:** CopilotKit's 2026-09-30 announcement calls AG-UI 1.0 a stable
  specification, says its TypeScript, Python and .NET SDKs are generated from
  a JSON Schema, and presents backwards compatibility as a release claim.[^agui-announcement]
  The pinned repository is the stronger implementation evidence: `spec/1.0/schema.json`
  has the `$id` `https://ag-ui.com/spec/1.0/schema.json` and enumerates 31 event
  values, while the generated TypeScript core declares `PROTOCOL_VERSION = "1.0"`.[^agui-schema][^agui-generated-version]
  `@ag-ui/core` is version `1.0.2` and carries protocol metadata `1.0` at this
  revision.[^agui-core-package] The private `@ag-ui/spec` package remains a
  development-only `0.0.0` artifact, so use the versioned schema/spec and
  generated SDK metadata—not a monorepo package version—as wire status.[^agui-spec-package]
  The repository is MIT-licensed.[^agui-license]

AG-UI is a typed, ordered event stream between a user-facing application and an
agent endpoint. The application sends one `RunAgentInput`; the endpoint emits
lifecycle, message, tool, state, activity, reasoning, subagent and passthrough
events. The 1.0 behavioural specification is separate from the schema: the
schema is authoritative for shape, while the prose defines ordering, lifecycle,
compatibility and trust-boundary behaviour.[^agui-spec-architecture][^agui-schema]

The repository README is useful orientation but is not the wire contract: at the
observed revision it still describes roughly 16 standard event types, whereas
the pinned 1.0 schema lists 31. Read the versioned specification and generated
artifacts when these summaries disagree.

**Complementary role.** AG-UI occupies the agent-to-user/application layer:
MCP supplies agent access to tools and data, A2A coordinates independent agents,
and AG-UI carries the observable run into a UI or channel.[^agui-readme] A2A or
MCP can sit behind an AG-UI bridge; neither is replaced. ACP is a different
client-to-coding-agent session protocol and is likewise complementary rather
than another AG-UI event family ([llame's ACP note](./agent-client-protocol.md)).
OpenDots is a concrete AG-UI consumer; see [the OpenDots study](../harnesses/opendots.md).
AG-UI does not define a task directory, an execution authority, a credential
scheme or a durable queue.

**Study**

1. **Ordered runs, stable thread identity and explicit lineage.** `threadId`
   names the conversation and stays stable across runs; `runId` names one run
   and MUST NOT be reused on that thread. `parentRunId` describes a separately
   invoked child run, not a subagent lane. A run begins with `RUN_STARTED` (or a
   first `RUN_ERROR`), ends with `RUN_FINISHED` or `RUN_ERROR`, and the stream
   MAY carry earlier runs before the requested run when replaying a thread. A
   later `RUN_STARTED` opens the next run only after the prior one closes.[^agui-spec-input][^agui-spec-lifecycle]
   `protocolVersion` is declared by the consumer on input and by the producer
   on `RUN_STARTED`, so a recorded exchange can expose a version downgrade.
   **Moderate confidence for llame adapter design, not a resolved wire mapping:**
   correlate an authenticated Chat with `threadId` and the requested `runId` with
   the durable Run that this request actually starts or explicitly attaches to.
   Keep execution-attempt, external adapter and provider identifiers in metadata;
   a history-only replay needs a separate cursor/correlation and MUST NOT relabel
   an existing execution as a new run.

2. **State synchronization is snapshot plus JSON Patch.** `STATE_SNAPSHOT`
   replaces the complete state; `STATE_DELTA` applies an RFC 6902 patch against
   the current baseline, which begins at input `state` and persists across runs.
   `MESSAGES_SNAPSHOT` reconciles by message id and preserves client-only
   activity/reasoning material when the producer cannot know it.[^agui-spec-state]
   The TypeScript reducer starts from cloned agent/input state[^agui-client-reducer-init],
   replaces on a snapshot, applies patches atomically, warns and keeps the old
   value when a patch cannot apply, and reconciles snapshot messages by id rather
   than blindly appending them.[^agui-client-reducer] **Moderate confidence for
   llame:** a future AG-UI projection can expose a bounded UI state document
   and persist its snapshots/deltas beside Run events, but current llame Run
   events are not an AG-UI state contract; define ownership, sequence and
   schema validation before making state durable.

3. **Tools and human input cross a run boundary in two distinct ways.**
   Application-provided (frontend) tools arrive in `RunAgentInput.tools`; the
   agent streams `TOOL_CALL_START`/`ARGS`/`END`, but the application executes the
   call and returns a tool message in the next input. The producer may name
   unanswered calls in `pendingToolCallIds`; continuation must answer every
   dangling call. Agent-side tools can instead return `TOOL_CALL_RESULT` in the
   same run, including multimodal content parts.[^agui-spec-tools] An explicit
   approval, credential or choice uses `RUN_FINISHED` with an interrupt outcome;
   the next run carries a `resume` entry for every interrupt, with a payload or
   explicit cancellation. This is not a mid-stream callback channel.[^agui-spec-interrupts]
   The client reducer tracks unanswered tool calls and records pending
   interrupts only after subscribers accept the terminal event; its initializer
   rejects uncovered or expired answers for a real `runAgent()` call, while a
   history-only `connectAgent()` replay does not answer anything.[^agui-client-lifecycle-reducer][^agui-client-input]
   **High confidence for llame's frontend-tool adapter; low confidence for
   approval:** llame's current operator permission gate is not an interactive
   approval workflow ([`SPEC.md`](../../../SPEC.md) §7.5; #778), so an adapter
   MUST NOT claim that AG-UI interrupts can authorize a currently blocked tool.

4. **Transport bindings separate delivery from semantics.** The normative
   binding contract requires ordered, complete events, one input before the
   stream, a distinguishable terminal signal and an out-of-stream error path.
   HTTP + SSE is the required HTTP binding; HTTP + Protobuf is optional, and
   WebSockets/message buses/in-process pipes are allowed custom bindings if they
   preserve the same contract. Authentication and authorization belong to the
   binding/application, not AG-UI.[^agui-spec-transports] In the default SSE
   binding, one POST carries JSON input and each `data` frame carries one JSON
   event; HTTP 200 does not prove run success. SSE `Last-Event-ID` is not used:
   a connection that dies without a terminal event is a truncated run, and
   rerunning uses a new `runId` with retained input.[^agui-spec-sse] The
   TypeScript `HttpAgent` sends POST + `Accept: text/event-stream`; its parser
   selects Protobuf only for the AG-UI binary media type and otherwise parses
   SSE, with a bounded 10 MiB unterminated-frame buffer.[^agui-client-transport][^agui-client-sse]
   **High confidence for a llame adapter:** serve AG-UI from the existing
   durable event log as a fresh replay/live stream, not as a second worker or
   an SSE resume protocol.

5. **The reference client is a compatibility and state pipeline, not merely a
   JSON parser.** `AbstractAgent.runAgent()` composes compatibility middleware,
   event enforcement, chunk expansion, verification and reducer application in
   that order. Unknown event types/fields are dropped or stripped with warnings;
   malformed known fields are fatal, and middleware gets the chance to translate
   retired shapes before enforcement.[^agui-client-agent][^agui-client-enforcement]
   Verification tracks open message/tool/step/subagent entities and rejects
   invalid sequencing, owner changes or a run that closes with active entities.[^agui-client-verifier][^agui-client-verifier-closing]
   The reducer applies events into cloned messages/state, makes replayed tool
   starts idempotent, inserts tool results beside their owning assistant call,
   and emits subscriber mutations. **High confidence for llame:** apply this
   same boundary to stored events during reconnect/replay; never let a replay
   bypass enforcement just because its bytes came from llame storage.

6. **Subagents and observability are attributed, not separate conversations.**
   `subagentRunId` identifies an invocation; events may interleave, nested
   invocations use `parentSubagentRunId`, and attribution on state is provenance
   for one run-scoped state document rather than a private subagent state.
   `SUBAGENT_ERROR` ends the invocation but not necessarily the parent run, and
   subagent model usage is included in the parent run's terminal usage.[^agui-spec-subagents]
   Metadata is the open extension channel for trace/model identifiers[^agui-spec-metadata],
   reasoning, activity and multimodal tool content are first-class event/message
   families. **Moderate confidence for llame:** this could project future worker
   or delegated-agent activity into one Run without inventing a second Run
   store; it is not a current llame subagent contract (#765).

**Durable llame applications**

- **Run-to-stream projection (moderate confidence; adapter contract still
  required).** An authenticated POST can resolve a Chat and create or attach to
  one queued/running llame Run. The adapter should emit `RUN_STARTED`, project
  persisted model/tool/lifecycle events in sequence, then emit one terminal
  outcome. `threadId` and the requested `runId` are correlations after
  server-side ownership checks, never selectors supplied by an untrusted caller;
  only the execution actually started or explicitly attached may carry that
  `runId`. This matches llame's durable Run and append-only `run_events` contract
  in [`SPEC.md`](../../../SPEC.md) §9.3–9.6.
- **Reconnect and history restore (moderate confidence; compatibility design
  work).** A browser or channel reconnect should use an explicitly defined
  history-only connect path to read the authenticated Chat's stored event log,
  replay complete prior runs, and attach the live tail. The TypeScript SDK's
  `connectAgent()` hook is such an extension point, not the normative HTTP/SSE
  POST binding.[^agui-client-connect] A normative POST rerun uses a new `runId`
  and therefore cannot merely relabel an existing llame Run or retry its
  native/MCP effect; a new
  `runAgent()` request is a new execution unless llame specifies an authenticated
  attach extension. Define that cursor, terminal/truncation, and authorization
  contract before shipping. llame's existing `outcome_unknown` rule remains
  authoritative when an attempt has no durable result. A UI cursor may optimize
  the read, but it is not SSE `Last-Event-ID`.
- **Frontend effects and artifacts (moderate confidence).** A channel or web UI
  can advertise narrowly scoped frontend tools (navigation, selection, upload,
  rendering) and answer them through the next Run's tool message. Persist the
  request/result as observations and keep side effects outside model authority;
  map large files to llame's artifact boundary rather than embedding unbounded
  bytes in `state` or `TOOL_CALL_RESULT`. This complements the future artifact
  work in [#41](https://github.com/leon0399/llame/issues/41) and channels work in
  [#42](https://github.com/leon0399/llame/issues/42).
- **Approval and steering bridge (low confidence, explicitly deferred).**
  `Interrupt`/`resume` is a useful wire shape for a future approval UI or active
  Run steering, but current llame permissions fail closed and return
  `permission_denied`; they do not pause a model loop for a user decision.
  Keep this behind a capability and a new Run contract, coordinated with
  [#778](https://github.com/leon0399/llame/issues/778) and
  [#782](https://github.com/leon0399/llame/issues/782), rather than treating an
  AG-UI `resolved` payload as authorization.
- **Delegated-worker view (low-to-moderate confidence).** If llame later exposes
  subagents or remote execution, `subagentRunId` can attribute interleaved
  progress while the durable Run remains the system of record. It must not
  imply that AG-UI grants remote Workspace authority, cross-node placement or
  resumption; those boundaries remain unshipped ([#758](https://github.com/leon0399/llame/issues/758),
  [#765](https://github.com/leon0399/llame/issues/765)).

**llame fit: study.** These are adapter applications, not an adoption decision.
Current llame identity, RLS, tool allowlists, permission policy, native effect
fencing and queue recovery remain authoritative; AG-UI supplies a user-facing
projection and compatibility vocabulary only.

**Caution**

- **Authorization is outside the protocol.** AG-UI defines no credential and
  accepts client-supplied `threadId`, `runId`, `state`, `context`, `tools` and
  opaque `forwardedProps`. Bind every request to the server-authenticated llame
  owner and Chat, apply RLS and capability/permission gates, and never let a
  resume payload or tool declaration widen authority. The AG-UI application
  owning the user is not proof that the agent endpoint authorized the action.
- **Tool and state content is untrusted.** Validate tool arguments against the
  admitted schema, treat results and state patches as data rather than
  instructions, escape rendered content, and require explicit consent for
  consequential effects. URL media and provider file handles need bounded,
  provider-aware fetching; `file` handles are opaque and must not be parsed or
  fetched by a generic bridge.
- **Durability is not supplied by SSE.** A dropped connection has no outcome and
  may have followed an effect whose result was not observed. Persist an
  intent/attempt record before dispatch and the result after settlement, make
  replay idempotent, and surface unknown effects instead of retrying them. A
  fresh AG-UI stream MUST not silently turn a truncated or cancelled llame Run
  into success.
- **Replay must preserve the enforcement boundary.** Apply compatibility,
  enforcement, verification and reducer logic to stored as well as live events.
  `compactEvents()` is useful for a UI/history projection, but its own source
  warns that it can reorder events and only safely collapses state windows that
  contain a snapshot; it is not a replacement for the append-only durable log.[^agui-client-compact]
- **Compatibility can hide terminal meaning.** An older client strips an
  unrecognised outcome and reads the run as success. Keep terminal semantics in
  the published 1.0 outcome set, negotiate versions in-band, and use metadata
  or `CUSTOM` only for additional application display—not for an authorization
  or settlement decision.

[^agui-announcement]: [Introducing AG-UI 1.0: a stable spec for connecting any agent to any application](https://www.copilotkit.ai/blog/ag-ui-1.0)

[^agui-readme]: [AG-UI repository overview and protocol stack](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/README.md#L41-L68)

[^agui-license]: [AG-UI repository license](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/LICENSE#L1-L21)

[^agui-spec-architecture]: [AG-UI 1.0 architecture and run model](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/architecture.mdx#L6-L108)

[^agui-schema]: [AG-UI 1.0 JSON Schema event set](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/spec/1.0/schema.json#L1-L80)

[^agui-generated-version]: [Generated TypeScript protocol version](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/core/src/generated/version.ts#L1-L11)

[^agui-core-package]: [@ag-ui/core package protocol metadata](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/core/package.json#L1-L8)

[^agui-spec-package]: [AG-UI schema package metadata](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/spec/package.json#L1-L7)

[^agui-spec-input]: [AG-UI 1.0 run input](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/run-input.mdx#L6-L145)

[^agui-spec-state]: [AG-UI 1.0 state and message snapshots](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/state.mdx#L6-L96)

[^agui-spec-tools]: [AG-UI 1.0 tool calls and frontend tools](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/tool-calls.mdx#L6-L217)

[^agui-spec-interrupts]: [AG-UI 1.0 interrupts and resume](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/patterns/interrupt-resume.mdx#L6-L115)

[^agui-spec-lifecycle]: [AG-UI 1.0 run lifecycle and replay](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/lifecycle.mdx#L6-L193)

[^agui-spec-transports]: [AG-UI 1.0 transport binding contract](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/transports/index.mdx#L6-L70)

[^agui-spec-sse]: [AG-UI 1.0 HTTP and SSE binding](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/transports/http-sse.mdx#L6-L55)

[^agui-client-agent]: [AG-UI TypeScript AbstractAgent run pipeline](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/agent.ts#L296-L400)

[^agui-client-connect]: [AG-UI TypeScript connectAgent extension point](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/agent.ts#L406-L484)

[^agui-client-input]: [AG-UI TypeScript input preparation and resume checks](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/agent.ts#L578-L689)

[^agui-client-reducer]: [AG-UI TypeScript state, tool and message reducer](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/apply/default.ts#L384-L830)

[^agui-client-lifecycle-reducer]: [AG-UI TypeScript lifecycle reducer](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/apply/default.ts#L1086-L1141)

[^agui-client-verifier]: [AG-UI TypeScript stream verifier](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/verify/verify.ts#L220-L277)

[^agui-client-verifier-closing]: [AG-UI TypeScript verifier run closure rules](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/verify/verify.ts#L946-L1028)

[^agui-client-enforcement]: [AG-UI TypeScript event enforcement boundary](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/enforce/enforce.ts#L50-L120)

[^agui-client-transport]: [AG-UI TypeScript HTTP agent](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/agent/http.ts#L41-L103)

[^agui-client-sse]: [AG-UI TypeScript SSE parser](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/transform/sse.ts#L20-L126)

[^agui-client-compact]: [AG-UI TypeScript event compaction](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/compact/compact.ts#L77-L115)

[^agui-spec-metadata]: [AG-UI 1.0 metadata](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/basic/metadata.mdx#L6-L79)

[^agui-client-reducer-init]: [AG-UI TypeScript reducer initialization](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/sdks/typescript/packages/client/src/apply/default.ts#L135-L180)

[^agui-spec-subagents]: [AG-UI 1.0 subagent attribution](https://github.com/ag-ui-protocol/ag-ui/blob/e0e6bff83b747ffd26feb780c22a546d0ceb87b8/docs/spec/1.0/events/subagents.mdx#L6-L127)
