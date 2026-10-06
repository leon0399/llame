---
type: Reference
title: "OpenDots"
description: "Self-hosted single-owner agent workspace with AG-UI, durable Threads, per-Dot computers, and scheduled work"
resource: "https://github.com/CopilotKit/OpenDots/tree/565bf781d654339ee1ce83b17ee00d76d679608e"
tags:
  - agent-harness
  - orchestration
  - ag-ui
  - copilotkit
  - computers
  - channels
status: stable
generated:
  by: "omp/openai-codex-gpt-5.6-luna"
  at: "2026-10-06"
observed:
  date: "2026-10-06"
  revision: "565bf781d654339ee1ce83b17ee00d76d679608e"
sources:
  - id: readme-overview-architecture-l37-l149
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/README.md#L37-L149"
    title: "OpenDots overview, features, and architecture"
  - id: package-json-runtime-l26-l79
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/package.json#L26-L79"
    title: "Runtime dependencies and Node engine"
  - id: license-l1-l21
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/LICENSE#L1-L21"
    title: "MIT license"
  - id: launch-announcement-2026-10-01-observed-2026-10-06
    resource: "https://www.copilotkit.ai/blog/introducing-opendots?via=dailydev"
    title: "Launch announcement (dated 2026-10-01; unversioned page observed 2026-10-06)"
  - id: dot-agent-run-l57-l127
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/dot-agent.ts#L57-L127"
    title: "DotAgent turn lifecycle and live setting checks"
  - id: dot-agent-tools-l199-l337
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/dot-agent.ts#L199-L337"
    title: "DotAgent server tools, model adapter, and bounded loop"
  - id: platform-runtime-l46-l109
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/platform.ts#L46-L109"
    title: "CopilotKit Runtime, Intelligence, and Channels wiring"
  - id: runtime-scope-l7-l80
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/runtime-scope.ts#L7-L80"
    title: "Runtime route and owner/thread scope checks"
  - id: page-tools-scope-l5-l43
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/page-tools.ts#L5-L43"
    title: "Space-scoped page tool authority"
  - id: page-review-tool-l10-l15
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/shared/page-review.ts#L10-L15"
    title: "Review-before-save tool contract"
  - id: pages-review-l131-l195
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/pages.ts#L131-L195"
    title: "Idempotent reviewed-page persistence"
  - id: pages-revision-l196-l231
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/pages.ts#L196-L231"
    title: "Optimistic page revision checks"
  - id: client-chat-l57-l213
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/client/Chat.tsx#L57-L213"
    title: "Chat agent connection, HITL, and tool rendering"
  - id: client-app-l59-l185
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/client/App.tsx#L59-L185"
    title: "Client workspace/state polling and capture projection"
  - id: client-review-l41-l205
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/client/PageReviewCard.tsx#L41-L205"
    title: "Review receipt restoration and approval UI"
  - id: computer-tools-l10-l27
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-tools.ts#L10-L27"
    title: "Per-Dot computer tool projection"
  - id: computer-service-policy-l34-l117
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-service.ts#L34-L117"
    title: "Computer credentials, permission gate, and response redaction"
  - id: computer-service-endpoint-l144-l176
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-service.ts#L144-L176"
    title: "Per-Dot computer endpoint identity binding"
  - id: computer-service-action-l221-l367
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-service.ts#L221-L367"
    title: "Audited computer actions and revocation cancellation"
  - id: computers-docs-l1-l5
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/docs/COMPUTERS.md#L1-L5"
    title: "Computer service boundary and persistence"
  - id: computers-docs-l41-l55
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/docs/COMPUTERS.md#L41-L55"
    title: "Computer deployment isolation and cautions"
  - id: runner-l18-l105
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/runner.ts#L18-L105"
    title: "Scheduled runner lease, timeout, and interruption"
  - id: store-task-l110-l294
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/store.ts#L110-L294"
    title: "Task/run/event persistence and retry state"
  - id: headless-turn-l23-l76
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/headless.ts#L23-L76"
    title: "Headless Intelligence turn for calls and schedules"
  - id: voice-session-l33-l224
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/voice.ts#L33-L224"
    title: "Voice session, compute delegation, and receipt persistence"
  - id: slack-channel-l31-l61
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/slack-channel.ts#L31-L61"
    title: "Slack identity allowlist"
  - id: slack-channel-l74-l160
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/slack-channel.ts#L74-L160"
    title: "Slack mention and subscribed-thread dispatch"
  - id: learning-l10-l33
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/learning.ts#L10-L33"
    title: "Owner-scoped Automatic Learning container selection"
  - id: browser-security-l31-l59
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/browser/security.ts#L31-L59"
    title: "Public HTTP(S) browser URL validation"
  - id: index-config-l17-l60
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/index.ts#L17-L60"
    title: "Binding, owner token, and server credential configuration"
  - id: security-md-l1-l16
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/SECURITY.md#L1-L16"
    title: "OpenDots security boundary and deployment warning"
  - id: readme-data-l180-l210
    resource: "https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/README.md#L180-L210"
    title: "Data ownership, verification status, and scope limits"
