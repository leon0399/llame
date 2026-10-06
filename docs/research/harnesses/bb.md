---
type: Reference
title: "bb"
description: "Local-first agent IDE with server-owned threads and host-daemon provider execution"
resource: "https://github.com/get-bb/bb/tree/fd31b75fb9c7f40e68747089c911b098763aa851"
tags:
  - agent-harness
  - host-daemon
  - provider-bridges
  - plugins
  - mcp
status: stable
generated:
  by: "omp/openai-codex-gpt-5.6-luna"
  at: "2026-10-06"
observed:
  date: "2026-10-06"
  revision: "fd31b75fb9c7f40e68747089c911b098763aa851"
sources:
  - id: bb-system-overview-l3-l24
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/system-overview.md#L3-L24"
    title: "server, host daemon, thread, environment, and host roles"
  - id: bb-thread-ownership-l120-l230
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/threads/thread-ownership.ts#L120-L230"
    title: "thread ownership changes and parent notifications"
  - id: bb-provider-bridge-protocol-l14-l49
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/provider-bridge-protocol.md#L14-L49"
    title: "content-addressed provider bridge artifacts"
  - id: bb-provider-plugin-api-l152-l166
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/provider-plugin-api.md#L152-L166"
    title: "one provider process per bridge artifact"
  - id: bb-runtime-resume-collision-l1868-l1878
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1868-L1878"
    title: "resume collision rejection"
  - id: bb-runtime-process-l364-l381
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime-provider-process.ts#L364-L381"
    title: "provider process spawn and workspace cwd"
  - id: bb-runtime-idle-l858-l896
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L858-L896"
    title: "restorable idle provider session eligibility"
  - id: bb-idle-reaper-l65-l188
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/host-daemon/src/app.ts#L65-L188"
    title: "five-minute idle-session reaper and thirty-minute threshold"
  - id: bb-runtime-start-resume-l1502-l1655
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1502-L1655"
    title: "thread start and provider session construction"
  - id: bb-runtime-resume-l1831-l1966
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1831-L1966"
    title: "provider session resume"
  - id: bb-runtime-identity-l47-l91
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime-thread-identity.ts#L47-L91"
    title: "bb-thread to provider-thread identity mapping"
  - id: bb-runtime-turns-l1971-l2201
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1971-L2201"
    title: "turn start, steering, and provider request routing"
  - id: bb-daemon-events-l143-l305
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/ws/daemon-protocol.ts#L143-L305"
    title: "server-to-daemon WebSocket message handling"
  - id: bb-events-persistence-l317-l357
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/internal/events.ts#L317-L357"
    title: "daemon event normalization and durable notifications"
  - id: bb-host-reconnect-l65-l121
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/internal/session-owner-side-effects.ts#L65-L121"
    title: "daemon reconnect reconciliation and interruption"
  - id: bb-mcp-bridge-l471-l526
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/bridge.ts#L471-L526"
    title: "loopback dynamic-tool bridge and per-session MCP config"
  - id: bb-mcp-server-l109-l125
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/tool-proxy-mcp.ts#L109-L125"
    title: "ACP MCP server configuration"
  - id: bb-mcp-server-l247-l303
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/tool-proxy-mcp.ts#L247-L303"
    title: "MCP initialize, list, and call handling"
  - id: bb-plugin-host-manager-l242-l328
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/host-daemon/src/plugin-host-manager.ts#L242-L328"
    title: "host plugin RPC admission and deadlines"
  - id: bb-plugin-host-worker-l501-l590
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/host-daemon/src/plugin-host-worker.ts#L501-L590"
    title: "host plugin worker validation, environment, and lifecycle"
  - id: bb-provider-bridge-launch-l6-l42
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/system/provider-bridge-launch.ts#L6-L42"
    title: "server provider registration to host bridge launch"
  - id: bb-permission-ceiling-l22-l58
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/hosts/permission-ceiling.ts#L22-L58"
    title: "machine permission ceiling"
  - id: bb-thread-permission-l193-l244
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/threads/thread-commands.ts#L193-L244"
    title: "permission mode to runtime policy mapping"
  - id: bb-runtime-approvals-l288-l374
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime-provider-requests.ts#L288-L374"
    title: "runtime approval routing and auto-deny"
  - id: bb-acp-permissions-l1401-l1605
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/bridge.ts#L1401-L1605"
    title: "ACP permission requests and accept-edits file boundary"
  - id: bb-readme-telemetry-l85-l99
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/README.md#L85-L99"
    title: "production telemetry scope and opt-out"
  - id: bb-readme-remote-l158-l181
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/README.md#L158-L181"
    title: "remote development binding and unauthenticated API warning"
  - id: bb-worktree-hooks-l88-l177
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/worktrees.md#L88-L177"
    title: "workspace setup, teardown, and process cleanup"
  - id: bb-landing-site-l54-l68
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/web/src/landing/site.ts#L54-L68"
    title: "landing-page metadata claims"
  - id: bb-license-l1-l3
    resource: "https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/LICENSE#L1-L3"
    title: "MIT license"
  - id: bb-website-live-2026-10-06
    resource: "https://getbb.app/"
    title: "live website claims observed 2026-10-06; unversioned marketing surface"
