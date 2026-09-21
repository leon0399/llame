---
type: Reference
title: "AX"
description: "Desired-state task sandboxes, snapshot-backed workspaces, and fail-open control-plane gaps"
resource: "https://github.com/google/ax"
observed:
  date: "2026-09-21"
  revision: "d8ed0fe38bceb7842d3c47817d53d16ccdfcb601"
sources:
  - id: ax-go-mod-l1-l11
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/go.mod#L1-L11"
    title: "Go and Agent Substrate dependencies"
  - id: ax-license-l1-l13
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/LICENSE#L1-L13"
    title: "Apache 2.0 license"
  - id: ax-types-go-l30-l35
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/pkg/apis/v1alpha1/types.go#L30-L35"
    title: "declarative resource kinds"
  - id: ax-server-go-l111-l198
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/server/server.go#L111-L198"
    title: "task mutations persist desired state"
  - id: ax-redis-store-go-l133-l179
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L133-L179"
    title: "task saves publish reconcile events"
  - id: ax-redis-store-go-l346-l379
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L346-L379"
    title: "gateway saves do not publish task events"
  - id: ax-redis-store-go-l600-l636
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L600-L636"
    title: "workspace saves do not publish task events"
  - id: ax-task-runner-main-go-l15-l22
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax-task-runner/main.go#L15-L22"
    title: "task runner environment contract"
  - id: ax-task-runner-main-go-l48-l80
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax-task-runner/main.go#L48-L80"
    title: "task runner specification loading"
  - id: ax-substrate-client-go-l207-l275
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/substrate/client.go#L207-L275"
    title: "fixed runner, gVisor, volume, and snapshot template"
  - id: ax-runner-go-l106-l200
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/runner/runner.go#L106-L200"
    title: "workspace setup and child process launch"
  - id: ax-runner-go-l203-l235
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/runner/runner.go#L203-L235"
    title: "process-group supervision and local exit callback"
  - id: ax-server-go-l201-l237
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/server/server.go#L201-L237"
    title: "task watch terminal phases"
  - id: ax-workspace-setup-go-l31-l64
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/setup.go#L31-L64"
    title: "workspace paths and initialization marker"
  - id: ax-workspace-setup-go-l76-l127
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/setup.go#L76-L127"
    title: "marker-gated repository setup"
  - id: ax-reconciler-go-l234-l305
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/controller/reconciler.go#L234-L305"
    title: "sticky workspace-ready condition"
  - id: ax-redis-store-go-l727-l792
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L727-L792"
    title: "Redis consumer-group delivery"
  - id: ax-controller-worker-go-l64-l118
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/controller/worker.go#L64-L118"
    title: "unconditional event acknowledgement"
  - id: ax-server-go-l38-l88
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/server/server.go#L38-L88"
    title: "bare gRPC server and caller-supplied atespace"
  - id: ax-server-main-go-l32-l80
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax-server/main.go#L32-L80"
    title: "unencrypted HTTP/2 server"
  - id: ax-cli-main-go-l201-l208
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax/main.go#L201-L208"
    title: "insecure CLI transport"
  - id: ax-reconciler-go-l188-l205
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/controller/reconciler.go#L188-L205"
    title: "wildcard egress default and fail-open application"
  - id: ax-api-proto-l175-l182
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/pkg/apis/v1alpha1/ax.proto#L175-L182"
    title: "HostRule port declaration"
  - id: ax-substrate-client-go-l449-l482
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/substrate/client.go#L449-L482"
    title: "egress policy translation"
  - id: ax-readme-l45-l58
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/README.md#L45-L58"
    title: "claimed workspace and gateway capabilities"
  - id: ax-api-proto-l193-l229
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/pkg/apis/v1alpha1/ax.proto#L193-L229"
    title: "MCP and skills schema"
  - id: ax-workspace-setup-go-l261-l269
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/setup.go#L261-L269"
    title: "skills directory setup"
  - id: ax-workspace-planner-go-l26-l112
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/planner.go#L26-L112"
    title: "unwired model-backed workspace planner"
  - id: ax-model-client-go-l458-l501
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/model/client.go#L458-L501"
    title: "Google model client setup"
  - id: ax-model-client-go-l557-l620
    resource: "https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/model/client.go#L557-L620"
    title: "model failure fallback response"
---

# AX

- **Stack:** Go 1.27.1, Redis, gRPC, and Agent Substrate.[^ax-go-mod-l1-l11]
  **License:** Apache-2.0.[^ax-license-l1-l13]

