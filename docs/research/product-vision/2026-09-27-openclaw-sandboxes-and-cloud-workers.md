---
type: Research
title: "OpenClaw sandboxes, Crabbox cloud workers, and paired-device placement compared with llame's Node, Workspace, and Sandbox direction"
description: "How OpenClaw decides where agent tools and whole sessions execute, how workspaces travel to and from remote machines, and which parts confirm, contradict, or extend VISION.md and the local-node research."
tags:
  [
    openclaw,
    sandbox,
    crabbox,
    cloud-workers,
    placement,
    workspace,
    nodes,
    fencing,
  ]
status: draft
generated: { by: omp/claude-opus-5-5, at: 2026-09-27T00:00:00Z }
observed:
  date: "2026-09-27"
  revision: "d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f"
sources:
  - id: oc-remote
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/remote.md#L8-L14"
    title: "One Gateway owns sessions, auth profiles, channels, and state"
  - id: oc-cloud-sessions
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-sessions.md#L10-L22"
    title: "Three session destinations; Gateway keeps transcript, workspace, credentials"
  - id: oc-crabbox-ci
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/ci/local-proof.md#L255-L263"
    title: "Crabbox as maintainer remote-proof infrastructure"
  - id: oc-sandbox-modes
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/modes-scope-and-backend.md#L13-L83"
    title: "Sandbox mode, scope, backend, role-required sandboxes, per-chat opt-out"
  - id: oc-sandbox-backends
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/modes-scope-and-backend.md#L114-L128"
    title: "Workspace-qualified runtime identity and backend comparison"
  - id: oc-workspace-access
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/workspace-access.md#L11-L32"
    title: "workspaceAccess none/ro/rw and managed project worktrees"
  - id: oc-sandbox-provisioning-error
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/agents/sandbox/context.ts#L461-L467"
    title: "Provisioning errors keep their owner boundary so model fallback never retries them"
  - id: oc-sandbox-prompt
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/agents/system-prompt.ts#L1037-L1075"
    title: "Model-facing Sandbox system-prompt section"
  - id: oc-agent-workspace-cwd
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/concepts/agent-workspace.md#L16-L18"
    title: "Agent workspace is the default cwd, not a sandbox"
  - id: oc-agent-workspace-files
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/concepts/agent-workspace.md#L76-L106"
    title: "SOUL.md, USER.md, MEMORY.md live in the agent workspace"
  - id: oc-dispatching
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/dispatching-a-session.md#L11-L19"
    title: "Cloud dispatch eligibility gates and New workspace default"
  - id: oc-dispatching-runtimes
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/dispatching-a-session.md#L31-L44"
    title: "Cloud child sessions, worker-turn versus remote-exec, no Gateway fallback"
  - id: oc-dispatch-source-check
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/gateway/server-methods/sessions-dispatch.ts#L102-L131"
    title: "Dispatch accepts only a session-owned worktree or repository workspace"
  - id: oc-placement-schema
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/state/openclaw-state-schema.sql#L2129-L2224"
    title: "worker_session_placements state machine, generation, owner epoch, turn claim"
  - id: oc-move-service
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/gateway/worker-environments/placement-move-service.ts#L119-L178"
    title: "Move reconciles or abandons the source, returns to local, then dispatches"
  - id: oc-lifecycle-dispatch
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L13-L27"
    title: "sessions.dispatch steps; restart recovery without replay; non-continuous sync"
  - id: oc-lifecycle-result
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L37-L53"
    title: "Result fencing, staged refs, three-way keep-local apply, follow-up custody"
  - id: oc-lifecycle-move
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L57-L76"
    title: "Move session, Device offline wait, destructive Continue on Gateway"
  - id: oc-lifecycle-move-rpc
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L114-L138"
    title: "Uncertain teardown, exact-source sessions.move, durable placement states"
  - id: oc-lifecycle-survives
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L146-L162"
    title: "What survives a dead machine"
  - id: oc-crabbox-lease-id
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/extensions/crabbox/src/crabbox-worker-provider.ts#L199-L286"
    title: "Lease ID derived from the durable provision operation"
  - id: oc-crabbox-backend
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/crabbox-backend.md#L19-L25"
    title: "Crabbox sandbox backend: fixed lease per scope, crabbox exec per call"
  - id: oc-what-gets-sandboxed
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/what-gets-sandboxed.md#L9-L27"
    title: "Which tool calls run in the sandbox"
  - id: oc-crabbox-tool
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/extensions/crabbox/src/crabbox-tool.ts#L69-L89"
    title: "Model-facing crabbox tool: attached environment, main workspace stays"
  - id: oc-desktop-attach
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/desktop.md#L11-L53"
    title: "Attach a temporary environment to a conversation"
  - id: oc-security-model
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/security-model.md#L11-L20"
    title: "Cloud worker security model"
  - id: oc-inference-runtime
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/gateway/worker-environments/inference-runtime.ts#L426-L447"
    title: "Gateway-side approval of worker inference requests"
  - id: oc-warm-images
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/warm-images.md#L31-L45"
    title: "Warm image reuse key, pinned allocation choice, scrubbing"
  - id: oc-warm-images-pin
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/warm-images.md#L87-L96"
    title: "Pinned checkpoints and rollback"
  - id: oc-session-hosting
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/session-hosting.md#L13-L63"
    title: "Device opt-in session hosting; New Session never browses the device filesystem"
  - id: oc-session-hosting-offline
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/session-hosting.md#L161-L184"
    title: "Offline device placement, 14-day dormancy"
  - id: oc-session-hosting-container
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/session-hosting.md#L191-L238"
    title: "Node-enforced container isolation with no bare-process fallback"
  - id: oc-node-exec
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/node-exec.md#L20-L41"
    title: "exec host=node routing and node-local approvals"
  - id: oc-file-transfer
    resource: "https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/file-transfers.md#L23-L50"
    title: "Explicit remoteRoot mapping; placement does not grant file access"
