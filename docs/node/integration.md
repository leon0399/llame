# Shared installation, personal Node, and CLI integration

## Decision and evidence

The round-three baseline separated local execution from the terminal, but did not
integrate its domain interface with the shared installation. The terminal chose
between unrelated local requests and hosted REST calls; hosted chat-list search
was not the canonical recall tool; hosted Knowledge content could not be read
through the same terminal commands. The personal process also lacked an
independently owned application entrypoint.

The repository's [vision](../../VISION.md) requires an independently useful
personal Node and distinguishes Surface, Node, Personal Realm, Workspace, and
executor. The [distributed-execution research](../research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md),
particularly §5.14, proposes a modular Common Node Protocol. This iteration
implements a bounded part of that direction; the research's complete protocol
and synchronization requirements do not become implemented by association.

The selected design is two separately governed runtime compositions and reusable
client adapters, with common discovery and owner-retrieval contracts. It is not
one shared database or a remote server requirement for local use.

```text
apps/cli                         Terminal Surface
    |
packages/node-client             Session, IPC/HTTP, observation binding, cursors
    |
    +-- private IPC -----------> apps/node (llame-node)
    |                                |
    |                           packages/personal-node
    |                           SQLite + configured providers/tools + files
    |
    +-- authenticated HTTP ----> apps/api + existing workers
                                     |
                                Postgres/RLS + configured providers/tools + files

packages/node-protocol           Common core/realm access, versioned schemas
packages/tool-runtime            Existing MCP transport and admission code
packages/knowledge-filesystem    Existing bounded live-file adapter
packages/runtime-safety          Shared clipping, redaction and source scanning
```

The two applications implement the common access contract, not identical
orchestration internals. The hosted worker still uses pg-boss and its immutable
Run context; the personal executor retains its own bounded loop and private
approval channel. Do not move Postgres, tenant policy, or native grants into the
client package to make their APIs appear identical.

## What now connects

`core.describe` identifies the selected deployment, authenticated principal,
module versions, actual enabled retrieval methods, and recall strategy. The four
shared queries are conversation search/read and Knowledge search/read. Results
bind method, principal and source, while retaining the existing native evidence,
source coordinates, notices, and coverage diagnostics.

The shared installation exposes this through `POST /api/v1/node/requests`. Its
adapter calls the existing canonical tools under the session-derived user and
existing tenant runner. Installed does not mean allowed: discovery and invocation
both enforce the code-owned read-only gate, and Knowledge additionally needs an
operator-configured root. No arbitrary tool ID, owner, root, or permission enters
through request arguments.

The personal Node serves the same operations through private IPC. Trigram recall
still requires three characters; the hosted canonical search accepts shorter
queries. The response declares that difference rather than forcing different
indexes into an allegedly identical ranking algorithm.

Hosted admission is now `POST /api/v1/runs`, returning HTTP 202 and the Chat,
message, and Run IDs. The original web streaming route and the new route call
the same `ChatLoopService.acceptMessage` transaction/dispatcher. The CLI attaches
to existing durable events after admission. A lost admission response is uncertain
and is never resubmitted automatically. HTTP acceptance is not completion.

Local execution/control and hosted execution/control retain their respective
private IPC and REST/SSE contracts. Local administration is not exported through
HTTP. This is a common owner-access slice, not full execution-protocol parity.

## Build and operate

Use the repository's `.node-version` and `packageManager` pin:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=cli --filter=api --concurrency=1
```

Configure the standalone provider with the existing CLI configuration workflow:

```bash
node apps/cli/bin/llame.cjs config init
node apps/cli/bin/llame.cjs --local node capabilities
```

Edit the generated model configuration to name a model served by your own
endpoint. No model download or inference service is installed by llame.

Ordinary local commands start a temporary private Node automatically. To retain
execution across terminal connections, launch the independent application:

```bash
# Terminal A: persistent foreground Node, no CLI process required.
node apps/node/bin/llame-node.cjs

