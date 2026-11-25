---
type: Reference
title: "CopilotKit OpenBot"
description: "MIT coworker workspace whose threads live in CopilotKit Intelligence, whose browser joins an AG-UI gateway socket, and whose composer parks a send while the turn is busy."
resource: "https://github.com/CopilotKit/OpenBot/tree/9270cd835301d95122e614ed7e498aacd68da2a9"
tags: [harness, ag-ui, sessions, streaming, approvals, memory, mcp, desktop]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-25"
observed:
  date: "2026-11-10"
  revision: "9270cd835301d95122e614ed7e498aacd68da2a9"
sources:
  - id: cpkob-license
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/LICENSE#L1"
    title: "MIT License heading"
  - id: cpkob-readme-license
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/README.md#L105-L115"
    title: "The template is MIT; Intelligence is separately licensed"
  - id: cpkob-pkg
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/package.json#L2-L14"
    title: "Bun workspaces and the MIT package"
  - id: cpkob-server-pkg
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/package.json#L15-L26"
    title: "Server pins AG-UI 1.0.2 and CopilotKit runtime 1.85.0"
  - id: cpkob-app-pkg
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/package.json#L17-L20"
    title: "App pins AG-UI core 1.0.2 and CopilotKit React 1.85.0"
  - id: cpkob-stack
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/architecture.md#L1-L16"
    title: "A React and Vite app, a Hono server, and Intelligence"
  - id: cpkob-runtime
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/copilot.ts#L147-L158"
    title: "One Intelligence mode; external Bots are AG-UI HttpAgents"
  - id: cpkob-config
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/config.ts#L1166-L1198"
    title: "Boot throws when Intelligence URL, gateway, or key is missing"
  - id: cpkob-cors
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/copilot.ts#L3236-L3264"
    title: "Runtime CORS is the deployment origin; onBeforeHandler marks the asked run"
  - id: cpkob-group
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/group.ts#L1-L19"
    title: "A group gives each Bot its own thread and a shared transcript"
  - id: cpkob-assertion
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L1-L143"
    title: "The token is stored as a hash; the assertion lasts ten minutes"
  - id: cpkob-read
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L145-L174"
    title: "readRunAssertion returns null on a bad signature, a bad shape, or expiry"
  - id: cpkob-authorise
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L333-L366"
    title: "authoriseAgentCall refuses when the assertion does not read"
  - id: cpkob-approved
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L399-L413"
    title: "An approved action is read with expiry ignored"
  - id: cpkob-coord
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/coordination-wiring.ts#L248-L266"
    title: "Without a handoff claim, coordination fills the run from the request"
  - id: cpkob-lock
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/toolkit/src/copilotkit/thread-lock.ts#L25-L34"
    title: "One run per conversation; a busy thread refuses rather than queues"
  - id: cpkob-queue
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/components/channels/composer/queue.ts#L182-L290"
    title: "A busy composer parks the draft; an idle send keeps typed order"
  - id: cpkob-work
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/work/queue.ts#L1-L28"
    title: "Work claims use skip locked and the database clock; notify is not delivery"
  - id: cpkob-routines
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/routines/sweep.ts#L1-L22"
    title: "A due routine becomes one work item; the queue owns the claim"
  - id: cpkob-grace
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/routines/sweep.ts#L166-L190"
    title: "A stamp outside the grace window is advanced and not offered"
  - id: cpkob-stall
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/stall-guard.ts#L1-L42"
    title: "Intelligence mode answers JSON; AG-UI events ride a gateway WebSocket"
  - id: cpkob-stall-sse
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/stall-guard.ts#L220-L282"
    title: "RUN_ERROR is written on an SSE stall; a protobuf stream is closed without it"
  - id: cpkob-stall-event
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/stall-guard.ts#L378-L381"
    title: "The stalled event type is RUN_ERROR"
  - id: cpkob-events
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/events.ts#L1-L18"
    title: "Channel activity is a NOTIFY hint and is not replayed"
  - id: cpkob-join
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/lib/copilot/join-thread.ts#L1-L22"
    title: "A join that hits its deadline is not a trustworthy replay"
  - id: cpkob-provider
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/lib/copilot/provider.tsx#L24-L65"
    title: "The browser uses the session cookie and does not receive the Intelligence key"
  - id: cpkob-triggers
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/components/channels/composer/draft.ts#L15-L16"
    title: "The composer triggers are @ and /"
  - id: cpkob-terminal
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/components/computer/computer-terminal.tsx#L7-L13"
    title: "The terminal tab is the Bot's shell; taking control takes the computer"
  - id: cpkob-desktop
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/desktop/src-tauri/Cargo.toml#L1-L28"
    title: "The desktop binary is a Tauri 2 shell"
  - id: cpkob-activity
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/lib/computers/activity.ts#L14-L37"
    title: "Activity is read from tool results, including after reload"
  - id: cpkob-activity-doc
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/architecture.md#L159-L161"
    title: "The architecture page says the activity list is gone on reload"
  - id: cpkob-gateway
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/gateway.ts#L1-L21"
    title: "Resolve the element from the server snapshot, then ask policy"
  - id: cpkob-attempt
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/gateway.ts#L800-L811"
    title: "A refusal is written immediately; an attempt row waits until the approval gate passes"
  - id: cpkob-policy
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/policy.ts#L303-L418"
    title: "An absent policy denies; a broken deny denies; a broken allow does not permit"
  - id: cpkob-default
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/policy-store.ts#L41-L56"
    title: "The written default allows every action and is not an absent policy"
  - id: cpkob-default-wire
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/index.ts#L673-L676"
    title: "The store starts from configuration or that written default"
  - id: cpkob-classify
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/catalogue.ts#L655-L674"
    title: "An unadvertised name is a write; a recorded read is consulted first"
  - id: cpkob-mcp
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/mcp.ts#L509-L516"
    title: "The MCP call speaks the protocol after grant and policy"
  - id: cpkob-selection
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/selection.ts#L1-L118"
    title: "Narrowing is not a grant; the default floor is twelve"
  - id: cpkob-selection-apply
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/selection.ts#L262-L320"
    title: "Under the floor, or when the chooser fails or names nothing, every granted tool stays offered"
  - id: cpkob-search
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/tool-search.ts#L16-L58"
    title: "Past fifty tools, searchable app tools can wait behind search_tools"
  - id: cpkob-search-plan
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/tool-search.ts#L116-L149"
    title: "Tools that stay in front, and a searchable set of eight or fewer, skip the search"
  - id: cpkob-passwords
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/passwords/types.ts#L1-L7"
    title: "A sign-in secret reaches the browser and not the transcript"
  - id: cpkob-memory
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/memory/intelligence.ts#L25-L83"
    title: "User scope only; a failed call leaves the local tables in use"
  - id: cpkob-memory-read
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/memory/intelligence.ts#L178-L227"
    title: "list, recall, and create return undefined when Intelligence is unavailable or the call fails"
  - id: cpkob-drop-vector
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/drizzle/0010_drop_the_document_index.sql#L1-L26"
    title: "The document tables, embedding column, and vector extension are dropped"
  - id: cpkob-web
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/web-research.md#L1-L34"
    title: "Public-web research is Parallel, Exa, or Firecrawl, through the plugin store"
  - id: cpkob-computers
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/architecture.md#L75-L89"
    title: "A supervisor gives each person a computer; an isolated Bot gets its own"
  - id: cpkob-workspace
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/agent-computer/src/workspace.ts#L1-L14"
    title: "The computer process runs as root; paths stay inside the workspace"
  - id: cpkob-gvisor
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docker-compose.yml#L435-L437"
    title: "gVisor is opt-in; an empty COMPUTER_RUNTIME shares the host kernel"
  - id: cpkob-chart
    resource: "https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/charts/openbot/values.yaml#L368-L442"
    title: "The chart default is one shared computer running as uid 1001"
