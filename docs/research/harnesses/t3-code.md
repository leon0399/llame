---
type: Reference
title: "T3 Code"
description: "MIT Effect environment that owns peer coding agents, a v2 SQLite event log, and WebSocket Effect RPC clients."
tags: [harness, peer-executor, desktop, effect, websocket, permissions]
status: draft
resource: "https://github.com/pingdotgg/t3code/tree/82b10d546c1041d8eff40425f076d61f608d518f"
generated:
  by: "cursor/grok-4.7"
  at: "2026-11-01"
observed:
  date: "2026-11-01"
  revision: "82b10d546c1041d8eff40425f076d61f608d518f"
sources:
  - id: overview-l1-l19
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/overview.md#L1-L19"
    title: "Environment owns execution; clients speak authenticated RPC"
  - id: overview-l45-l63
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/overview.md#L45-L63"
    title: "Event log, transactional outbox, publish after commit"
  - id: remote-l9-l29
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/remote.md#L9-L29"
    title: "Environment id is independent of the route"
  - id: remote-l71-l105
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/remote.md#L71-L105"
    title: "Beta peer links forward MCP calls to another environment"
  - id: server-env-l120-l143
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/environment/ServerEnvironment.ts#L120-L143"
    title: "Atomic environment id publish"
  - id: builtin-drivers-l31-l42
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/provider/builtInDrivers.ts#L31-L42"
    title: "Built-in provider drivers"
  - id: adding-provider-l9-l20
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/adding-a-provider.md#L9-L20"
    title: "ACP registry versus a native ProviderAdapterV2"
  - id: providers-l13-l50
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/providers.md#L13-L50"
    title: "OpenCode, Pi, and Antigravity process ownership"
  - id: protocol-l13-l15
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/contracts/src/environment.ts#L13-L15"
    title: "Orchestration protocol version 2"
  - id: ws-l3342-l3405
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/ws.ts#L3342-L3405"
    title: "GET /ws Effect RPC with JSON serialization"
  - id: ws-replay-l956-l1008
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/ws.ts#L956-L1008"
    title: "Thread resume snapshots on cursor, count, raw bytes, or encoded bytes"
  - id: connection-runtime-l78-l120
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/connection-runtime.md#L78-L120"
    title: "Shell omissions, five-minute detail cache, desktop keep-alive"
  - id: env-auth-scopes-l9-l16
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/environment-auth.md#L9-L16"
    title: "Default pairing grant includes shell and full-access orchestration"
  - id: config-db-l144-l148
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/config.ts#L144-L148"
    title: "Live database path is userdata/statev2.sqlite"
  - id: ws-auth-l1241-l1285
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/auth/EnvironmentAuth.ts#L1241-L1285"
    title: "WebSocket upgrade prefers wsTicket, then authenticateRequest"
  - id: ws-cred-l642-l657
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/auth/EnvironmentAuth.ts#L642-L657"
    title: "HTTP credential order is cookie, bearer, then DPoP"
  - id: acp-search-l38-l153
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/web/src/components/settings/AcpRegistrySearchStep.tsx#L38-L153"
    title: "Registry search hides built-in acpRegistryAgentIds"
  - id: internal-paths-l22-l26
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/auth/serverInternalPaths.ts#L22-L26"
    title: "File reads refuse secrets, state sqlite files, and /dev/fd"
  - id: subscribe-l3747-l3776
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/contracts/src/orchestrationV2.ts#L3747-L3776"
    title: "subscribeThread cursor and snapshot resume comment"
  - id: threadstream-l18-l113
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/ThreadStream.ts#L18-L113"
    title: "Replay bounds then snapshot fallback"
  - id: eventsink-l635-l702
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/EventSink.ts#L635-L702"
    title: "Command commit writes events, projections, receipt, and outbox"
  - id: receipt-l13284-l13317
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/Orchestrator.ts#L13284-L13317"
    title: "Command id reused on another thread conflicts; same thread replays"
  - id: rollback-l314-l332
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/CommandPolicy.ts#L314-L332"
    title: "Rollback refused when the provider cannot roll its conversation back"
  - id: checkpoint-l26-l157
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/CheckpointService.ts#L26-L157"
    title: "Hidden Git refs under refs/t3/orchestration-v2/checkpoints"
  - id: workspace-l133-l173
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/workspace/WorkspacePaths.ts#L133-L173"
    title: "Workspace root is path.resolve, writes stay inside it"
  - id: env-auth-l127-l133
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/environment-auth.md#L127-L133"
    title: "filesystem:read can leave the project"
  - id: permissions-l1-l41
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/user/permission-modes.md#L1-L41"
    title: "Permission modes and provider fallbacks"
  - id: acp-run-l42-l52
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/user/providers-acp.md#L42-L52"
    title: "Registry agents run on the server host"
  - id: defaults-l1378-l1401
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/contracts/src/settings.ts#L1378-L1401"
    title: "Codex and Claude start enabled; the other named drivers start disabled"
  - id: usage-l75-l185
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-opencode/src/server/usageLimits.ts#L75-L185"
    title: "OpenCode Go usage probe"
  - id: readme-l1-l102
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/README.md#L1-L102"
    title: "README provider list and early-project warning"
  - id: v2-doc-l1-l124
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/orchestration-v2/README.md#L1-L124"
    title: "V2 design note still framed as a target, including a future outbox"
  - id: legacy-l1-l39
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/legacy-orchestration-migration.md#L1-L39"
    title: "statev2.sqlite import and protocol 2 handshake"
  - id: license-l1-l5
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/LICENSE#L1-L5"
    title: "MIT, copyright 2026 T3 Tools Inc."
  - id: codex-args-l12-l15
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/provider/codexLaunchArgs.ts#L12-L15"
    title: "Codex launch argv starts with app-server"
  - id: claude-protocol-l213-l214
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L213-L214"
    title: "Claude Agent SDK query protocol id"
  - id: cursor-sdk-l24
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-cursor/src/server/CursorAgentSdk.ts#L24"
    title: "Cursor Agent SDK local protocol id"
  - id: pi-rpc-l262-l264
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-pi/src/server/mcpInjection.ts#L262-L264"
    title: "Pi RPC launch args"
  - id: muse-serve-l130-l160
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-muse/src/server/sdk.ts#L130-L160"
    title: "Muse serve arguments and SDK spawn"
  - id: project-receipt-l278-l281
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/project/ProjectService.ts#L278-L281"
    title: "Project command id reused for another project or command type fails"
  - id: project-receipt-l446-l450
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/project/ProjectService.ts#L446-L450"
    title: "Thread-deletion command id must match thread and command type"
  - id: provider-registry-l160-l188
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/provider/ProviderRegistry.ts#L160-L188"
    title: "Driver-kind branches in provider snapshot retention"
  - id: grok-acp-l346
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-grok/src/server/adapter.ts#L346"
    title: "Grok adapter builds the shared ACP adapter"
  - id: fx-acp-l195
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-fx/src/server/adapter.ts#L195"
    title: "fx adapter builds the shared ACP adapter"
  - id: acp-registry-driver-l471-l473
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-acp-registry/src/server/driver.ts#L471-L473"
    title: "ACP Registry has no default instance"
  - id: acp-user-l13-l15
    resource: "https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/user/providers-acp.md#L13-L15"
    title: "ACP v2 preview with v1 negotiation"