Moderate-confidence reference for future Workspace and sandbox execution. AX is
a declarative control plane over isolated Agent Substrate actors; it does not
own an authenticated Chat/Run lifecycle and cannot replace llame's tenant or
provenance boundaries. This assessment inspected source and test code without
executing upstream programs.

**Study**

F76 — **Four declarative resources feed one Task reconciler.** AX defines
`Task`, `Workspace`, `Gateway`, and `Model` resources.[^ax-types-go-l30-l35]
Task API handlers validate and persist desired state rather than calling the
runtime inline,[^ax-server-go-l111-l198] and `SaveTask` atomically adds the
reconcile event beside the stored value.[^ax-redis-store-go-l133-l179] The
dependency graph stops there: saving a referenced Gateway or Workspace updates
its own Redis indexes but does not requeue dependent Tasks.[^ax-redis-store-go-l346-l379][^ax-redis-store-go-l600-l636]
The separation between API mutation and runtime work is useful for llame's
future executor adapters. The missing dependency invalidation means llame
should either bind immutable resource revisions into a Run or explicitly
reconcile dependants when referenced policy changes.

F77 — **A fixed PID 1 is the sandbox contract, but completion stays local.**
Every actor starts `/usr/local/bin/ax-task-runner`; task and workspace specs
arrive as `AX_TASK_YAML` and `AX_WORKSPACES_YAML`, and the runner exposes its
metadata/readiness service on port 80.[^ax-task-runner-main-go-l15-l22][^ax-task-runner-main-go-l48-l80][^ax-substrate-client-go-l207-l275]
It prepares workspaces, launches the declared command in a separate process
group, forwards shutdown, and keeps the sandbox alive after the command exits
so it remains inspectable.[^ax-runner-go-l106-l200][^ax-runner-go-l203-l235]
The exit callback has no path back to Task status, while the API watch contract
recognizes a `Completed` phase that the runner never writes.[^ax-server-go-l201-l237]
For llame, keep this stable supervisor boundary but require a durable,
correlated completion receipt from child exit through the executor adapter to
the owning Run.

F78 — **Snapshot-backed `/workspace` is a strong shape with a split-durability
trap.** The actor template selects gVisor, mounts `/workspace`, and snapshots
that data volume on pause and commit for restoration on resume.[^ax-substrate-client-go-l207-l275]
The runner's one-time initialization marker instead lives under `/ax`, outside
the durable volume.[^ax-workspace-setup-go-l31-l64] A restored workspace in a
fresh actor can therefore repeat marker-gated repository setup, including a
forced checkout, over persisted work.[^ax-workspace-setup-go-l76-l127] The
controller also treats a prior `WorkspaceReady` condition as sticky and skips a
post-resume readiness probe.[^ax-reconciler-go-l234-l305] Llame should preserve
runner metadata with the workspace or make setup idempotent against restored
state, then verify readiness after resume rather than trusting an old control-
plane condition.

F79 — **The queue contract says at-least-once; the worker makes failures
one-shot.** New Redis consumer groups start at the stream tail, workers read
only new `>` entries, and entries remain pending until acknowledged.[^ax-redis-store-go-l727-l792]
The controller nevertheless acknowledges every event after one processing
attempt, including reconcile and delete failures, specifically to prevent a
bad task from wedging the queue.[^ax-controller-worker-go-l64-l118] There is no
periodic resync in the inspected controller. A transient substrate failure
therefore needs a new mutation, while failed deletion needs manual retry.
Llame's durable Run worker should retain retry ownership with bounded backoff or
periodic desired-state resync; queue liveness must not erase recovery.

F80 — **Identity and network policy fail open.** The inbound control plane uses
a bare `grpc.NewServer` and trusts the request's `atespace` value as the storage
scope.[^ax-server-go-l38-l88] The server enables unencrypted HTTP/2, and the CLI
strips `http[s]://` before always dialing with insecure credentials.[^ax-server-main-go-l32-l80][^ax-cli-main-go-l201-l208]
A Task without a Gateway receives wildcard egress, and policy-application
failure is logged but does not fail reconciliation.[^ax-reconciler-go-l188-l205]
Although `HostRule` declares a port, the Substrate translation consumes only
host strings and turns `*` into allow-all.[^ax-api-proto-l175-l182][^ax-substrate-client-go-l449-l482]
High confidence: AX is a trusted, single-boundary control plane at this revision,
not a tenant isolation authority. A llame adapter must derive identity from the
authenticated Run, attach restrictive egress as a required invariant, fail
closed when it cannot apply policy, and never expose caller-selected `atespace`
as authorization.