---

# CopilotKit OpenBot

- **Stack:** TypeScript on Bun. The root package is MIT, private, and lists workspaces `app`, `server`, `worker`, `shared`, `toolkit`, and `extension`, with `packageManager` `bun@1.4.3`.[^cpkob-license][^cpkob-pkg] The architecture page describes a React app and a Hono API server, and the service table calls the app a React/Vite interface.[^cpkob-stack] The desktop binary is Tauri 2.[^cpkob-desktop] The server pins `@ag-ui/client` and `@ag-ui/core` at `1.0.2` and `@copilotkit/runtime` at `1.85.0`. The app pins `@ag-ui/core` at `1.0.2` and `@copilotkit/react-core` at `1.85.0`.[^cpkob-server-pkg][^cpkob-app-pkg] Source inspection of `9270cd835301d95122e614ed7e498aacd68da2a9`. Nothing was run.

This is [CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot), a workspace of AI coworkers. It is a different repository from [nightly-labs OpenBot](./openbot.md). [OpenDuet](./openduet.md) vendors an older copy of this tree under a proactive tenant. The [AG-UI](../standards/ag-ui.md) note is the protocol; this page is how this template uses it.

**Study**

1. **The template is MIT. Boot requires CopilotKit Intelligence, which the README licenses separately.** The README says the application template is MIT, and that Intelligence is a separate license: a free local license on a laptop, a trial for a Kubernetes evaluation, and a production license after that. The same section says OpenBot, Intelligence, and a compatible model can run locally, and that a cloud model still sends requests to that service.[^cpkob-readme-license] `runtimeCapabilities` throws when `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, or the Intelligence API key is missing. A license token is forwarded when set and is not one of those three required values.[^cpkob-config] The runtime file has one mode. Built-in Bots are CopilotKit `BuiltInAgent`s. External Bots are AG-UI `HttpAgent`s, so a server that speaks the protocol is a Bot without a framework adapter in this file. The comment says a deployment without Intelligence forgets every conversation.[^cpkob-runtime] llame keeps [Chat and Run identity in its own database](../../../SPEC.md#9-chats-and-durable-runs). A required second product for the transcript is a dependency this template accepts and llame does not.

2. **A channel is the conversation. An Intelligence thread holds one agent. A tool callback checks a signed run assertion.** A group cannot be one thread with two speakers. Each Bot gets a thread of its own in `group_bot_threads`, the turn runs on the headless AG-UI path into that thread, and the people read `group_messages`, one row per person message and one per Bot reply. A reply that names a peer as `@Name` hands off under the same grant, depth cap, fan-out cap, leased queue, and audit rows as any other hop. A non-member and a missing channel get the same not-found answer.[^cpkob-group] The callback token identifies the agent and is stored only as a hash. The run assertion is separate, because the token is reused and the run is not. It carries `botId`, `actorId`, `runId`, optional `threadId`, optional `depth`, optional `initiator`, and optional `handoff`. The lifetime comment says ten minutes, and the constant is `10 * 60 * 1000` milliseconds. `threadId` is the deployment's statement of which thread the run is in, so the model cannot name the destination. `depth` travels in the assertion because a counter held in one process stops applying when the next hop lands on another pod. `initiator` travels for that same reason. The assertion is sent in AG-UI `forwardedProps`.[^cpkob-assertion] `readRunAssertion` returns null for a non-string, a bad signature, a payload missing `botId`, `actorId`, `runId`, or `exp`, or an expiry that has passed, unless the caller sets `ignoreExpiry`.[^cpkob-read] `authoriseAgentCall` answers 401 when that read is null.[^cpkob-authorise] An approval that is carried out later reads the same signature with expiry ignored, because the person may answer after ten minutes.[^cpkob-approved] Coordination keeps a matching assertion when it carries `handoff`. Otherwise it builds the run from the request, and copies `depth` and `initiator` from the assertion when one was present.[^cpkob-coord] The thread lock is one run at a time. It is taken before anything is streamed, because the gateway checks every event against the run the lock names. A conversation that is already running refuses rather than queues.[^cpkob-lock] The composer is a separate client rule. An idle send with an empty park goes out as the draft. A send while `busy` is true appends the draft to the park and starts no run. An idle send that finds parked messages joins them with the live draft, in the order they were typed, and addresses the result to the live draft's agent.[^cpkob-queue] Work claims use `select ... for update skip locked` inside a transaction, the lease is named in SQL against the database clock, and `pg_notify` is a hint: a lost notification costs up to one poll interval, not the work.[^cpkob-work] The routine sweep offers a firing whose stamp is still inside the grace window, with key `routineId:minute`. A stamp outside that window is advanced and not offered.[^cpkob-routines][^cpkob-grace] The group module says a hop uses that same leased queue.[^cpkob-group] llame's [pending deliveries are owner-scoped rows](../../../SPEC.md#9-chats-and-durable-runs), and [one Chat has at most one non-terminal Run](../../../SPEC.md#9-chats-and-durable-runs). The park here is a client function. The refusal is the platform lock. A second surface that sends anyway meets the refusal, and the typed order lives in the browser that parked the drafts.

3. **The chat turn is an Intelligence thread, not an OpenBot event log.** In Intelligence mode the server's reply to the browser is a JSON envelope. AG-UI events reach the browser on a WebSocket to the Intelligence gateway. The Bot's own response is the stream this process can watch: a pass-through that does not buffer or parse, with the clock on the read from the Bot.[^cpkob-stall] On a stall, when `sse` is set, the guard writes one `RUN_ERROR` and closes the stream. `sse` is false when the content type is the protobuf media type, and that stream is closed without the event.[^cpkob-stall-sse][^cpkob-stall-event] The header comment says both surfaces already subscribe to `RUN_ERROR`, and that the packaged chat draws nothing of its own for a failed run.[^cpkob-stall] A separate channel socket carries roster activity over Postgres `NOTIFY`. The module calls it an optimisation: it is not replayed, and the roster query stays the record.[^cpkob-events] Joining a thread is a connect with a deadline. A connect ended at the deadline has replayed only part of the history, so a caller that reads how the last run ended cannot trust that replay. The exception is a turn still being written: ending the join at the deadline left the reply mid-word until a reload, so that join stays up until the turn finishes.[^cpkob-join] The provider posts to `/api/copilotkit` with `credentials: "include"`. There is no `publicApiKey`. The comment says the Intelligence key stays on the server.[^cpkob-provider] The runtime handler sets CORS to this deployment's origins and the Recorder. The comment says that leaving the `cors` option out would answer `Access-Control-Allow-Origin: *`. `onBeforeHandler` marks that the run was asked. Trajectory gating and product telemetry run there when those options are set.[^cpkob-cors] llame's [run events are an append-only log that clients subscribe to, reconnect, and replay](../../../SPEC.md#94-run-events). This template's turn history is the Intelligence thread, and a join that stops early is not that log. [AG-UI](../standards/ag-ui.md) is the event vocabulary on the gateway socket. The channel `NOTIFY` socket is a hint to refetch.

4. **The owner's screen is the web app, inside a Tauri shell on the desktop.** The desktop package is `openbot-desktop`, a Tauri 2 binary with a tray icon.[^cpkob-desktop] The composer registers two triggers, `@` and `/`.[^cpkob-triggers] The computer panel's Terminal tab is the Bot's live shell, drawn like the browser card, with the same Take control and Hand back. Taking control there takes the whole computer, and the Bot waits until it is handed back.[^cpkob-terminal] Activity beside the screen is read from tool results in the conversation, keyed by the call, including when the conversation is opened again after a reload. The module calls that a view. The audit trail is the record, and the pane keeps no second copy of command output in the database.[^cpkob-activity] `docs/architecture.md` in the same commit says the activity list is held in the browser and is gone on reload.[^cpkob-activity-doc] This note follows the module. Generative UI is passed to the provider only when the deployment capabilities say it is on. The comment says the SDK treats the prop as on whenever the prop is present, so an unconditional prop would offer the tool in a deployment whose server had declined the events that paint it.[^cpkob-provider] A [first-party CLI is backlog](../../../ROADMAP.md#backlog-standalone-personal-node-and-cli). The screen this template does specify, and a TUI can use, is a transcript, a composer that parks while a turn is live, and a host-owned control of the computer. The approval and the takeover stay on that host surface.

5. **The computer gateway resolves the target, asks policy, and records before it acts. Skill choice and tool search do not grant.** The gateway resolves the caller's ref from the server-held snapshot. The comment says a gateway that trusted the model's label would accept a different name for the same ref.[^cpkob-gateway] A decision that does not forward is written and thrown. A decision that forwards asks the approval gate before the attempt row, and that row is written once the action is going to the computer.[^cpkob-attempt] An absent policy denies. Deny rules run first, and a broken deny expression still denies. A broken allow expression does not permit. When no allow matches, `allowed` is false. `forward` stays true in `dry-run`, so that miss is recorded and still sent on.[^cpkob-policy] The store's written default is a separate object: `mode: "enforce"`, `deny: []`, `allow: ["true"]`. Boot uses the configured policy or that default.[^cpkob-default][^cpkob-default-wire] So an engine with no policy object refuses, and a deployment that has not written a policy still permits and records. The sign-in module sends a credential from the person's form to the Bot's browser and excludes it from tool arguments, tool results, transcript rows, AG-UI events, audit payloads, and logs. The model hears whether sign-in worked.[^cpkob-passwords] An MCP `callTool` speaks the protocol after grant and policy. The function does not decide permission.[^cpkob-mcp] `classifyTool` returns `write` for a name the server never advertised. A recorded effect string is consulted before the missing-entry branch: the exact string `read` is a read, and any other recorded string is a write. A tool with no catalogue entry and no recorded string is a write.[^cpkob-classify] Skill narrowing chooses which granted tools to offer. The comment says a retrieval prefilter that drops the needed tool cannot be repaired by the model, so uncertain cases offer more. The default floor is twelve.[^cpkob-selection] The function offers every granted tool when the granted list is at or under that floor, when no skill declares a granted tool, when the message is empty, when the chooser returns nothing usable, or when it names no skill. A throw sets that same empty choice, unless the abort signal is already aborted, in which case the abort propagates. A successful choice offers those skills' tools plus every granted tool no skill claims.[^cpkob-selection-apply] `planToolSearch` returns no waiting names when the granted tools plus `alsoSent` are at or under fifty, or when the searchable set is at most eight. Tools that are not searchable, web-research tools, and always-on tools stay in front. The model searches for the rest, and the names it is shown are sent from the next step under their real names. The grant, the policy, and the audit row still run for a waiting tool. OpenAI's `tool_search` and Anthropic's `defer_loading` were tried and rejected: the runtime replayed the provider search as an ordinary tool call, and the conversation failed from the second message.[^cpkob-search][^cpkob-search-plan] [The harness owns execution](../../../VISION.md#the-harness-owns-execution). llame ships operator allow/reject at the execution gate. An interactive approval workflow does not ship ([Approvals](../../../SPEC.md#75-approvals)). The shape to keep is resolve-from-server-state, fail closed on a broken rule, and a catalogue trim that cannot add a tool. The written default that allows every computer action is the caution, not the engine.

6. **Memory reads follow the Intelligence entitlement. Skills are declarations. The runtime hook in this file is server code.** Every memory call names the person and asks for `user` read-write and `project` none. Results are filtered to `scope === "user"` after they arrive.[^cpkob-memory] `list`, `recall`, and `create` return `undefined` when `available()` is false or the call throws.[^cpkob-memory-read] The module comment says the store then keeps its own tables.[^cpkob-memory] A skill's `tools` field is described as a declaration, not a grant.[^cpkob-selection] A failed narrowing leaves every granted tool offered.[^cpkob-selection-apply] The runtime hook on the CopilotKit handler is `onBeforeHandler`. It marks that the run was asked, and runs trajectory gating and product telemetry when those options are set.[^cpkob-cors] [Memory has distinct stores](../../../VISION.md#memory-has-distinct-stores): a skill here is instructions loaded when a message selects it, and a memory row is a separate store whose project scope is dropped.

7. **Migration `0010` drops the document embedding tables.** It drops `chunks`, `document_acls`, and `documents`, then `DROP EXTENSION IF EXISTS "vector"`. The comment says the `embedding` column on `chunks` was the only use of that extension, that nothing has read or written those tables since the document connector was removed, and that the replacement is asking the vendor at the moment of the question. A deployment that still has its own vector column fails this migration, and the comment says the transaction then leaves the three tables in place.[^cpkob-drop-vector] Public-web research is three catalogue providers, Parallel, Exa, and Firecrawl, each with a search tool and a fetch tool. Calls go through the plugin store. The page says full conversations are not forwarded.[^cpkob-web] `search_tools` ranks tools the Bot was already granted.[^cpkob-search] `recall` ranks the person's Intelligence memories when that client returns them.[^cpkob-memory-read] A future llame code-search tool does not get an embedding schema from this migration. What the selection comment does specify is the failure to avoid: a prefilter that drops the needed tool leaves the model nothing to call.[^cpkob-selection]

8. **Compose with a supervisor gives each person a computer. The Helm chart's default is one shared computer running as uid 1001.** The architecture page says that without `COMPUTER_SUPERVISOR_URL` every Bot shares `AGENT_COMPUTER_URL`. With it, each person gets a container, every Bot has its own folder and browser profile in that container, and a Bot marked Isolated gets a container of its own. The shared computer keeps the deployment token and is not a boundary between people. Compose leaves `COMPUTER_RUNTIME` empty and says an unset runtime shares the host kernel. `runsc` selects gVisor.[^cpkob-computers][^cpkob-gvisor] The workspace module says the computer process runs as root inside its container. Absolute paths are refused, the resolved path must stay inside the workspace, and that check is repeated after symlinks.[^cpkob-workspace] The chart's default `computers.mode` is `shared`: one browser for every Bot, and a command one Bot runs can read another's files. `runtimeClassName` is empty. `podSecurityContext` sets `runAsNonRoot: true` and `runAsUser: 1001`. The comment says the Compose and supervisor images are still uid 0, and that `podSecurityContext: null` is how a chart install runs as root again.[^cpkob-chart] A search of `server/src` for `ROW LEVEL SECURITY` and `CREATE POLICY` returned no matches. Owner checks in this tree are application predicates, the same gap [OpenDuet](./openduet.md) records for its vendored copy. [Local Sandbox execution](../../../ROADMAP.md#then-local-sandbox-execution) is a later llame stage, and a sandbox failure there does not fall back to the host.

**llame fit**

- High: item 3, for the TUI and the web client. Subscribe to [run events](../../../SPEC.md#94-run-events), reconnect, and replay that log. A gateway socket can paint the live turn. A join that stops at a deadline is a partial history, and the module says the caller must not treat it as how the run ended. The channel `NOTIFY` socket is a hint to refetch, which is the same job as a change signal beside a log.
- High: item 2, for the API. The signed assertion is the host's statement of bot, actor, thread, depth, and initiator. The composer park keeps typed order while a turn is live, and it lives in the client. llame's pending deliveries are rows, so a TUI on a second device sees the same queue the web app sees.
- High: item 5. Resolve the target from server state, write the decision before the action, fail closed on a broken rule, and keep skill choice and tool search inside the grant. Keep a sign-in secret out of the transcript, the events, and the audit payload.
- High: item 7, as a boundary for a semantic search tool. This commit deletes the embedding table. The search that remains is a granted-tool search, a vendor web search, and an entitled memory recall. The selection comment refuses a prefilter that can hide the tool the turn needed.
- Moderate: item 4. A transcript, an input with `@` and `/`, a park while the turn is live, and a host-drawn takeover of the computer. Generative UI stays off unless the server says it is on.
- Moderate: item 8, beside the later sandbox stage. gVisor is a runtime flag. Compose and the supervisor image run as root and share the host kernel unless `runsc` is set. The chart default is one shared computer as uid 1001, still without a runtime class.
- Low: item 1. Durable history here is a required Intelligence service with its own license.
- Low: item 6. User-scoped memory, with `list`, `recall`, and `create` returning `undefined` when Intelligence is down, and skills as declarations. The runtime hook read here is `onBeforeHandler`.

**Caution:** The policy engine denies when the policy object is absent, and the store's written default allows every computer action. A dry-run miss still forwards.[^cpkob-policy][^cpkob-default] A busy thread refuses a second run rather than queuing it.[^cpkob-lock] The architecture page and the activity module disagree about reload.[^cpkob-activity][^cpkob-activity-doc] A search of `server/src` for `ROW LEVEL SECURITY` and `CREATE POLICY` returned no matches. Intelligence is required to boot, and its stored threads were not inspected.[^cpkob-config] The chart's shared computer is not a boundary between Bots.[^cpkob-chart] Nothing was run.

[^cpkob-license]: [MIT License heading](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/LICENSE#L1)

[^cpkob-readme-license]: [The template is MIT; Intelligence is separately licensed](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/README.md#L105-L115)

[^cpkob-pkg]: [Bun workspaces and the MIT package](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/package.json#L2-L14)

[^cpkob-server-pkg]: [Server pins AG-UI 1.0.2 and CopilotKit runtime 1.85.0](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/package.json#L15-L26)

[^cpkob-app-pkg]: [App pins AG-UI core 1.0.2 and CopilotKit React 1.85.0](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/package.json#L17-L20)

[^cpkob-stack]: [A React and Vite app, a Hono server, and Intelligence](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/architecture.md#L1-L16)

[^cpkob-runtime]: [One Intelligence mode; external Bots are AG-UI HttpAgents](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/copilot.ts#L147-L158)

[^cpkob-config]: [Boot throws when Intelligence URL, gateway, or key is missing](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/config.ts#L1166-L1198)

[^cpkob-cors]: [Runtime CORS is the deployment origin; onBeforeHandler marks the asked run](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/copilot.ts#L3236-L3264)

[^cpkob-group]: [A group gives each Bot its own thread and a shared transcript](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/group.ts#L1-L19)

[^cpkob-assertion]: [The token is stored as a hash; the assertion lasts ten minutes](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L1-L143)

[^cpkob-read]: [readRunAssertion returns null on a bad signature, a bad shape, or expiry](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L145-L174)

[^cpkob-authorise]: [authoriseAgentCall refuses when the assertion does not read](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L333-L366)

[^cpkob-approved]: [An approved action is read with expiry ignored](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/callback-token.ts#L399-L413)

[^cpkob-coord]: [Without a handoff claim, coordination fills the run from the request](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/coordination-wiring.ts#L248-L266)

[^cpkob-lock]: [One run per conversation; a busy thread refuses rather than queues](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/toolkit/src/copilotkit/thread-lock.ts#L25-L34)

[^cpkob-queue]: [A busy composer parks the draft; an idle send keeps typed order](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/components/channels/composer/queue.ts#L182-L290)

[^cpkob-work]: [Work claims use skip locked and the database clock; notify is not delivery](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/work/queue.ts#L1-L28)

[^cpkob-routines]: [A due routine becomes one work item; the queue owns the claim](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/routines/sweep.ts#L1-L22)

[^cpkob-grace]: [A stamp outside the grace window is advanced and not offered](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/routines/sweep.ts#L166-L190)

[^cpkob-stall]: [Intelligence mode answers JSON; AG-UI events ride a gateway WebSocket](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/stall-guard.ts#L1-L42)

[^cpkob-stall-sse]: [RUN_ERROR is written on an SSE stall; a protobuf stream is closed without it](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/stall-guard.ts#L220-L282)

[^cpkob-stall-event]: [The stalled event type is RUN_ERROR](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/stall-guard.ts#L378-L381)

[^cpkob-events]: [Channel activity is a NOTIFY hint and is not replayed](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/channels/events.ts#L1-L18)

[^cpkob-join]: [A join that hits its deadline is not a trustworthy replay](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/lib/copilot/join-thread.ts#L1-L22)

[^cpkob-provider]: [The browser uses the session cookie and does not receive the Intelligence key](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/lib/copilot/provider.tsx#L24-L65)

[^cpkob-triggers]: [The composer triggers are @ and /](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/components/channels/composer/draft.ts#L15-L16)

[^cpkob-terminal]: [The terminal tab is the Bot's shell; taking control takes the computer](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/components/computer/computer-terminal.tsx#L7-L13)

[^cpkob-desktop]: [The desktop binary is a Tauri 2 shell](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/desktop/src-tauri/Cargo.toml#L1-L28)

[^cpkob-activity]: [Activity is read from tool results, including after reload](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/app/src/lib/computers/activity.ts#L14-L37)

[^cpkob-activity-doc]: [The architecture page says the activity list is gone on reload](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/architecture.md#L159-L161)

[^cpkob-gateway]: [Resolve the element from the server snapshot, then ask policy](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/gateway.ts#L1-L21)

[^cpkob-attempt]: [A refusal is written immediately; an attempt row waits until the approval gate passes](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/gateway.ts#L800-L811)

[^cpkob-policy]: [An absent policy denies; a broken deny denies; a broken allow does not permit](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/policy.ts#L303-L418)

[^cpkob-default]: [The written default allows every action and is not an absent policy](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/computer/policy-store.ts#L41-L56)

[^cpkob-default-wire]: [The store starts from configuration or that written default](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/index.ts#L673-L676)

[^cpkob-classify]: [An unadvertised name is a write; a recorded read is consulted first](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/catalogue.ts#L655-L674)

[^cpkob-mcp]: [The MCP call speaks the protocol after grant and policy](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/mcp.ts#L509-L516)

[^cpkob-selection]: [Narrowing is not a grant; the default floor is twelve](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/selection.ts#L1-L118)

[^cpkob-selection-apply]: [Under the floor, or when the chooser fails or names nothing, every granted tool stays offered](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/plugins/selection.ts#L262-L320)

[^cpkob-search]: [Past fifty tools, searchable app tools can wait behind search_tools](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/tool-search.ts#L16-L58)

[^cpkob-search-plan]: [Tools that stay in front, and a searchable set of eight or fewer, skip the search](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/agents/tool-search.ts#L116-L149)

[^cpkob-passwords]: [A sign-in secret reaches the browser and not the transcript](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/passwords/types.ts#L1-L7)

[^cpkob-memory]: [User scope only; a failed call leaves the local tables in use](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/memory/intelligence.ts#L25-L83)

[^cpkob-memory-read]: [list, recall, and create return undefined when Intelligence is unavailable or the call fails](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/src/memory/intelligence.ts#L178-L227)

[^cpkob-drop-vector]: [The document tables, embedding column, and vector extension are dropped](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/server/drizzle/0010_drop_the_document_index.sql#L1-L26)

[^cpkob-web]: [Public-web research is Parallel, Exa, or Firecrawl, through the plugin store](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/web-research.md#L1-L34)

[^cpkob-computers]: [A supervisor gives each person a computer; an isolated Bot gets its own](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docs/architecture.md#L75-L89)

[^cpkob-workspace]: [The computer process runs as root; paths stay inside the workspace](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/agent-computer/src/workspace.ts#L1-L14)

[^cpkob-gvisor]: [gVisor is opt-in; an empty COMPUTER_RUNTIME shares the host kernel](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/docker-compose.yml#L435-L437)

[^cpkob-chart]: [The chart default is one shared computer running as uid 1001](https://github.com/CopilotKit/OpenBot/blob/9270cd835301d95122e614ed7e498aacd68da2a9/charts/openbot/values.yaml#L368-L442)