---

# bb

- **Stack:** TypeScript/Node monorepo; SQLite server state; long-lived host daemons; MIT
- **Classification:** Actual agent execution host, not only a tool or provider SDK

bb is a local-first agentic IDE whose control plane is a server and whose execution plane is one or more enrolled host daemons. A thread is the unit of work, an environment binds a workspace to a host, and the host daemon provisions that workspace and runs provider processes. The repository's own system overview calls the server the state hub and the daemon the component that runs provider processes[^bb-system-overview-l3-l24]. The inspected checkout is `fd31b75fb9c7f40e68747089c911b098763aa851` (`desktop-nightly-47-gfd31b75fb`); source inspection only, with no upstream build or runtime execution performed.

**Study**

1. **Execution ownership is split, but bb owns the loop around the provider.** The server resolves a registered provider into a plugin id, content-addressed bridge digest, opaque bridge options, environment passthrough, and declared capabilities[^bb-provider-bridge-launch-l6-l42]. The daemon materializes that bridge and the runtime starts the provider command with a sanitized inherited environment, the configured bridge environment, and the workspace as `cwd`[^bb-runtime-process-l364-l381]. Thread start constructs a provider session, stores its `providerThreadId`, then optionally sends the first turn; later resume reconstructs the session from that provider id[^bb-runtime-start-resume-l1502-l1655][^bb-runtime-resume-l1831-l1966]. This is a genuine execution host: the model/provider process is not the authority for workspace placement, lifecycle, event translation, or cancellation.

2. **Sessions are provider-backed identities multiplexed inside a provider process.** The runtime keeps separate bb-thread → provider-thread mappings and rejects a resume if the provider thread is already hosted by another bb thread[^bb-runtime-identity-l47-l91][^bb-runtime-resume-collision-l1868-l1878]. The provider bridge contract says one process per provider artifact and that the runtime never scopes processes per thread[^bb-provider-plugin-api-l152-l166], while the runtime sends thread-scoped start/resume/turn/steer commands through that process[^bb-runtime-turns-l1971-l2201]. A restorable idle provider session can be reaped after 30 minutes by the daemon's periodic reaper[^bb-runtime-idle-l858-l896][^bb-idle-reaper-l65-l188]; an active or non-restorable session is not eligible. This makes provider process lifetime a shared failure and secret boundary: a process exit can detach several threads, even though each thread has its own provider identity and event scope.
   The runtime marks a provider session eligible only when it is idle, restorable, and free of in-flight work[^bb-runtime-idle-l858-l896]; the host reaper invokes this pass every five minutes with a 30-minute threshold[^bb-idle-reaper-l65-l188].