---

# OpenClaw sandboxes, cloud workers, and remote placement

The "workboxes" are **Crabbox** leases: disposable cloud machines that OpenClaw
rents through its own `openclaw/crabbox` CLI and enrolls as temporary nodes.
Crabbox began as maintainer infrastructure for remote CI proof and is now also a
product feature[^oc-crabbox-ci][^oc-cloud-sessions]. It is one of four
execution mechanisms in OpenClaw, and llame's vocabulary already separates
them more cleanly than OpenClaw's does:

1. a **tool sandbox** that decides where `exec` and file tools run for a session;
2. **session placement** that moves a whole session's agent turns to a paired
   device or a Crabbox cloud worker;
3. **node peripherals** that the model can address for commands and native
   `exec` on paired hardware; and
4. a model-callable **`crabbox` tool** that attaches a side machine without
   moving the session.

Verdict, moderate-to-high confidence: OpenClaw is strong prior art for the
execution-placement half of the
[local-node research](2026-08-21-local-nodes-workspaces-and-distributed-execution.md)
(fenced single-owner placement, reconcile-first moves, fail-closed isolation,
credential brokering, wait-by-default outage handling). It is not prior art for
the other half (standalone Nodes, Personal Realm synchronization, registered
host Workspaces, model-requested entry), because OpenClaw is a single central
Gateway with peripherals. The largest design difference is direction of data
flow: OpenClaw copies the workspace to the executor and reconciles it back,
while the llame research brings the executor to a Workspace that stays on the
user's machine.

Evidence is source and documentation reading of OpenClaw at `d9fc2556` on
2026-09-27, with load-bearing claims checked in source. Nothing was run. Three
read-only scout passes covered cloud workers, sandboxing, and nodes; their
citations were spot-checked before use.

## How OpenClaw is built

### F1. One Gateway owns everything durable