---

# OpenDots

- **Stack:** TypeScript/React and Node 24; Hono server; SQLite workspace metadata; CopilotKit Runtime and Intelligence Threads; AG-UI; TanStack AI; OpenAI-compatible model adapter; Channels SDK; optional OpenBot computer services; MIT[^package-json-runtime-l26-l79][^license-l1-l21].

OpenDots is an **agent execution and orchestration host**, not a standalone tool or hosted product. A `DotAgent` owns a bounded model/tool turn, while CopilotKit Runtime exposes the agent over the web runtime and Channels. Intelligence owns conversation persistence; SQLite owns local Spaces, Dots, page bindings, calls, tasks, and work metadata. The repository describes an alpha, single-owner template, so this entry treats the implementation as source inspection rather than a production guarantee[^readme-overview-architecture-l37-l149].

The [launch announcement](https://www.copilotkit.ai/blog/introducing-opendots?via=dailydev)[^launch-announcement-2026-10-01-observed-2026-10-06] is a product description dated October 1, 2026. It markets always-on coworkers, any AG-UI agent, any OpenAI-compatible model, calls, Slack, computers, scheduled work, and Automatic Learning. The implementation evidence below narrows those claims: this checkout wires one server-owned `DotAgent` per configured Dot, an OpenAI-compatible model adapter, CopilotKit Intelligence, and optional managed integrations. AG-UI is a supported transport boundary in the source and dependency graph; see the related [AG-UI standard entry](../standards/ag-ui.md).
For llame comparison, the current authority anchors are the [cross-cutting SPEC](../../../SPEC.md#9-chats-and-durable-runs), [durable-runs contract](../../../openspec/specs/durable-runs/spec.md), and [tool-calling recovery contract](../../../openspec/specs/tool-calling/spec.md#requirement-no-mid-run-tool-state-checkpointing-read-only-slice-write-tool-landmine). Those contracts, not OpenDots, govern llame's Chat/Run identity, queue execution, event replay, permissions, and uncertain native/MCP effects.

**Study**

1. **DotAgent is the execution loop and the server owns its authority.** `DotAgent.run` creates an abort controller, enforces a 90-second turn limit, resolves the Dot and thread, and polls settings and Dot grants every 100 ms. Pause, research/memory changes, Space changes, skill changes, or loss of the Dot abort the turn[^dot-agent-run-l57-l127]. The server then builds research, page, computer, and learned-skill tools; uses an OpenAI-compatible adapter; removes client `system` and `developer` messages before conversion; and runs TanStack AI with a five- or ten-iteration `maxIterations` bound[^dot-agent-tools-l199-l337]. CopilotKit Runtime creates a fresh `DotAgent` for each Dot and connects it to Intelligence, Channels, AG-UI routes, and server-side user identification[^platform-runtime-l46-l109]. **High confidence for llame:** this is a useful surface/executor comparison for [llame's Chat/Run split](../../../SPEC.md#9-chats-and-durable-runs), but not a replacement for llame's worker-owned Run. The model proposes tool calls; the host builds and executes the admitted catalog.

2. **Runtime scope is checked before SDK dispatch.** OpenDots accepts only an explicit subset of `/api/copilotkit/` paths and methods, rejects reserved/ambiguous suffixes, validates agent ids against local Dots, and requires every supplied thread id to belong to the local owner and selected Dot[^runtime-scope-l7-l80]. This is a narrow, server-side defense against a client naming another thread or agent. **Moderate confidence for llame #42:** an AG-UI/channel adapter should project UI protocol identifiers onto an already-authorized Chat/Run, never let a protocol payload choose tenant identity or executor authority. llame's current UI bridge and append-only Run events remain canonical; OpenDots' runtime route is not a cross-installation execution protocol.

3. **Pages are scoped artifacts with a real review boundary.** Page tools resolve a requested Space on every call, re-check the active Dot's access, return page links, and tell the model that page content is untrusted data rather than system instructions[^page-tools-scope-l5-l43]. The separate `review_space_page` tool explicitly says to present a draft, wait, and not create the page after the review call[^page-review-tool-l10-l15]. `createReviewed` validates the draft, writes the page and `(threadId, toolCallId)` review receipt in one transaction, makes retries idempotent, and rejects a changed draft or alternate Space under the same tool-call id[^pages-review-l131-l195]. Ordinary page edits use an expected revision and reject stale writes[^pages-revision-l196-l231]. **Moderate confidence for llame #41 and #778:** this is a concrete artifact-draft/approval projection to study, not shipped llame behavior. llame currently has operator permission decisions but no interactive approval workflow; any adoption must preserve owner-scoped artifact authority and the existing tool-event/replay contract.
   The UI is a projection rather than an authority: `Chat` connects a CopilotKit agent, installs human-in-the-loop and computer renderers, and sends only after page context is loaded[^client-chat-l57-l213]; `App` polls `/state` and `/workspace` plus per-thread captures, while `PageReviewCard` restores the `(threadId, toolCallId)` receipt before presenting approval and reports the saved page back to the agent[^client-app-l59-l185][^client-review-l41-l205].

4. **Each Dot can project a separately authorized computer executor.** Computer tools expose only non-human actions to the model and label the result as untrusted; paths are relative to the Dot workspace and shell runs inside that computer[^computer-tools-l10-l27]. The service requires supervisor, master, and per-Dot configuration, derives an HMAC credential from the Dot id, checks persisted browser/files/shell grants, and refuses agent actions while paused. Its gateway rejects redirects, caps responses at 4 MB, redacts infrastructure secrets from upstream JSON, and binds a returned endpoint to the expected Dot/container/namespace[^computer-service-policy-l34-l117]. Every action is audited with actor and outcome, human controls cannot be invoked by an agent, active requests are cancelled when grants disappear, and browser takeover is not bypassed on a 409 response[^computer-service-action-l221-l367]. The deployment keeps the Docker socket with the supervisor, not the app or computer, and persists per-Dot files/browser profiles; however, standard containers share the host kernel, shell has network access, and no restrictive egress policy is configured[^computers-docs-l1-l5][^computers-docs-l41-l55]. **Moderate confidence for llame #756 and #758:** copy the explicit authority and endpoint-binding seams for a future Sandbox/Workspace adapter, not the single-owner policy or implied isolation. llame's current native executor is host authority and its current workers do not transfer execution authority across nodes.
   Endpoint identity is checked separately from the permission/credential gate: `endpoint` requires the expected Dot id and namespace-derived container, then permits only the validated network or loopback origin[^computer-service-endpoint-l144-l176].

5. **Scheduled work is a separate SQLite lease runner over an Intelligence conversation.** The runner polls once per second, permits only one active task in this process, claims a task, checks lease ownership every 100 ms, applies a 90-second timeout, records progress, and marks a stopped or expired lease Interrupted with a review-before-retry message[^runner-l18-l105]. SQLite stores tasks, runs, append-only task events, leases, and results; explicit `run`, `pause`, `cancel`, and recurring schedule operations transition those rows, while an interrupted or failed task is retried explicitly rather than automatically replayed from a semantic checkpoint[^store-task-l110-l294]. New scheduled tasks must bind to an existing owner conversation, and the server invokes a headless Intelligence agent with that thread id[^headless-turn-l23-l76]. **Moderate confidence for llame #309 and #1047:** the review-effects-before-retry UX is relevant to semantic execution checkpoints and continuing failed Runs. Do not import OpenDots' 90-second budget, one-active-task process limit, or SQLite lease as a durability model: llame's current `pg-boss`/RunExecutionService and `outcome_unknown` fence are authoritative, and native/MCP effects are not replayed after uncertain settlement.

6. **Channels and calls reuse the same Dot/thread authority, but identity remains single-owner.** The managed Slack channel maps only a configured Slack tenant and explicit human user allowlist to one local owner id[^slack-channel-l31-l61]. Mentions run the agent and subscribe the thread; later messages run only when that thread is subscribed, with serial channel storage and safe provider-error reporting[^slack-channel-l74-l160]. Voice establishes a Realtime provider session from bounded prior history and exposes only `ask_compute`; the compute call delegates to `platform.turn` with the selected thread and a six-turn call cap, then stores a local receipt and attempts Intelligence sync[^headless-turn-l23-l76][^voice-session-l33-l224]. **Moderate confidence for llame #42 and #759:** treat AG-UI/Channels as ingress and presentation adapters over llame's authenticated Chat/Run, not as authority owners. OpenDots' allowlisted Slack actors all become one owner, so it is not a multi-user tenancy or identity model.

7. **Automatic Learning is explicit, owner-scoped, and reviewable.** The Learning selector rejects any user other than the workspace owner, permits channel learning only for the configured Slack Dot, binds a new channel thread locally, and returns the thread's stored container id[^learning-l10-l33]. A DotAgent adds the learned-skill catalog and snapshot-bound server executors only when the Dot's delivery flag and conversation container are present[^dot-agent-tools-l199-l337]. The setup contract says existing conversations are not enrolled retroactively, proposed skills need Intelligence review/publication, and delivery failure is not silently degraded. **Moderate confidence for llame #821:** the explicit per-conversation catalog snapshot is a useful comparison for changed skill/instruction announcements. llame already owns operator/workspace skill source precedence and permission admission; ambient learning identifiers must not widen a Chat's tool authority.

8. **Deployment separates local artifacts, conversation authority, and provider boundaries.** The app requires Node 24 and server-side Intelligence/model credentials; external host binding requires a 24-character `OWNER_TOKEN`, while the default runtime and database paths are local[^index-config-l17-l60]. Pages, thread bindings, and work metadata live in SQLite, but conversation messages, tool calls, and run events live in the configured Intelligence deployment; the README explicitly says a SQLite backup alone does not contain conversation history[^readme-data-l180-l210]. The optional browser worker accepts only authenticated public HTTP(S) URLs, blocks credentials, nonstandard ports, localhost/private/special addresses, and mixed DNS results[^browser-security-l31-l59]. OpenDots' own security warning calls the template single-owner and not security-audited, requiring HTTPS/authentication, server-held credentials, explicit Space/Dot/thread authorization, and caution around page/model output[^security-md-l1-l16]. **High confidence as a deployment caution:** OpenDots is a useful inventory of provider and artifact boundaries, not evidence that a live deployment is safe; its source README also distinguishes connected-service verification from fixtures.

**llame applications**

- **AG-UI projection (High confidence, no adoption implied).** Compare OpenDots' exact runtime path/agent/thread checks with llame's existing UI-message bridge and Run event stream. A future AG-UI adapter should carry a trusted llame Run id, replay stored tool activity, and reject protocol-supplied owner or executor selection. This belongs at the transport edge; it must not bypass `RunExecutionService`, RLS, or the shared tool gate.
- **Approved artifact drafts (Moderate confidence, #41/#778).** OpenDots demonstrates a narrow review tool whose idempotency key is a thread/tool-call pair and whose write transaction creates the page plus receipt. llame could use the shape for a future artifact proposal, but its current contract has no interactive approval. The approval record would need to be a durable Run event/result with owner authorization, changed-draft invalidation, and explicit behavior when a worker or browser disconnects.
- **Workspace/Sandbox executor adapter (Moderate confidence, #756/#758).** Per-Dot computer identity, endpoint binding, capability flags, audit records, and live revocation are reusable seams. The current llame native executor deliberately remains host authority, and `Workspace` is an owner-scoped binding inside one installation; OpenDots' Docker computer is not a substitute for a future llame Sandbox or remote Node protocol.
- **Scheduled conversation turns (Moderate confidence, #309/#1047).** OpenDots' task detail page, event timeline, interruption status, and "retry after review" label expose useful operator semantics. llame should retain its stronger queue lease, single-flight, first-writer-wins, and `outcome_unknown` rules rather than copying an application-level timer or replaying a partially applied tool loop.
- **Channel ingress (Moderate confidence, #42).** The Slack allowlist and subscribed-thread model provide a concrete adapter test matrix: tenant, actor, mention, thread continuity, pause behavior, and safe error replies. llame must map external actors to authenticated external identities and owner/org grants instead of OpenDots' single owner id.
- **Skill/artifact provenance (Moderate confidence, #821).** Store a conversation's admitted skill/catalog epoch and its source identity as explicit provenance, then announce changed availability through llame's existing context-injection rules. OpenDots' Learning container id is routing state, not authorization; llame's operator catalog and permission layers remain the authority.

**Caution**

- The announcement's "always-on coworker" language should not be read as durable autonomous execution. The source implementation has a 90-second `DotAgent` turn limit and a separate 90-second scheduled-run limit, a single active scheduled task per process, and external Intelligence as conversation authority.
- OpenDots' human-in-the-loop card approves one page draft; it is not a generic tool permission broker. Computer permissions are owner-configured and checked in server code, while model/client text is untrusted.
- The template is explicitly single-owner. Slack allowlists collapse permitted actors to one owner, and the repository warns that connected multi-user use needs additional enforcement. Do not use its SQLite owner id as a tenancy design.
- Persistent Docker computers are not a host-security proof. Shell commands and browser profiles live in a container with host-kernel sharing and unrestricted network egress by default; revoking a grant cancels admission but cannot undo completed effects or guarantee an upstream operation stopped.
- Back up both SQLite and Intelligence, and account for provider egress. Model context can contain authorized page content and tool results; Parallel receives research objectives/URLs by default; speech, Slack, Channels, Automatic Learning, and telemetry have their own configured service boundaries.
- This is source inspection only. README claims of live verification and the announcement's product claims were not independently rerun here; no adoption or safety certification follows from this reference.

[^readme-overview-architecture-l37-l149]: [OpenDots overview, features, and architecture](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/README.md#L37-L149)

[^launch-announcement-2026-10-01-observed-2026-10-06]: [Launch announcement (dated 2026-10-01; unversioned page observed 2026-10-06)](https://www.copilotkit.ai/blog/introducing-opendots?via=dailydev)

[^package-json-runtime-l26-l79]: [Runtime dependencies and Node engine](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/package.json#L26-L79)

[^license-l1-l21]: [MIT license](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/LICENSE#L1-L21)

[^dot-agent-run-l57-l127]: [DotAgent turn lifecycle and live setting checks](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/dot-agent.ts#L57-L127)

[^dot-agent-tools-l199-l337]: [DotAgent server tools, model adapter, and bounded loop](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/dot-agent.ts#L199-L337)

[^platform-runtime-l46-l109]: [CopilotKit Runtime, Intelligence, and Channels wiring](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/platform.ts#L46-L109)

[^runtime-scope-l7-l80]: [Runtime route and owner/thread scope checks](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/runtime-scope.ts#L7-L80)

[^page-tools-scope-l5-l43]: [Space-scoped page tool authority](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/page-tools.ts#L5-L43)

[^page-review-tool-l10-l15]: [Review-before-save tool contract](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/shared/page-review.ts#L10-L15)

[^pages-review-l131-l195]: [Idempotent reviewed-page persistence](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/pages.ts#L131-L195)

[^pages-revision-l196-l231]: [Optimistic page revision checks](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/pages.ts#L196-L231)

[^client-chat-l57-l213]: [Chat agent connection, HITL, and tool rendering](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/client/Chat.tsx#L57-L213)

[^client-app-l59-l185]: [Client workspace/state polling and capture projection](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/client/App.tsx#L59-L185)

[^client-review-l41-l205]: [Review receipt restoration and approval UI](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/client/PageReviewCard.tsx#L41-L205)

[^computer-tools-l10-l27]: [Per-Dot computer tool projection](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-tools.ts#L10-L27)

[^computer-service-policy-l34-l117]: [Computer credentials, permission gate, and response redaction](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-service.ts#L34-L117)

[^computer-service-endpoint-l144-l176]: [Per-Dot computer endpoint identity binding](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-service.ts#L144-L176)

[^computer-service-action-l221-l367]: [Audited computer actions and revocation cancellation](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/computer-service.ts#L221-L367)

[^computers-docs-l1-l5]: [Computer service boundary and persistence](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/docs/COMPUTERS.md#L1-L5)

[^computers-docs-l41-l55]: [Computer deployment isolation and cautions](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/docs/COMPUTERS.md#L41-L55)

[^runner-l18-l105]: [Scheduled runner lease, timeout, and interruption](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/runner.ts#L18-L105)

[^store-task-l110-l294]: [Task/run/event persistence and retry state](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/store.ts#L110-L294)

[^headless-turn-l23-l76]: [Headless Intelligence turn for calls and schedules](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/headless.ts#L23-L76)

[^voice-session-l33-l224]: [Voice session, compute delegation, and receipt persistence](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/voice.ts#L33-L224)

[^slack-channel-l31-l61]: [Slack identity allowlist](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/slack-channel.ts#L31-L61)

[^slack-channel-l74-l160]: [Slack mention and subscribed-thread dispatch](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/slack-channel.ts#L74-L160)

[^learning-l10-l33]: [Owner-scoped Automatic Learning container selection](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/learning.ts#L10-L33)

[^browser-security-l31-l59]: [Public HTTP(S) browser URL validation](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/browser/security.ts#L31-L59)

[^index-config-l17-l60]: [Binding, owner token, and server credential configuration](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/src/server/index.ts#L17-L60)

[^security-md-l1-l16]: [OpenDots security boundary and deployment warning](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/SECURITY.md#L1-L16)

[^readme-data-l180-l210]: [Data ownership, verification status, and scope limits](https://github.com/CopilotKit/OpenDots/blob/565bf781d654339ee1ce83b17ee00d76d679608e/README.md#L180-L210)