3. **The server owns the durable event/control boundary.** The daemon WebSocket accepts typed event batches, RPC responses, heartbeats, plugin signals, and terminal messages; command responses are matched to the authenticated daemon session rather than trusted from any socket[^bb-daemon-events-l143-l305]. The server normalizes daemon envelopes into stored event rows and emits client notifications after insertion[^bb-events-persistence-l317-l357]. On reconnect or daemon replacement it reconciles the daemon-reported active threads, interrupts work that cannot continue, and settles pending interactions/provisioning rather than pretending a provider turn is resumable[^bb-host-reconnect-l65-l121]. The durable source of truth is therefore server-side; host runtime maps and provider processes are reconstructible execution state, not the canonical transcript.

4. **MCP support is an adapter mechanism, not the whole extension model.** For ACP providers, bb turns `dynamicTools[]` into a session MCP server configuration. The bridge listens only on loopback, chooses an ephemeral port, creates a random token, and passes the thread id, token, and serialized tool definitions to a child MCP process[^bb-mcp-bridge-l471-l526]. That server implements `initialize`, `tools/list`, and `tools/call`; calls are sent over the local socket back to the bridge and then into the runtime's tool callback[^bb-mcp-server-l109-l125][^bb-mcp-server-l247-l303]. This proves per-session MCP transport for provider-injected bb tools, not a general remote-MCP catalog, tenant credential store, or provider-independent authorization layer. Provider-native MCP servers may still be managed by the provider CLI, so their isolation and approval semantics are provider-specific.

5. **Plugins are the provider and host-extension boundary.** A plugin can register a provider whose bridge artifact is downloaded by the daemon, verified/cached by digest, and run through a bootstrap that owns process framing and plugin-scoped data/temp directories[^bb-provider-bridge-protocol-l14-l49]. Host RPC calls are admitted with per-plugin call-count and input-byte caps, deadlines, cancellation, and worker idle retirement[^bb-plugin-host-manager-l242-l328]. The worker validates method input/output schemas, supplies sanitized environment contributions, exposes scoped paths/watchers, and aborts calls and watches during disposal[^bb-plugin-host-worker-l501-l590]. The child process reduces accidental coupling and provides lifecycle containment, but it is not a kernel sandbox: the host entry is still trusted code with host filesystem and process capabilities granted by its API.

6. **Permission policy is layered between server, runtime, and provider.** The server clamps a requested mode against a persisted machine ceiling and provider-supported modes[^bb-permission-ceiling-l22-l58], then maps `full`, `auto`, and `accept-edits` to runtime scope and reviewer policy[^bb-thread-permission-l193-l244]. When the bridge says the runtime owns approval policy, a request can be auto-denied according to those execution options; otherwise it is forwarded to the configured interactive-request handler[^bb-runtime-approvals-l288-l374]. ACP additionally auto-allows permission requests in `full`, prompts for other modes, and denies `accept-edits` writes outside the configured workspace roots[^bb-acp-permissions-l1401-l1605]. This is a real approval path, but it is provider-adapter-dependent: the bridge handshake reports whether the runtime or provider enforces approvals, so a provider cannot be assumed to share ACP's filesystem policy.

7. **Deployment is local by default, with explicit multi-machine and remote-access edges.** The packaged flow starts a server and local host daemon, stores state under `~/.bb`, and exposes the web UI on localhost; enrolled hosts then connect to the server over the daemon protocol. Source development binds to loopback by default, while the documented remote modes bind all IPv4 interfaces and warn that the API is unauthenticated and permits command execution and file reads[^bb-readme-remote-l158-l181]. Managed worktrees execute repository-controlled setup/teardown Bash with closed stdin, 15-minute limits, and process-group cleanup that includes providers, background jobs, and MCP servers[^bb-worktree-hooks-l88-l177]. This is operational deployment isolation, not a sandbox or tenant boundary.

**Website claims (marketing, not independently verified):** The live `getbb.app` page describes bb as self-customizing software-factory infrastructure, says its CLI can be driven by scripts and other bots, lists many provider names, and advertises local-first MIT-licensed deployment. The repository landing metadata makes the corresponding "IDE that builds itself", "fully open source", and "local-first" claims[^bb-landing-site-l54-l68]. These statements are product positioning; the implementation study above is the evidence for execution ownership. The repository license itself is MIT[^bb-license-l1-l3], while the live page is unversioned and should not be treated as a release contract[^bb-website-live-2026-10-06].