"OpenClaw runs one Gateway (the master) on a host and connects every client to
it. The Gateway owns sessions, auth profiles, channels, and state; everything
else is a client"[^oc-remote]. Nodes (phones, Macs, headless hosts) connect
outbound over WebSocket. The same holds for remote placements: "the Gateway
stays the owner" of the conversation, "model inference stays proxied through the
Gateway", and completed work returns to the Gateway as accepted checkpoints or
managed-worktree changes[^oc-cloud-sessions]. No reviewed document describes a
node that runs agents while disconnected from its Gateway, and nothing
synchronizes state between Gateways.

### F2. The tool sandbox is operator policy with three knobs

`sandbox.mode` is `off | non-main | all` (default `off`), `sandbox.scope` is
`agent | session | shared` (default `agent`, one container per agent), and
`sandbox.backend` is `docker | podman | ssh | openshell | crabbox`[^oc-sandbox-modes].
A named operator role can require a sandbox; that requirement is immutable for
the session, and "unavailable backends fail closed, and elevated execution or
Gateway/node host overrides cannot bypass it". An administrator can opt one idle
chat out with `sessions.patch { sandboxMode: "off" }` guarded by expected session
id, lifecycle revision, and current value, and "the Gateway checks again before
committing and never changes containment underneath a running
turn"[^oc-sandbox-modes]. Runtime identity includes the resolved workspace path,
so co-hosted workspaces never share a container[^oc-sandbox-backends].

Only tool execution runs inside (`exec`, `process`, `ls`, `read`, `write`,
`edit`, `apply_patch`, plus an optional sandboxed browser); the Gateway process
and agent loop stay on the host[^oc-what-gets-sandboxed]. A provisioning failure
is wrapped so that "model
fallback never retries it" as another execution route[^oc-sandbox-provisioning-error].

### F3. The agent workspace mixes persona, memory, and cwd

