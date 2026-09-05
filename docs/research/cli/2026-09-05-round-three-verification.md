# Round three: personal Node implementation and verification

Date: 2026-09-05. Source baseline: round-two bundle at `c800bd0`.
Implementation branch: `feat/personal-node-runtime`.
Implementation verified at `87ed691`; the following documentation-only delivery
commit records this evidence. The delivery manifest contains the exact final OID.
Nothing was pushed to GitHub.

## Decision and implemented boundary

The CLI becomes a thin Surface of an independently operable personal Node, not a
remote-only client of a mandatory Personal Realm service. Local Node operation
requires no llame account, Postgres, network listener or manually started daemon.
Ordinary local commands launch a private stdio process. An explicit foreground
`node serve` owns a private Unix socket and can outlive terminal connections.
Remote execution retains the existing hosted HTTP/SSE/Bearer adapter and saved
routing/auth state. It is not falsely presented as this new local protocol.

The personal Node owns SQLite, configuration/credential resolution, the model
loop, native and MCP execution, local recall, and read-only Markdown Knowledge.
The UI renders events and participates in connection-scoped approvals. Native
boot grants cannot be enlarged by a client or a model. Local-owner authority is
the OS account, not cryptographic enrollment or a proven human click. Same-user
malicious clients, programs and root are outside filesystem permission isolation.

Conversation search uses a rebuildable FTS5 trigram projection of visible
user/assistant text. Queries are literal and multilingual with a three-character
minimum; this is not semantic retrieval. Schema version 2 preserves existing
source message bodies and Node/Chat/Run identities, adds message UUIDs and dense
Chat-local coordinates, and maintains insert/update/delete index triggers.
Knowledge spaces are explicitly provisioned UUID directories beneath a managed
root; live UTF-8 Markdown search/read reuses the hosted adapter. Model Runs bind
the available space IDs at admission. Coverage failures remain visible.

See `docs/node/local-protocol.md`, `apps/cli/README.md`, the updated SPEC and
OpenSpec capability documents, and
`docs/research/cli/2026-09-05-personal-node-boundary.md` for the rationale,
implemented protocol and deliberately deferred synchronization contract.

## Executed checks

### Core and process tests: 88 passed, 0 failed, 0 skipped

Command, after the dependency-limited builds described below:

```sh
node --test apps/cli/tests/*.test.mjs packages/personal-node/tests/*.test.mjs
```

The same 88 tests passed in the working checkout and again after making a Git
bundle, verifying it, cloning the bundle into a new directory and rebuilding
there. Workspace links in the second build target the fresh clone, not the first
checkout. Tests launch compiled production code; no model credentials or external
billable provider were used.

The existing 63 core checks continue to cover configuration and persistent remote
routing, protected credential files, authentication and revocation races, real
terminal password handling, model streams, native approval, interruption and
uncertain-outcome recovery, HTTP/SSE cursor reconnection and hosted OpenAPI fixture
compatibility. Existing process-death expectations were updated to target the
actual Node executor PID rather than treating a Surface PID as the executor.

The additional 25 checks cover:

- Actual subprocess/Unix-socket Node operation; persistent inference finishes
  after killing its initiating CLI process, can be replayed from a new Surface,
  and can be cancelled through another connection. A persistent Node resolves
  its own model credential even when the connecting client does not inherit it.
- Real native file writes via the Node protocol, per-connection approval IDs,
  cross-connection and replay rejection, denial after disconnect, and durable
  local principal/channel/transport/prompt-hash decision provenance.
- Protocol negotiation, caller-identity/unknown-field rejection, duplicates,
  split multibyte UTF-8, invalid/oversized frames and unframed EOF; configuration
  and native boot-grant mismatch rejection; private/stale/dangling-symlink socket
  refusal without fallback and long data paths on the stdio-only path.
- Full local model-loop conversation search/read and live Knowledge retrieval;
  literal multilingual queries, Chat-local coordinates and stable UUIDs,
  current-Chat exclusion, no indexing of system/tool/hidden reasoning, bounded
  logical-line reads, FTS maintenance/rebuild without source mutation, and
  migration of a real version-1 database.
- Managed Knowledge identity without name-merging, live changes, path/symlink and
  UTF-8 errors, explicit failed-space coverage, Run-bound source sets and bounded
  event-page replay.

Most fixtures are real HTTP servers, filesystem paths, SQLite databases,
processes, and terminal or socket connections. The dependency-light MCP host test
uses an **injected connection port**, not the production SDK transport. Passing
that test does not establish production MCP interoperability.

### Production MCP wire tests: 0 passed, 5 failed, 0 skipped