F81 — **The declared integration surface is ahead of the runtime.** The README
claims warm Git, MCP, and skill setup plus explicit host allowlisting,[^ax-readme-l45-l58]
and the Workspace schema carries MCP registries, servers, and skill paths.[^ax-api-proto-l193-l229]
The default setup path only creates the skills directory; it does not
materialize skills or MCP configuration.[^ax-workspace-setup-go-l261-l269] A
model-backed workspace Planner exists, but the inspected production binaries do
not call its constructors.[^ax-workspace-planner-go-l26-l112] Its model client
also converts missing credentials, transport failures, and
`401`/`403`/`429`/`503` responses into the same canned successful plan instead
of an error.[^ax-model-client-go-l458-l501][^ax-model-client-go-l557-l620]
Treat these schemas as extension intent, not shipped capability. Llame should
accept an executor feature only after the adapter produces evidence that the
corresponding configuration was applied.

[^ax-go-mod-l1-l11]: [Go and Agent Substrate dependencies](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/go.mod#L1-L11)

[^ax-license-l1-l13]: [Apache 2.0 license](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/LICENSE#L1-L13)

[^ax-types-go-l30-l35]: [declarative resource kinds](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/pkg/apis/v1alpha1/types.go#L30-L35)

[^ax-server-go-l111-l198]: [task mutations persist desired state](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/server/server.go#L111-L198)

[^ax-redis-store-go-l133-l179]: [task saves publish reconcile events](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L133-L179)

[^ax-redis-store-go-l346-l379]: [gateway saves do not publish task events](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L346-L379)

[^ax-redis-store-go-l600-l636]: [workspace saves do not publish task events](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L600-L636)

[^ax-task-runner-main-go-l15-l22]: [task runner environment contract](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax-task-runner/main.go#L15-L22)

[^ax-task-runner-main-go-l48-l80]: [task runner specification loading](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax-task-runner/main.go#L48-L80)

[^ax-substrate-client-go-l207-l275]: [fixed runner, gVisor, volume, and snapshot template](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/substrate/client.go#L207-L275)

[^ax-runner-go-l106-l200]: [workspace setup and child process launch](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/runner/runner.go#L106-L200)

[^ax-runner-go-l203-l235]: [process-group supervision and local exit callback](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/runner/runner.go#L203-L235)

[^ax-server-go-l201-l237]: [task watch terminal phases](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/server/server.go#L201-L237)

[^ax-workspace-setup-go-l31-l64]: [workspace paths and initialization marker](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/setup.go#L31-L64)

[^ax-workspace-setup-go-l76-l127]: [marker-gated repository setup](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/setup.go#L76-L127)

[^ax-reconciler-go-l234-l305]: [sticky workspace-ready condition](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/controller/reconciler.go#L234-L305)

[^ax-redis-store-go-l727-l792]: [Redis consumer-group delivery](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/store/redis/store.go#L727-L792)

[^ax-controller-worker-go-l64-l118]: [unconditional event acknowledgement](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/controller/worker.go#L64-L118)

[^ax-server-go-l38-l88]: [bare gRPC server and caller-supplied atespace](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/server/server.go#L38-L88)

[^ax-server-main-go-l32-l80]: [unencrypted HTTP/2 server](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax-server/main.go#L32-L80)

[^ax-cli-main-go-l201-l208]: [insecure CLI transport](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/cmd/ax/main.go#L201-L208)

[^ax-reconciler-go-l188-l205]: [wildcard egress default and fail-open application](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/controller/reconciler.go#L188-L205)

[^ax-api-proto-l175-l182]: [HostRule port declaration](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/pkg/apis/v1alpha1/ax.proto#L175-L182)

[^ax-substrate-client-go-l449-l482]: [egress policy translation](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/substrate/client.go#L449-L482)

[^ax-readme-l45-l58]: [claimed workspace and gateway capabilities](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/README.md#L45-L58)

[^ax-api-proto-l193-l229]: [MCP and skills schema](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/pkg/apis/v1alpha1/ax.proto#L193-L229)

[^ax-workspace-setup-go-l261-l269]: [skills directory setup](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/setup.go#L261-L269)

[^ax-workspace-planner-go-l26-l112]: [model-backed workspace planner](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/workspace/planner.go#L26-L112)

[^ax-model-client-go-l458-l501]: [Google model client setup](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/model/client.go#L458-L501)

[^ax-model-client-go-l557-l620]: [model failure fallback response](https://github.com/google/ax/blob/d8ed0fe38bceb7842d3c47817d53d16ccdfcb601/internal/model/client.go#L557-L620)