# Terminal B: attaches to the selected private data directory's Node.
node apps/cli/bin/llame.cjs --local node capabilities
node apps/cli/bin/llame.cjs --local chats search "indexing"
node apps/cli/bin/llame.cjs --local knowledge search "indexing"
node apps/cli/bin/llame.cjs --local run "Find my earlier indexing decision"
```

Explicit `--config` and `--data-dir` selections must agree between the application
and its client. `--native --cwd /absolute/project` at Node startup grants native
placement for that Workspace; the initiating CLI must select that same grant.
It never grants access to an arbitrary later directory. Native execution is
OS-user authority, not containment within the Workspace.

Connect to the upgraded shared installation:

```bash
node apps/cli/bin/llame.cjs remote enable https://api.example.com
node apps/cli/bin/llame.cjs auth login --email you@example.com
node apps/cli/bin/llame.cjs node capabilities
node apps/cli/bin/llame.cjs chats search "indexing"
node apps/cli/bin/llame.cjs chats read CHAT_UUID MESSAGE_SEQUENCE 0 40
node apps/cli/bin/llame.cjs knowledge search "indexing"
node apps/cli/bin/llame.cjs knowledge read SPACE_UUID notes.md 0 40
node apps/cli/bin/llame.cjs run "Use my node's existing tools"
```

Remote selection is saved and remains the default. `--local` changes only that
invocation. Connection, capability, auth, and version failures never silently
choose another authority or provider. Local and hosted data remain separate;
these commands search only the selected deployment, not a merged Home.

Knowledge search exposes a bounded first page. Native coverage and truncation
information remain visible. This common slice does not accept every hosted
search cursor, space filter, or advanced recall argument. Metadata operations
(list/show) retain their existing local/REST implementations.

## Identity and upgrade contract

Remote credentials remain separate from configuration and transcripts in private
app data. They are normalized-authority/account bound and use the existing
revocable human session, not a new OAuth protocol or machine identity. The HTTP
expected-principal header can only assert the session's subject, never select
another owner. Local identity derives from private same-user IPC. The local
runtime UUID is not a cryptographic enrollment key.

The shared `core`/`realm` contract is version **1**. The private IPC handshake is
now version **2**, because request names and retrieval result envelopes changed.
Stop round-three daemons and restart them with the upgraded `llame-node` (or
`llame node serve`) before using the new CLI. An old daemon fails negotiation;
the CLI does not ignore it or spawn a competing executor. No source-data migration
is introduced in this round.

Deploy the updated hosted API before switching remote CLI clients. Older APIs
lack the common endpoint and explicit admission route; clients fail rather than
silently scraping old UI streams. The existing web entrypoints remain available.
No new HTTP listener, public local port, or local-network authentication scheme
is introduced.

## Alternatives rejected

Requiring the hosted NestJS/Postgres installation for every CLI command would
contradict independent personal operation without solving synchronization.
Sharing a database between both runtimes would erase their ownership boundary.
A generic proxy for arbitrary tools would create a new authorization surface and
could accidentally expose native execution. Extracting a universal agent loop
now would obscure the already-different durability and policy contracts.

Instead, the current concrete clients share the operations they can actually
implement, and capability discovery makes missing operations explicit. This is
an integration seam with two real backends, not a speculative provider registry.

## Personal Realm remains a separate next capability

There is no replica enrollment, bidirectional synchronization, remote Workspace
execution, or automatic transfer of local tools to hosted Runs. A local model
cannot call hosted tools through this integration; owner query requests are a
Surface operation, not an inferred cross-authority model grant.

Before advertising Personal Realm mirroring, implement authenticated enrollment
and revocation, stable portable resource identities, a transactional semantic
change journal, checkpoints and idempotent receiving, explicit coverage, and
resource-specific reconciliation. Distinct resources must not merge by name.
Knowledge reconciliation must respect live files and recoverable Git changes.
Unlinking must not destroy local identity or pretend to erase remote copies.

Credentials, device configuration, host paths, Workspaces, caches, search indexes,
raw token/progress events, and execution approvals are not portable grants or a
ready-made replication journal. These exclusions follow the vision; UUIDs and a
shared request format alone do not meet its full-mirror promise.

## Evidence boundary

See the iteration's verification record. Node process and HTTP-fixture conformance
checks do not prove a deployed Nest/Postgres adapter. The API includes dedicated
unit and real session/RLS integration tests; those need the repository dependency
closure and database harness. Production MCP transport tests are separate from
injected-port runtime checks and must not be skipped to manufacture a green gate.