---

# T3 Code

- **Stack:** TypeScript monorepo on Effect, Node 26.12.1, pnpm, Vite+.
  `apps/server` (`t3` CLI plus SQLite), `apps/web` (React, TanStack Router,
  Tailwind, Base UI), `apps/desktop` (Electron 44, bundles a server),
  `apps/mobile` (Expo), `packages/contracts` and `packages/client-runtime`.
  Site: [t3.codes](https://t3.codes). **License:** MIT, copyright 2026 T3 Tools
  Inc.[^license-l1-l5]

**Status:** Source and documentation inspection of
`82b10d546c1041d8eff40425f076d61f608d518f` (2026-11-01). Nothing was run. That
commit is 180 commits after tag `v0.1.6`
(`2359643cffa6ba9ee84d6f2694b935de54a8013e`); `apps/server/package.json` still
says `0.1.6`. GitHub's latest stable release that day was `v0.1.6`; a
`0.1.7` nightly also existed. The previous llame note inspected
`1de563c1491c7d82563e4553bf5bf689ce6adbb9` (2026-09-21). `git rev-list --count`
reports 4,621 commits between them.

**Study**

1. **The environment owns execution.** Web, desktop, and mobile clients control
   one environment over authenticated RPC. Provider processes, terminals, Git,
   and project files stay on that server. A remote client must not substitute
   its filesystem or credentials. The desktop app bundles a server; its
   renderer uses the same boundary.[^overview-l1-l19] The environment id is
   persisted independently of URL, Tailscale, SSH, or T3 Connect, and is
   published by a temp file plus `link` so a second process cannot replace
   it.[^remote-l9-l29][^server-env-l120-l143] Saved client routes are
   reachability hints. A beta peer link lets one environment's agents call
   another environment's `/mcp` when the tool takes an environment target.
   With `linkedEnvironmentsEnabled` off, new links and `PeerForwarding.call`
   are refused, while `readThread`, `waitForThread`, and `interruptThread`
   still run. Forwarded calls carry a mode ceiling. This is not a multi-box
   registry.[^remote-l71-l105]
2. **Orchestration v2 commits intent, then publishes.** The v2 orchestrator
   serializes commands and decides events without provider or filesystem I/O.
   `EventSink` commits events, projections, the command receipt, and outbox
   effects in one SQLite transaction, then subscribers see the
   events.[^overview-l45-l63][^eventsink-l635-l702] A command acknowledgement
   means the intent committed. The effect worker performs the provider turn,
   checkpoint, or other follow-up and feeds results back as later commands.
   The server opens `userdata/statev2.sqlite`.[^config-db-l144-l148] The first
   v2 launch copies v1 `state.sqlite` into that file and imports thread
   shells. User and assistant text is imported when a client reads or
   continues the thread. The importer does not translate provider sessions,
   tool calls, approvals, or checkpoints into v2 history.[^legacy-l1-l39] A previously rejected
   command id fails with `OrchestratorCommandPreviouslyRejectedError`. An
   accepted id reused on a different thread fails with
   `OrchestratorCommandIdConflictError`. The same thread returns the stored
   receipt with `replayed: true`. That replay compares thread id, not command
   type.[^receipt-l13284-l13317] A thread-deletion command id whose
   stored receipt names another thread or command type fails closed in
   `ProjectService`.[^project-receipt-l446-l450] A project command whose stored
   receipt names another project or command type fails the same
   way.[^project-receipt-l278-l281]
3. **Providers are instance-scoped adapters.** A driver kind is the
   integration. An instance owns one account's mutable session and catalog.
   Orchestration is meant to read capabilities rather than driver names.
   `ProviderRegistry` still branches on Pi, ACP Registry, Grok, Antigravity,
   Codex, and OpenCode when deciding whether an empty model list is
   authoritative.[^adding-provider-l9-l20][^provider-registry-l160-l188]
   Built-in drivers, in registry order:[^builtin-drivers-l31-l42]

   | Driver       | Kind          | How the server attaches                                                  | Starts   |
   | ------------ | ------------- | ------------------------------------------------------------------------ | -------- |
   | Codex        | `codex`       | Child `codex app-server`[^codex-args-l12-l15]                            | enabled  |
   | Claude       | `claudeAgent` | Agent SDK `query` (`claude-agent-sdk.query`)[^claude-protocol-l213-l214] | enabled  |
   | Cursor       | `cursor`      | Server-side `@cursor/sdk` (`cursor-agent-sdk.local`)[^cursor-sdk-l24]    | disabled |
   | Grok         | `grok`        | ACP flavor over the Grok CLI                                             | disabled |
   | fx           | `fx`          | ACP flavor over the fx CLI                                               | disabled |
   | OpenCode     | `opencode`    | HTTP to a T3-managed `opencode serve`                                    | disabled |
   | Antigravity  | `antigravity` | ACP; T3 installs and leases the binary                                   | disabled |
   | Pi           | `pi`          | Child `pi --mode rpc`[^pi-rpc-l262-l264]                                 | disabled |
   | Muse Code    | `muse`        | `@muse-code/sdk` spawn of `serve`[^muse-serve-l130-l160]                 | disabled |
   | ACP Registry | `acpRegistry` | Generic ACP; no default instance                                         | added    |

   Grok and fx both call `makeAcpAdapterV2`.[^grok-acp-l346][^fx-acp-l195]
   Codex and Claude are the enabled default instances. Cursor, Grok, fx,
   Muse, Pi, OpenCode, and Antigravity are in
   `DEFAULT_DISABLED_PROVIDER_DRIVERS`.[^defaults-l1378-l1401] OpenCode probes
   the install and runs 1.x (one chat server per thread) or 2.x (one server
   per instance, per-thread MCP names). Pi keeps the user's `pi` install,
   session files, and cwd by launching the CLI for a fork instead of switching
   an RPC session's directory.[^providers-l13-l50] ACP Registry prefers the
   ACP v2 preview and negotiates v1, and it has no default
   instance.[^acp-user-l13-l15][^acp-registry-driver-l471-l473] The web settings
   search hides ids listed as `acpRegistryAgentIds` on a built-in client (`codex-acp`,
   `claude-acp`, `cursor`, `grok-build`, `opencode`, `opencode-v2`, `pi-acp`,
   `antigravity-acp`). fx and Muse Code omit that list, so they stay in the
   results.[^acp-search-l38-l153] Codex, Claude, and Antigravity
   still live under `apps/server/src/provider`; the other drivers are
   `packages/provider-*`.

4. **The client wire is Effect RPC with JSON frames on a WebSocket.** `GET /ws` requires
   `orchestrationProtocol=2` and answers HTTP 426
   `orchestration_protocol_incompatible` otherwise. The socket is Effect
   `RpcServer` with `RpcSerialization.layerJson`. The upgrade prefers a
   short-lived `wsTicket` query parameter. A DPoP-bound ticket also requires
   the proof in the query. With no ticket, the upgrade uses the HTTP
   credential (cookie, then bearer, then DPoP).[^ws-auth-l1241-l1285][^ws-cred-l642-l657] Every RPC
   declares a scope, so a successful handshake does not authorize every
   method.[^protocol-l13-l15][^ws-l3342-l3405][^overview-l1-l19]
   Dispatch returns the last committed event sequence. Duplicate command ids
   return the receipt without re-running provider side effects. HTTP remains
   for assets, filesystem reads, and similar requests; it uses the same
   scoped session and does not replace a healthy socket to refresh a token.
5. **Thread streams resume from a sequence, then fall back to a snapshot.**
   `orchestration.subscribeThread` takes optional `afterSequence`. The socket
   handler sends a snapshot when the cursor is ahead of the store, when the
   stored gap exceeds 128 events or 1,048,576 raw bytes, when a retained
   create event still has a thread shell, or when the projected replay exceeds
   128 events or 1,048,576 encoded bytes.[^ws-replay-l956-l1008][^threadstream-l18-l113]
   The snapshot's `historyCursor` is opaque; the client resumes events with
   `afterSequence` equal to `snapshotSequence`.[^subscribe-l3747-l3776]
   Shell snapshots can omit idle children and older settled threads and page
   them later. Desktop mounts a keep-alive for running threads; web and mobile
   do not. A thread-detail cache keeps state and its replay cursor together
   for five idle minutes.[^connection-runtime-l78-l120]
6. **Tools run on the environment host.** Provider CLIs and SDKs execute
   with the thread's cwd on that machine: the project directory, or a Git
   worktree the server created for the thread. Registry agents do the same
   when the UI is `app.t3.codes` or a phone.[^acp-run-l42-l52] T3 injects a
   thread-scoped MCP server so the agent can call T3 tools; those tools run
   in the environment process. Terminals are server PTYs. Clients attach.
   Workspace roots are `path.resolve` of a `~`-expanded path. That keeps
   symlinks. Relative writes must stay inside the root. `filesystem:read`
   may read paths outside the project, including absolute paths. It refuses
   the secrets directory, a file directly in the state directory whose name
   contains `.sqlite`, and `/dev/fd`.[^internal-paths-l22-l26] Projects are not
   filesystem sandboxes.[^workspace-l133-l173][^env-auth-l127-l133] Checkpoints are
   hidden Git refs `refs/t3/orchestration-v2/checkpoints/<hash>/ordinal/<n>`.
   Rollback is refused before a restore when the adapter cannot roll its
   conversation back or cannot return a snapshot.[^checkpoint-l26-l157][^rollback-l314-l332]
7. **Permissions are a per-thread mode mapped onto the provider.** The
   composer modes are Supervised, Auto-accept edits, Auto, and Full access.
   The documented initial default for new threads is Full access. Auto uses
   the provider's reviewer on Codex, Claude, Cursor, Grok, and fx. OpenCode
   and Antigravity fall back to asking. Muse offers only Supervised and Full
   access. fx offers neither Auto-accept edits nor Full access. Grok offers
   no Auto-accept edits. A stored mode the provider does not offer runs as
   Supervised.[^permissions-l1-l41] `adding-a-provider.md` says T3 must not
   imitate a missing mode by answering approvals itself. ACP Registry agents
   still have their approvals answered from the thread mode. Claude can ask
   even in Full access when its own settings require it.
8. **UI is graphical clients plus a server CLI.** There is no TUI product.
   `t3` starts the server and opens the local web app. Desktop is Electron
   around that web UI. Mobile is Expo (iOS and Android). The in-app terminal
   uses `libghostty-vt` on web and Android; the server owns scrollback
   (`docs/internals/terminal-runtime.md`, `docs/internals/web-ui.md`).
   Client preferences stay on the device. Environment and project settings
   stay on the server. **All environments** is a bulk edit of connected
   servers, not a synced default (`docs/internals/overview.md`).
9. **Extension points are drivers, ACP, forges, secrets, and MCP.** A new
   agent starts as an ACP Registry entry or a local ACP command. A dedicated
   driver is for behavior ACP does not cover, implemented as
   `ProviderAdapterV2`.[^adding-provider-l9-l20] Source-control drivers ship
   for GitHub, GitLab, GitCafe, Forgejo, Bitbucket, and Azure DevOps
   (`apps/server/src/sourceControl/sourceControlDefinitions.ts`). The built-in
   secret provider is 1Password
   (`apps/server/src/secrets/secretProviderDefinitions.ts`). Outside agents
   sign in to `/mcp` (`docs/user/outside-agents.md`). No UI or arbitrary
   server plugin SDK showed up in `docs/` or the provider wiring.
10. **Maturity is pre-1.0 with a large shipped surface.** README says the
    project is very early and mostly not accepting contributions. The same
    tree ships desktop packages, store apps, `app.t3.codes`, T3 Connect, and
    daily nightlies. GitHub reported 36,907 stars on 2026-11-01; the
    repository was created 2026-02-08. Stars are not a quality measure.
    Confidence on the architecture above is high because it is in both the
    internals docs and the cited modules. Confidence on product claims that
    exist only in user docs (store listings, T3 Chat machine limits) is
    moderate: those pages were read and not exercised.

**README and docs versus code**

- README's install warning names Codex, Claude, Cursor, Grok Build, OpenCode,
  Antigravity, and fx.[^readme-l1-l102] Pi and Muse Code are built-in
  drivers, have user guides (`docs/user/providers-pi.md`,
  `docs/user/providers-muse.md`), and appear in `PROVIDER_DISPLAY_NAMES`.
  Uncertain whether the README omission is intentional marketing lag.
- `docs/orchestration-v2/README.md` still opens as a target architecture and
  lists a durable effect outbox as a follow-up. `docs/internals/overview.md`
  and `EventSink.commitCommand` implement that outbox, and v2 is the live
  orchestrator. The v1 `apps/server/src/orchestration/Layers/` tree from
  `1de563c` is gone. Treat overview plus `apps/server/src/orchestration-v2/`
  as current, and treat the v2 doc set's "target" framing as stale.[^v2-doc-l1-l124]
- The capability sketch in `docs/orchestration-v2/provider-capability-system.md`
  matches the groups on `OrchestrationV2ProviderCapabilities`. That sketch
  says capabilities should be versioned. The schema has no version field.
  `runtimePolicy.enforcement` decodes missing old events as
  `client-boundary`.
- Package version `0.1.6` at this commit is behind the `0.1.7` nightly tag
  series. Uncertain how nightly version stamps relate to `package.json`.

**Changes since the 2026-09-21 inspection (`1de563c`)**

- Orchestration v2 landed in `de34391427` (2026-10-02, #2829). The live path
  is `apps/server/src/orchestration-v2/`. Receipts, commit-before-publish, and
  instance-scoped providers remain. Side effects now go through the outbox
  inside the same transaction.
- The 2026-09-21 `apps/server/src/provider/Drivers/` tree had Codex, Claude,
  Cursor, Grok, OpenCode, and Antigravity. It had no Pi, Muse, or fx driver.
  fx's package commit is `6df241d23a` (2026-10-26, #18277). Provider packages
  were extracted around 2026-10-08 (`#17302` Pi, `#17331` Muse, `#17345`
  OpenCode, `#17349` Cursor, `#17354` shared ACP, `#17357` Grok, `#17405`
  ACP Registry).
- Cursor at `1de563c` had `apps/server/src/provider/acp/CursorAcpSupport.ts`.
  This tree has no `CursorAcp` module. Sessions use `@cursor/sdk`.
- OpenCode Go usage moved from `apps/server/src/provider/Layers/openCodeUsageLimits.ts`
  to `packages/provider-opencode/src/server/usageLimits.ts`. It still calls
  `GET https://opencode.ai/zen/go/v1/usage` with a bearer token, treats HTTP
  403 as unavailable. A five-second timeout covers credential lookup and the
  HTTP call. Key order is the SQLite `opencode` row, then SQLite
  `opencode-go`, then the `auth.json` `opencode-go` key or `OPENCODE_API_KEY`.
  Later keys are tried after HTTP 401 or 403. `OPENCODE_AUTH_CONTENT` replaces
  the auth file and skips the SQLite read.[^usage-l75-l185]
- Peer links (`docs/internals/remote.md`) are new relative to that note's
  "one environment, no cross-node routing" caution. They forward selected
  MCP calls. They do not place the provider process on the phone.

**Relevance to llame**

llame's API owns Chat and Run identity, streams run events over SSE with
cursor replay, and keeps the web client thin. The planned CLI treats
`realpath` of `PWD` as the workspace root and executes tools on the client
over a WebSocket JSON-RPC channel. TUI is the primary interface. T3 is a
useful control-plane comparison and a poor tool-placement model.

- **High:** environment id separate from the transport URL; commit events,
  projections, and the receipt before notifying clients; return the receipt
  on retry; reject a command id reused on another aggregate; capability flags
  per adapter; a protocol version on the socket with a hard reject on skew;
  bound replay and replace an oversized gap with one snapshot. Those fit
  llame's SSE cursor without an event-sourcing rewrite or a SQLite swap.
- **Moderate:** server-owned PTY with a disposable client renderer, for a
  terminal surface beside the TUI; hidden Git refs for workspace checkpoints,
  only together with an explicit provider-history rollback capability.
  OpenCode's Go usage endpoint remains a documented JSON read behind the
  user's key, with "valid key, no subscription" distinct from failure.
- **Low:** T3's graphical clients. There is no TUI to copy. The `t3` CLI
  launches the server and a browser.
- **Different placement:** T3 tools and the workspace cwd run on the
  environment host. llame's planned CLI executes tools on the client and
  canonicalizes the workspace with `realpath`. T3's `path.resolve` keeps
  symlinks. Copying T3's server-side cwd into the CLI would fight that
  design. Peer links are a beta MCP forward between two trusted
  environments, not a Node that dials out to execute llame tools.
- **Avoid:** Full access as the default for new work; `filesystem:read`
  reaching outside the workspace; treating a T3 environment or provider
  thread as llame Chat or Run authority; assuming provider-instance
  separation is tenant isolation. One SQLite file per environment has no RLS.

**Caution:** Pairing's default grant includes `terminal:operate` (a shell as
the server user) and `orchestration:operate` (can start a full-access agent).[^env-auth-scopes-l9-l16]
Remote control still joins a client to one environment. Peer links add a
second hop for agents. New links and forwarded calls wait for
`linkedEnvironmentsEnabled`. A task already running can still be read,
waited on, or interrupted while the flag is off.[^remote-l71-l105] Provider
rollback does not undo external side effects.

[^overview-l1-l19]: [Environment owns execution; clients speak authenticated RPC](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/overview.md#L1-L19)

[^overview-l45-l63]: [Event log, transactional outbox, publish after commit](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/overview.md#L45-L63)

[^remote-l9-l29]: [Environment id is independent of the route](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/remote.md#L9-L29)

[^remote-l71-l105]: [Beta peer links forward MCP calls to another environment](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/remote.md#L71-L105)

[^server-env-l120-l143]: [Atomic environment id publish](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/environment/ServerEnvironment.ts#L120-L143)

[^builtin-drivers-l31-l42]: [Built-in provider drivers](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/provider/builtInDrivers.ts#L31-L42)

[^adding-provider-l9-l20]: [ACP registry versus a native ProviderAdapterV2](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/adding-a-provider.md#L9-L20)

[^providers-l13-l50]: [OpenCode, Pi, and Antigravity process ownership](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/providers.md#L13-L50)

[^protocol-l13-l15]: [Orchestration protocol version 2](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/contracts/src/environment.ts#L13-L15)

[^ws-l3342-l3405]: [GET /ws Effect RPC with JSON serialization](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/ws.ts#L3342-L3405)

[^ws-replay-l956-l1008]: [Thread resume snapshots on cursor, count, raw bytes, or encoded bytes](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/ws.ts#L956-L1008)

[^connection-runtime-l78-l120]: [Shell omissions, five-minute detail cache, desktop keep-alive](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/connection-runtime.md#L78-L120)

[^env-auth-scopes-l9-l16]: [Default pairing grant includes shell and full-access orchestration](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/environment-auth.md#L9-L16)

[^subscribe-l3747-l3776]: [subscribeThread cursor and snapshot resume comment](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/contracts/src/orchestrationV2.ts#L3747-L3776)

[^threadstream-l18-l113]: [Replay bounds then snapshot fallback](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/ThreadStream.ts#L18-L113)

[^eventsink-l635-l702]: [Command commit writes events, projections, receipt, and outbox](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/EventSink.ts#L635-L702)

[^receipt-l13284-l13317]: [Command id reused on another thread conflicts; same thread replays](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/Orchestrator.ts#L13284-L13317)

[^rollback-l314-l332]: [Rollback refused when the provider cannot roll its conversation back](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/CommandPolicy.ts#L314-L332)

[^checkpoint-l26-l157]: [Hidden Git refs under refs/t3/orchestration-v2/checkpoints](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/CheckpointService.ts#L26-L157)

[^workspace-l133-l173]: [Workspace root is path.resolve, writes stay inside it](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/workspace/WorkspacePaths.ts#L133-L173)

[^env-auth-l127-l133]: [filesystem:read can leave the project](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/environment-auth.md#L127-L133)

[^permissions-l1-l41]: [Permission modes and provider fallbacks](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/user/permission-modes.md#L1-L41)

[^acp-run-l42-l52]: [Registry agents run on the server host](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/user/providers-acp.md#L42-L52)

[^defaults-l1378-l1401]: [Codex and Claude start enabled; the other named drivers start disabled](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/contracts/src/settings.ts#L1378-L1401)

[^usage-l75-l185]: [OpenCode Go usage probe](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-opencode/src/server/usageLimits.ts#L75-L185)

[^readme-l1-l102]: [README provider list and early-project warning](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/README.md#L1-L102)

[^v2-doc-l1-l124]: [V2 design note still framed as a target, including a future outbox](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/orchestration-v2/README.md#L1-L124)

[^legacy-l1-l39]: [statev2.sqlite import and protocol 2 handshake](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/internals/legacy-orchestration-migration.md#L1-L39)

[^license-l1-l5]: [MIT, copyright 2026 T3 Tools Inc.](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/LICENSE#L1-L5)

[^codex-args-l12-l15]: [Codex launch argv starts with app-server](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/provider/codexLaunchArgs.ts#L12-L15)

[^claude-protocol-l213-l214]: [Claude Agent SDK query protocol id](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L213-L214)

[^cursor-sdk-l24]: [Cursor Agent SDK local protocol id](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-cursor/src/server/CursorAgentSdk.ts#L24)

[^pi-rpc-l262-l264]: [Pi RPC launch args](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-pi/src/server/mcpInjection.ts#L262-L264)

[^muse-serve-l130-l160]: [Muse serve arguments and SDK spawn](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-muse/src/server/sdk.ts#L130-L160)

[^project-receipt-l278-l281]: [Project command id reused for another project or command type fails](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/project/ProjectService.ts#L278-L281)

[^project-receipt-l446-l450]: [Thread-deletion command id must match thread and command type](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/project/ProjectService.ts#L446-L450)

[^provider-registry-l160-l188]: [Driver-kind branches in provider snapshot retention](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/provider/ProviderRegistry.ts#L160-L188)

[^grok-acp-l346]: [Grok adapter builds the shared ACP adapter](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-grok/src/server/adapter.ts#L346)

[^fx-acp-l195]: [fx adapter builds the shared ACP adapter](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-fx/src/server/adapter.ts#L195)

[^acp-registry-driver-l471-l473]: [ACP Registry has no default instance](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/packages/provider-acp-registry/src/server/driver.ts#L471-L473)

[^acp-user-l13-l15]: [ACP v2 preview with v1 negotiation](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/docs/user/providers-acp.md#L13-L15)

[^config-db-l144-l148]: [Live database path is userdata/statev2.sqlite](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/config.ts#L144-L148)

[^ws-auth-l1241-l1285]: [WebSocket upgrade prefers wsTicket, then authenticateRequest](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/auth/EnvironmentAuth.ts#L1241-L1285)

[^ws-cred-l642-l657]: [HTTP credential order is cookie, bearer, then DPoP](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/auth/EnvironmentAuth.ts#L642-L657)

[^acp-search-l38-l153]: [Registry search hides built-in acpRegistryAgentIds](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/web/src/components/settings/AcpRegistrySearchStep.tsx#L38-L153)

[^internal-paths-l22-l26]: [File reads refuse secrets, state sqlite files, and /dev/fd](https://github.com/pingdotgg/t3code/blob/82b10d546c1041d8eff40425f076d61f608d518f/apps/server/src/auth/serverInternalPaths.ts#L22-L26)