The agent workspace is "the default cwd, not a hard sandbox"[^oc-agent-workspace-cwd].
It also holds `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, daily
`memory/YYYY-MM-DD.md`, `MEMORY.md`, and `skills/`[^oc-agent-workspace-files].
`sandbox.workspaceAccess` decides what a sandbox sees of it: `none` (default,
isolated scratch under `~/.openclaw/sandboxes`), `ro` at `/agent`, or `rw` at
`/workspace`[^oc-workspace-access]. With `rw`, sandboxed shell commands can
rewrite the persona and memory files. Project code enters a sandbox only as a
session-owned managed worktree; "arbitrary external `cwd` values and direct
project bindings remain restricted"[^oc-workspace-access].

### F4. Session placement moves the whole turn loop

A session runs on the Gateway (default), a paired device (`operator.write`), or a
Crabbox cloud worker (`operator.admin`)[^oc-cloud-sessions]. The operator
chooses in the Control UI or over `sessions.dispatch`; the model does not.
Dispatch accepts only "a session-owned worktree or repository workspace" and
rejects anything else[^oc-dispatch-source-check]. Without a selected source, a
new session gets an empty private workspace and "existing local files are not
copied"[^oc-dispatching].

Two execution modes exist[^oc-dispatching-runtimes]:

- `worker-turn`: a restricted `openclaw worker` runs the OpenClaw agent turn on
  the box and calls the Gateway for inference by `{provider, model}` reference.
  The Gateway re-approves each request's model[^oc-inference-runtime].
- `remote-exec`: the Codex app-server and its credentials stay on the Gateway;
  the box runs only an allowlisted Codex exec-server that performs filesystem and
  process operations.

Either mode "fails closed if the selected provider or placement sandbox is
unavailable; it never falls back to running the operation on the Gateway host"[^oc-dispatching-runtimes].

### F5. Placement is a fenced state machine in SQLite

`worker_session_placements` stores `state` in
`local → requested → provisioning → syncing → starting → active → draining → reconciling → reclaimed | failed`,
plus `transition_generation`, `active_owner_epoch`, and a turn claim
(`turn_claim_generation`, `turn_claim_owner_epoch`). CHECK constraints tie each
state to which fields must be null: no owner epoch before `active`, a
`recovery_error` whenever `failed`[^oc-placement-schema]. Each dispatch mints a
fresh worker credential stored hashed, and "credential rotation and owner-epoch
fencing guarantee at most one live owner per session"[^oc-security-model].
Worker transcripts commit by compare-and-swap against the session leaf, and a
stale base fail-stops the run rather than duplicating messages[^oc-security-model].

### F6. The workspace goes to the executor and comes back per turn

Dispatch validates the source, provisions, enrolls the node, installs a pinned
worker bundle, applies the workspace, and only then sends the first turn.
Synchronization "is not continuous": the Gateway sends a fresh inventory at
dispatch, not before every turn[^oc-lifecycle-dispatch]. After each completed
turn the box captures base and current manifests plus changed blobs; the Gateway
stages them as a Git ref under `refs/openclaw/worker-results/` before
applying[^oc-lifecycle-result]. Repository-only sessions accumulate immutable
checkpoints in a Gateway bare repository. Gateway-source worktrees merge against
the last accepted manifest: cloud-only changes apply, local-only changes stay,
and paths changed on both sides keep the local version while the transcript
reports the conflict and the staged ref. A follow-up message sent during
reconciliation is held "into durable custody" and starts after the claim
releases[^oc-lifecycle-result]. Worker Git history, index state, and partial
staging are not preserved.

What survives a dead box: the transcript up to the last committed message and
every accepted workspace result. Changes made since the last reconciliation
exist only on the box and can be lost[^oc-lifecycle-survives].

### F7. Moves are reconcile-first with exact-source preconditions

**Move session…** closes admission, interrupts the active turn, reconciles the
source workspace, destroys the old environment, and then activates the
destination; "an interrupted turn is never replayed"[^oc-lifecycle-move]. The
RPC form requires the caller to supply the placement's current `generation`,
`environmentId`, and `ownerEpoch`; "a stale source is rejected rather than
moving a newer placement"[^oc-lifecycle-move-rpc]. In source, the move first
returns the placement to `local`, then dispatches the target with an idempotency
key derived from the move operation[^oc-move-service].

Provisioning is idempotent by construction: the Crabbox lease ID is derived from
the durable provision operation, so a Gateway restart replays the same
allocation instead of renting a second machine[^oc-crabbox-lease-id]. Teardown
is treated the same way: "an ended or unusable provider lease is not proof that
its machine was deleted", and a failed stop stays retryable[^oc-lifecycle-move-rpc].

### F8. An offline device waits; abandoning it is explicit and destructive

A paired-device placement stays `active` while its runner is offline. The UI
shows **Device offline** and waits by default "without giving up the placement,
workspace, or authority"[^oc-session-hosting-offline]. **Continue on Gateway…**
is the only way out: after a data-loss confirmation it fences the device owner,
revokes its credentials and result authority, and resumes from the last synced
workspace without replay, while keeping the old device's cleanup scope until
reconnection confirms the worker stopped[^oc-lifecycle-move]. After 14 days of
recorded disconnect the old environment is treated as gone[^oc-session-hosting-offline].
There is no automatic temporary fallback that later returns to the device.

### F9. Paired devices host sessions, not their own folders

A device opts into hosting with `nodeHost.workerRuns.enabled`, and the docs warn
to enable it "only on a machine you trust as shared Gateway infrastructure";
consent is per device, not per person. New Session "does not bind `execNode` or
browse the device filesystem": the Gateway creates a session-owned workspace and
ships it to the device[^oc-session-hosting]. Container isolation on the device is
configured locally, "the Gateway cannot silently disable it or fall back to an
unisolated worker", and a failed engine or image fails the launch rather than
retrying as a bare process; the container receives only the read-only worker
bundle and the read-write session workspace[^oc-session-hosting-container].

Direct access to a device's own directories exists only through separate
features. `exec host=node` runs shell commands natively on a node, gated by
node-local allowlists stored on that node; an explicit per-call `host=node` from
`host=auto` is allowed "only when no sandbox runtime is active"[^oc-node-exec].
The File Transfer plugin maps an agent to an exact node and absolute
`remoteRoot` with per-path allowlists, and "placement does not grant
access"[^oc-file-transfer].

### F10. Crabbox also appears as a sandbox backend and as a model tool

As a sandbox backend, Crabbox reserves one fixed lease per sandbox scope and runs
every command and file operation through `crabbox exec --id <lease-id>`, while
the Gateway and agent loop stay local[^oc-crabbox-backend]. As a model tool, `crabbox` is offered only
to unsandboxed sessions with configured profiles and creates "a temporary Crabbox
attached to this conversation while keeping the agent and its main workspace in
place", with an idempotency key hashed from session id and tool-call
id[^oc-crabbox-tool]. Attaching it "does not automatically synchronize the
primary workspace; the agent must copy the required files"[^oc-desktop-attach].

Warm images make repeat provisioning cheap. Reuse is keyed by backend, setup
command, `setupEnv` variable names (not values), desktop flag, operating system,
machine class, and project identity. Each allocation records whether it starts
cold or from a specific checkpoint before the provider call, and capture scrubs
worker identities, device tokens, and session state[^oc-warm-images]. Pinned
checkpoints are exempt from refresh and eviction and support
rollback[^oc-warm-images-pin]. Images come from operator setup commands; the
agent cannot propose environment changes.

### F11. The model is told it is sandboxed, not always accurately

The system prompt gains a `## Sandbox` section listing workspace access, mount
points, browser availability, and whether elevated exec exists. Its first line
is the constant "Sandbox runtime; tools execute in Docker" for every backend,
and it prints the host mount source path to the model[^oc-sandbox-prompt].
[INFERENCE, moderate confidence] SSH, OpenShell, and Crabbox sessions therefore
receive a false runtime description. Placement changes and workspace conflicts
reach the transcript as notices[^oc-lifecycle-result]; whether each move or
outage is narrated to the model as a context change was not verified.