```sh
node --test apps/cli/tests/integration/*.test.mjs
```

These were actually run, including in the fresh clone. All five fail before the
intended end-to-end transport behavior can be verified. Directly loading the
production module fails with `Cannot find module '@ai-sdk/mcp'`. The MCP host
correctly reports a bounded connection/discovery failure and does not proceed to
model inference. No test was deleted, skipped or changed into a pass to conceal
this limitation. The production test's expected catalogue was updated to include
the two new native recall tools.

The existing SDK implementation was salvaged, not replaced by a test stub.
Production HTTP/stdio MCP functionality remains **unverified** in this delivery.
A dependency-complete environment must pass the normal test command before release.

### Targeted builds and static checks

Using the available global compiler, these production builds completed without
diagnostics: `config-interpolation`, `runtime-safety`, `knowledge-filesystem`,
`personal-node`, and `cli`. The command was `tsc -p .../tsconfig.build.json`, with
`--types node` for shared packages.

The `tool-runtime` build failed. Missing dependencies include `@ai-sdk/mcp`,
`@modelcontextprotocol/sdk`, `ai`, `ajv`, `ajv-formats`, and `zod`, with consequent
type errors. TypeScript emitted JS/declarations despite those diagnostics. The
personal-node build consumed those emitted declarations. Therefore its successful
build is **not** a full dependency-aware typecheck or a green monorepo build.

Ignored workspace symlinks and the environment's existing Node declarations were
used to make the dependency-light paths testable. No third-party package was
fabricated, vendored as a stub or committed. The evidence archive contains the
small setup script with a configurable checkout path for reproducibility.

Manifest dependency names/specifiers match the lockfile importers for CLI, API,
personal-node and knowledge-filesystem. No new external dependency version was
introduced. Fourteen extracted Knowledge adapter/source/test files and the
conversation logical-line scanner were compared with the round-two Git source
and are byte-identical. Git rename history is retained. The thin CLI's direct
imports were checked against SQLite/model/tool-executor modules, and
`git diff --check` passed.

The existing moved Vitest tests, API consumers and coverage/mutation jobs remain
wired to the new package boundaries, with a dedicated Knowledge coverage/mutation
job. **Those gates were not executed here**, and retaining them is not evidence
that their full dependency-complete run is green.

### Packaging and bundle

Git bundle verification succeeded, and a fresh clone built and ran the core tests
as described above. The bundle contains full ancestral history on the feature
branch; it is not an incremental bundle requiring a separate baseline.

The standalone packager was run and failed closed on missing production
`@ai-sdk/mcp`. No incomplete standalone archive is delivered. The source bundle
requires the repository's normal dependency installation before a production
build or portable packaging.

## Environment and unexecuted checks

Observed: Linux, Node **22.16.0**, global TypeScript **5.8.3**, Git **2.47.3**.
Repository pins: Node **22.23.1**, pnpm **11.22.0**, catalog TypeScript **5.7.3**.
The pnpm executable is unavailable. Registry DNS failed (`Could not resolve host:
registry.npmjs.org`) under the environment's package-network restriction. There
was no successful `pnpm install --frozen-lockfile` in this round.

Not executed: the pinned-toolchain monorepo build/typecheck, full lint/format,
original Vitest/coverage/mutation suites, API/Postgres integration, browser E2E,
live hosted deployment, live model provider, macOS/Windows acceptance, and
production MCP interoperability. The real-PTY check ran on Linux with util-linux
`script`; it is not cross-platform verification. Targeted green results must not
be represented as full CI or release certification.

## Explicit remaining product boundaries

No Personal Realm replication, cryptographic Node enrollment, authenticated
remote-tool gateway, generic cross-node Workspace execution, offline hosted
Knowledge mirror, Profile Space binding, model-independent semantic search,
automatic retention/compaction, background-service installation, browser/TCP Node
endpoint, resumable approval takeover or cross-connection mutation idempotency.
Local and hosted engines/DTOs are not fully unified. The personal Node retains one
advancing Run per data directory; another Run is rejected rather than queued.

Native execution remains OS-user execution, not a sandbox. Configured MCP programs
also have that authority. Configured inference can receive recalled personal
text; private files do not themselves implement egress governance. Stop the Node
and clients and back up the complete state before migration, protecting auth
files separately. There is no backwards-version downgrade procedure.

The next architectural work should align concrete local/hosted contracts before
adding an authenticated, idempotent semantic replication journal with explicit
coverage and resource-specific reconciliation. Stable UUIDs alone are not sync.
Secrets, config/host paths, raw token/progress events and derived indexes are not
portable just because the Node stores them.