**llame opportunities (comparative, no adoption implied)**

- **Host/executor control plane — High confidence for [#758](https://github.com/leon0399/llame/issues/758) and [#756](https://github.com/leon0399/llame/issues/756).** bb's server/daemon split is a concrete placement model for a future remote Workspace executor: the server owns thread/event state, while the host owns provider processes, cwd, environment, and workspace lifecycle. llame's current [SPEC §9.5](../../../SPEC.md#9-chats-and-durable-runs) explicitly says execution is installation-local and ships no remote executor API or cross-node authority transfer, so bb is comparative prior art rather than a capability llame currently has. Its host process and worktree hooks also reinforce the [bash-execution](../../../openspec/specs/bash-execution/spec.md) warning that host authority is not tenant isolation; a future managed Sandbox must be a separate boundary.
- **Attempt/session identity — Moderate confidence for [#309](https://github.com/leon0399/llame/issues/309) and [#1047](https://github.com/leon0399/llame/issues/1047).** bb separates durable bb-thread identity, provider-thread identity, provider process identity, and server event history, then resumes only when the provider reports a restorable session. An unexpected provider exit emits a failed turn rather than silently replaying an unknown tool/model step. That shape is useful for llame's Run checkpoints, but llame's current [SPEC §9.4](../../../SPEC.md#9-chats-and-durable-runs) and [tool-calling](../../../openspec/specs/tool-calling/spec.md) contract already fail native/MCP work with `outcome_unknown`; adopting bb must not be described as semantic mid-loop recovery.
- **Approval boundary — High confidence for [#778](https://github.com/leon0399/llame/issues/778).** bb demonstrates the end-to-end route from provider request, through runtime/server pending interaction, to an operator decision, with a machine permission ceiling. llame's current [SPEC §7.5](../../../SPEC.md#7-authorization-and-roles) says interactive approvals do not ship, so this is a design comparison for a future proposal, not evidence that llame can pause a Run for approval today.
- **Child-thread orchestration — Moderate confidence for [#765](https://github.com/leon0399/llame/issues/765).** bb's thread model supports standard and manager threads, child ownership, and provider delegation through the same event/timeline plane[^bb-system-overview-l3-l24][^bb-thread-ownership-l120-l230]. If llame adds subagents, preserve owner-scoped Run/Chat authority and durable parent-child provenance instead of treating a provider's internal delegation id as a tenant or resume authority. The current [SPEC](../../../SPEC.md#9-chats-and-durable-runs) does not make child Runs a shipped public object.
- **Tool transport comparison — Moderate confidence for [#833](https://github.com/leon0399/llame/issues/833).** bb's loopback, token-bound ACP MCP bridge is a useful contrast with llame's operator-configured remote MCP: bb uses a short-lived per-session transport to inject host-owned tools into a provider, while llame's [MCP contract](../../../openspec/specs/mcp-tools/spec.md) treats configured endpoints as explicit outbound boundaries and requires exact allowlisting plus permission groups. Do not replace llame's source/permission gates with a provider-local MCP name or an ephemeral token.

**Caution:** bb's shared provider process and host OS execution are strong operational conveniences, not per-thread or per-tenant sandboxing. The machine permission ceiling defaults to `full` when no host row is found[^bb-permission-ceiling-l22-l58], so that ceiling is not by itself a fail-closed tenant boundary. Repository-controlled setup/teardown scripts can generate secrets and release external resources; direct remote modes expose an unauthenticated command/file API; and provider-native MCP approval behavior can differ from runtime-owned ACP approval. Production runs also send anonymous usage telemetry (counts, install kind, OS/Node metadata, and public-plugin names, with an opt-out) according to the README[^bb-readme-telemetry-l85-l99].

[^bb-system-overview-l3-l24]: [server, host daemon, thread, environment, and host roles](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/system-overview.md#L3-L24)

[^bb-thread-ownership-l120-l230]: [thread ownership changes and parent notifications](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/threads/thread-ownership.ts#L120-L230)

[^bb-provider-bridge-protocol-l14-l49]: [content-addressed provider bridge artifacts](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/provider-bridge-protocol.md#L14-L49)

[^bb-runtime-process-l364-l381]: [provider process spawn and workspace cwd](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime-provider-process.ts#L364-L381)

[^bb-runtime-idle-l858-l896]: [restorable idle provider session eligibility](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L858-L896)

[^bb-idle-reaper-l65-l188]: [five-minute idle-session reaper and thirty-minute threshold](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/host-daemon/src/app.ts#L65-L188)

[^bb-runtime-start-resume-l1502-l1655]: [thread start and provider session construction](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1502-L1655)

[^bb-runtime-resume-l1831-l1966]: [provider session resume](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1831-L1966)

[^bb-runtime-identity-l47-l91]: [bb-thread to provider-thread identity mapping](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime-thread-identity.ts#L47-L91)

[^bb-runtime-turns-l1971-l2201]: [turn start, steering, and provider request routing](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1971-L2201)

[^bb-daemon-events-l143-l305]: [server-to-daemon WebSocket message handling](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/ws/daemon-protocol.ts#L143-L305)

[^bb-events-persistence-l317-l357]: [daemon event normalization and durable notifications](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/internal/events.ts#L317-L357)

[^bb-host-reconnect-l65-l121]: [daemon reconnect reconciliation and interruption](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/internal/session-owner-side-effects.ts#L65-L121)

[^bb-mcp-bridge-l471-l526]: [loopback dynamic-tool bridge and per-session MCP config](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/bridge.ts#L471-L526)

[^bb-mcp-server-l109-l125]: [ACP MCP server configuration](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/tool-proxy-mcp.ts#L109-L125)

[^bb-mcp-server-l247-l303]: [MCP initialize, list, and call handling](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/tool-proxy-mcp.ts#L247-L303)

[^bb-plugin-host-manager-l242-l328]: [host plugin RPC admission and deadlines](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/host-daemon/src/plugin-host-manager.ts#L242-L328)

[^bb-plugin-host-worker-l501-l590]: [host plugin worker validation, environment, and lifecycle](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/host-daemon/src/plugin-host-worker.ts#L501-L590)

[^bb-provider-bridge-launch-l6-l42]: [server provider registration to host bridge launch](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/system/provider-bridge-launch.ts#L6-L42)

[^bb-permission-ceiling-l22-l58]: [machine permission ceiling](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/hosts/permission-ceiling.ts#L22-L58)

[^bb-thread-permission-l193-l244]: [permission mode to runtime policy mapping](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/server/src/services/threads/thread-commands.ts#L193-L244)

[^bb-runtime-approvals-l288-l374]: [runtime approval routing and auto-deny](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime-provider-requests.ts#L288-L374)

[^bb-acp-permissions-l1401-l1605]: [ACP permission requests and accept-edits file boundary](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/provider-bridge-acp/src/bridge/bridge.ts#L1401-L1605)

[^bb-readme-telemetry-l85-l99]: [production telemetry scope and opt-out](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/README.md#L85-L99)

[^bb-readme-remote-l158-l181]: [remote development binding and unauthenticated API warning](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/README.md#L158-L181)

[^bb-worktree-hooks-l88-l177]: [workspace setup, teardown, and process cleanup](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/worktrees.md#L88-L177)

[^bb-landing-site-l54-l68]: [landing-page metadata claims](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/apps/web/src/landing/site.ts#L54-L68)

[^bb-license-l1-l3]: [MIT license](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/LICENSE#L1-L3)

[^bb-website-live-2026-10-06]: [live website claims observed 2026-10-06; unversioned marketing surface](https://getbb.app/)

[^bb-provider-plugin-api-l152-l166]: [one provider process per bridge artifact](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/docs/provider-plugin-api.md#L152-L166)

[^bb-runtime-resume-collision-l1868-l1878]: [resume collision rejection](https://github.com/get-bb/bb/blob/fd31b75fb9c7f40e68747089c911b098763aa851/packages/agent-runtime/src/runtime.ts#L1868-L1878)