## Vocabulary map

| llame term (local-node research §4)                         | Nearest OpenClaw mechanism                                          | Match                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Hub service                                                 | Gateway                                                             | Partial. The Gateway is the permanent sole authority; the llame hub is optional and only an initial fencing service. |
| Node (autonomous installation)                              | none                                                                | OpenClaw nodes are peripherals with no durable agent state.                                                          |
| Executor                                                    | paired device with `workerRuns`, Crabbox worker, sandbox backend    | Close.                                                                                                               |
| Execution placement / session                               | `worker_session_placements` row                                     | Close, including generation and owner epoch.                                                                         |
| Authority epoch, fenced handoff                             | `active_owner_epoch`, exact-source `sessions.move`                  | Close. OpenClaw fences on its own database; llame's hub CAS is the same shape.                                       |
| Execution segment, `outcome_unknown`                        | interrupted turn never replayed; unsynced device work "may be lost" | Close in behavior; OpenClaw has no named unknown-outcome record.                                                     |
| Workspace (user-registered directory)                       | managed worktree, repository workspace                              | Different. OpenClaw's workspaces are Gateway-owned sources, never a device's own folder.                             |
| Workspace view (worktree)                                   | managed worktree, remote checkout                                   | Close.                                                                                                               |
| Controlled publication back to durable state (VISION)       | accepted checkpoint, staged result ref, keep-local merge            | Close; OpenClaw is the most concrete prior art reviewed.                                                             |
| Sandbox definition revision                                 | Docker image + `setupCommand`; warm-image checkpoint                | Weaker: operator-owned, no agent-proposed revisions.                                                                 |
| Native-placement grant                                      | `sandbox.mode: off`, elevated exec, `exec host=node`                | Weaker: configuration and per-call routing, no provenance-bound grant.                                               |
| Profile Space, Knowledge Space, Home                        | agent workspace (one directory)                                     | Conflated in OpenClaw.                                                                                               |
| `on_workspace_unavailable: ask \| wait \| fallback \| exit` | wait by default, or destructive Continue on Gateway                 | Subset: no automatic fallback with return.                                                                           |
| Inference broker                                            | worker-turn inference RPC                                           | Close. No per-Workspace egress mode was observed.                                                                    |

## Comparison with llame's direction

### Confirmed by OpenClaw

- **C1. One authority per session, fenced by epoch.** F5 and F7 implement the
  §5.6 placement invariant almost literally: exact-source preconditions, a
  single commit point, stale owners unable to append. The shape of llame's
  simple-first hub handoff has a working precedent.
- **C2. No silent downgrade.** Sandbox provisioning, device container
  isolation, remote-exec, and required sandboxes all fail closed (F2, F4, F9).
  This matches VISION's "Sandbox failure never silently downgrades to native
  execution" and gives three concrete enforcement sites.
- **C3. Credentials stay home.** Inference by reference, per-turn GitHub token,
  hashed worker credentials, and an AWS instance-role check before setup (F4,
  F5) match VISION's "An executor receives a proxied operation or narrow
  delegation, not the reusable upstream secret."
- **C4. Continuity is not replay.** Restart recovery retires the interrupted
  turn and gives the resumed one fresh authority (F6, F7). This is the
  execution-segment rule in §5.6.
- **C5. Wait is the safe default for outages.** F8 is §5.14 option 1, and its
  destructive abandonment is the §5.15 `outcome_unknown` case made explicit to
  the user.
- **C6. Sandboxes receive working copies, not Home.** VISION says sandboxes get
  "only selected project or artifact working copies and scratch space, with
  controlled publication back to durable state". F6 is a full implementation of
  that sentence for remote machines.

### Where OpenClaw diverges

- **D1. Data moves to compute; llame moves compute to data.** OpenClaw ships a
  Gateway-owned workspace to whichever machine runs the session, including a
  user's own paired device (F6, F9). The local-node research §5.4 says llame
  "never clones, discovers, or imports project directories onto a user's
  machine merely because an upstream Run requested a Workspace", and §5.5 routes
  execution to the node that registered the Workspace. Both models are
  coherent, and llame will need both: OpenClaw's for disposable cloud
  Sandboxes, its own for registered host Workspaces. VISION and the research
  note do not yet state that split, and it changes #756 and #758 (see Q1).
- **D2. The model never asks for placement.** OpenClaw's only model-initiated
  machine is the side `crabbox` tool (F10). llame's `EnterWorkspace`, requested
  by the model and authorized by the harness, has no OpenClaw analogue to copy.
  Its incremental placement rule ("begins wherever it can") is new design work.
- **D3. No standalone operation or synchronization.** F1 rules OpenClaw out as a
  reference for personal Nodes, linking, Personal Realm mirroring, and the
  federation research. High confidence.
- **D4. Native execution is routed by configuration and tool arguments.**
  `exec host=node` lets a per-call argument reach native execution on a paired
  node when no sandbox is active (F9). llame's rule is that "the model never
  chooses native execution" and only trusted harness provenance creates a
  native grant. Do not copy this path.
- **D5. Persona and memory share a directory with the cwd.** F3 means a
  `workspaceAccess: rw` sandbox can rewrite `SOUL.md`, `USER.md`, and memory.
  llame keeps Profile, Knowledge, and Workspace separate and keeps Home out of
  sandboxes; keep it that way.
- **D6. Environments are operator-built.** OpenClaw has images, setup
  commands, and warm-image checkpoints with pin and rollback (F10), but no
  agent-proposed, validated, Git-backed environment revision (§5.9). llame's
  design goes further; OpenClaw only supplies the reuse-key and pin mechanics.
- **D7. Tenancy is trust-based.** Session-host consent is per device, cloud
  dispatch requires `operator.admin`, and sandbox scope defaults to one
  container per agent (F2, F9). llame's hub is multi-tenant with RLS, so scope
  must be at least per owner and never per agent.
- **D8. Disclosure is looser.** F11 shows a fixed "Docker" description and a
  host path in the prompt. llame's narration rule requires the placement,
  isolation class, and Workspace to be stated accurately, and host paths stay
  private.

### Worth borrowing when #756 and #758 start

- **B1. The placement row.** Adopt the F5 shape: explicit states with CHECK
  constraints tying state to epoch and environment presence, a transition
  generation, an owner epoch, and a separate turn claim. It is a better starting
  schema than designing llame's execution placement from scratch.
- **B2. Operation-derived resource IDs.** Derive the Sandbox instance or lease
  ID from the durable provisioning operation, and treat a timeout, 404, or ended
  lease as an unknown cleanup outcome (F7).
- **B3. Stage, then accept.** Stage every executor result as an immutable ref
  before applying it, keep local on conflict, report the ref to model and user,
  and hold follow-up input in custody during reconciliation (F6). This also fits
  the recoverable write path in #212.
- **B4. Abandonment as a named, exact-source action.** Allow it only when the
  source is unavailable and exactly identified; retain cleanup ownership until
  shutdown is confirmed (F7, F8).
- **B5. Placement versus attached scratch environment.** Keep "enter a
  Workspace" separate from "give me a throwaway machine for this conversation",
  with an idempotency key from Chat and tool call (F10). A scratch Sandbox needs
  no Workspace entry decision.
- **B6. Executor-enforced isolation.** The node, not the controller, owns
  container settings and refuses to run unisolated (F9). This is §5.9's "host
  Node owns container lifecycle" with an existing implementation.
- **B7. Containment changes only between turns.** A sandbox opt-out uses
  expected-revision preconditions and is refused under a running turn (F2).

### Cautions

- **X1. Scale of surface.** The reviewed docs cover warm-image reserves,
  Windows and macOS desktops, portals, Codex exec-servers, and forced destroy.
  None of it is needed for #756's first cut (one fixed local environment and one
  mounted Workspace). Copying breadth before a working local Sandbox trades
  away the file-native Knowledge loop the roadmap currently prioritizes.
- **X2. The copy model has a loss window.** Anything written between
  reconciliations dies with the box (F6). If llame adopts D1's copy model for
  cloud Sandboxes, the model and user must be told what is unsynced.
- **X3. Per-agent sandbox scope is a shared-state leak** under multi-tenancy
  (D7).

## Open questions for Leo

- **Q1. Is the D1 split the intended rule?** Proposed wording: a Workspace
  registered on a Node is executed where it lives; a disposable Sandbox may
  receive a working copy and publish back through staged, accepted results. If
  yes, it belongs in the local-node research note and later in VISION's
  "Portable data, isolated execution" section.
- **Q2. Should llame offer a side Sandbox tool (B5) before `EnterWorkspace`?**
  It gives the model scratch execution without any Workspace or native-authority
  decision, and the hosted service could offer it before local Nodes exist. It
  also collides with VISION's deferral of "a production sandbox fabric", so it
  needs an explicit decision rather than drift.
- **Q3. Does §5.14 option 2 (temporary fallback with automatic return) earn
  its complexity?** OpenClaw ships only wait and destructive abandonment and
  documents no demand for more. Low confidence either way.

[^oc-remote]: [One Gateway owns sessions, auth profiles, channels, and state](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/remote.md#L8-L14)

[^oc-cloud-sessions]: [Three session destinations; Gateway keeps transcript, workspace, credentials](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-sessions.md#L10-L22)

[^oc-crabbox-ci]: [Crabbox as maintainer remote-proof infrastructure](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/ci/local-proof.md#L255-L263)

[^oc-sandbox-modes]: [Sandbox mode, scope, backend, role-required sandboxes, per-chat opt-out](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/modes-scope-and-backend.md#L13-L83)

[^oc-sandbox-backends]: [Workspace-qualified runtime identity and backend comparison](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/modes-scope-and-backend.md#L114-L128)

[^oc-workspace-access]: [workspaceAccess none/ro/rw and managed project worktrees](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/workspace-access.md#L11-L32)

[^oc-sandbox-provisioning-error]: [Provisioning errors keep their owner boundary](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/agents/sandbox/context.ts#L461-L467)

[^oc-sandbox-prompt]: [Model-facing Sandbox system-prompt section](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/agents/system-prompt.ts#L1037-L1075)

[^oc-agent-workspace-cwd]: [Agent workspace is the default cwd, not a sandbox](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/concepts/agent-workspace.md#L16-L18)

[^oc-agent-workspace-files]: [SOUL.md, USER.md, MEMORY.md live in the agent workspace](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/concepts/agent-workspace.md#L76-L106)

[^oc-dispatching]: [Cloud dispatch eligibility gates and New workspace default](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/dispatching-a-session.md#L11-L19)

[^oc-dispatching-runtimes]: [Cloud child sessions, worker-turn versus remote-exec, no Gateway fallback](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/dispatching-a-session.md#L31-L44)

[^oc-dispatch-source-check]: [Dispatch accepts only a session-owned worktree or repository workspace](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/gateway/server-methods/sessions-dispatch.ts#L102-L131)

[^oc-placement-schema]: [worker_session_placements state machine, generation, owner epoch, turn claim](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/state/openclaw-state-schema.sql#L2129-L2224)

[^oc-move-service]: [Move reconciles or abandons the source, returns to local, then dispatches](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/gateway/worker-environments/placement-move-service.ts#L119-L178)

[^oc-lifecycle-dispatch]: [sessions.dispatch steps; restart recovery without replay; non-continuous sync](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L13-L27)

[^oc-lifecycle-result]: [Result fencing, staged refs, three-way keep-local apply, follow-up custody](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L37-L53)

[^oc-lifecycle-move]: [Move session, Device offline wait, destructive Continue on Gateway](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L57-L76)

[^oc-lifecycle-move-rpc]: [Uncertain teardown, exact-source sessions.move, durable placement states](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L114-L138)

[^oc-lifecycle-survives]: [What survives a dead machine](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/session-lifecycle.md#L146-L162)

[^oc-crabbox-lease-id]: [Lease ID derived from the durable provision operation](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/extensions/crabbox/src/crabbox-worker-provider.ts#L199-L286)

[^oc-crabbox-backend]: [Crabbox sandbox backend](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/crabbox-backend.md#L19-L25)

[^oc-what-gets-sandboxed]: [Which tool calls run in the sandbox](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/sandboxing/what-gets-sandboxed.md#L9-L27)

[^oc-crabbox-tool]: [Model-facing crabbox tool](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/extensions/crabbox/src/crabbox-tool.ts#L69-L89)

[^oc-desktop-attach]: [Attach a temporary environment to a conversation](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/desktop.md#L11-L53)

[^oc-security-model]: [Cloud worker security model](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/security-model.md#L11-L20)

[^oc-inference-runtime]: [Gateway-side approval of worker inference requests](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/gateway/worker-environments/inference-runtime.ts#L426-L447)

[^oc-warm-images]: [Warm image reuse key, pinned allocation choice, scrubbing](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/warm-images.md#L31-L45)

[^oc-warm-images-pin]: [Pinned checkpoints and rollback](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/gateway/cloud-workers/warm-images.md#L87-L96)

[^oc-session-hosting]: [Device opt-in session hosting](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/session-hosting.md#L13-L63)

[^oc-session-hosting-offline]: [Offline device placement, 14-day dormancy](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/session-hosting.md#L161-L184)

[^oc-session-hosting-container]: [Node-enforced container isolation with no bare-process fallback](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/session-hosting.md#L191-L238)

[^oc-node-exec]: [exec host=node routing and node-local approvals](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/node-exec.md#L20-L41)

[^oc-file-transfer]: [Explicit remoteRoot mapping](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/docs/nodes/file-transfers.md#L23-L50)
