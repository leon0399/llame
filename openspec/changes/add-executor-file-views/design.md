## Context

See `proposal.md` for the motivation. The shipped Knowledge implementation has
trusted owner-scoped Space resolution and bounded live Markdown reads. Its
`knowledge_search` and `knowledge_read` tools are already model-facing and their
live semantics are established by `openspec/specs/knowledge-tools/spec.md`.
The executor distinction follows the noncanonical [Sandbox and Workspace
research](../../../docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md#59-native-and-versioned-sandbox-environments): a
view is mounted data, while a SandboxInstance is an execution realization. The
publication distinction follows [Knowledge absorption and
publication](../../../docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md#511-knowledge-spaces-and-absorption): a candidate being
published does not imply that the governing authority accepted it.

C1 adds a reusable executor boundary. It must carry a private source binding into
an executor without making the executor responsible for owner lookup, portable
identity, Git publication, or model tool admission. The implementation has to
support a future native adapter and a future managed-executor adapter without
choosing either executor's placement, operating system, or process environment.

The current read-only tool loop also retries a job attempt from the beginning.
That makes C1 draft mutations safe only while they are private view state. C2
must add recovery or dedupe before hosted persistent writes are advertised.

## Goals / Non-Goals

**Goals:**

- Define a small `packages/file-views` contract that owns logical path mapping,
  bounded line reads, draft mutation, coverage accounting, and closed errors.
- Keep all authority inputs private and trusted: Run identity, current owner
  binding, stable Space ID, source/view roots, base manifest, and hashes/bytes.
- Make full-file replacement and uniquely covered exact editing distinguishable,
  with observations tied to the current private view revision.
- Give every configured executor the same logical view and draft revision when it
  is admitted, with a refusal path when that cannot be guaranteed.
- Keep C1 independently testable and usable by later publication and sandbox
  work without changing the existing Knowledge tool inventory.

**Non-Goals:**

- Git commits, publication journals, canonical live writes, or API endpoints.
- A shell implementation, a managed Sandbox implementation, or a decision about
  executor placement and environment construction.
- Origin-namespace persistence, cross-authority portable locators, federation,
  import/enrollment, or authority transfer.
- Replacing or aliasing `knowledge_search`/`knowledge_read`, episodic migration,
  Profile activation, or a generic permission-policy system.

## Decisions

### D1. Keep the shared module executor-neutral

`packages/file-views` owns pure contract types, logical path validation, line
range/result shaping, draft state transitions, and coverage checks. It receives
an adapter port for bytes and mounting; it does not import the API, Nest,
PostgreSQL, a Node filesystem implementation, a shell, or a Sandbox SDK. The
adapter owns the materialized private view directory and its I/O. This keeps one
behavior contract usable by later adapters and makes the package tests run
without a live database or host directory.

The API/runtime layer creates a trusted binding after owner-scoped Space
authorization and injects the binding into the package. The package treats that
binding as capability data, but the adapter remains responsible for proving the
root and entry are safe at the I/O boundary. A caller-provided binding is never
accepted as equivalent to the trusted one.

An API-specific implementation would couple source authorization to the shared
module. A second implementation in each executor would make line, path, and
coverage semantics drift. The port plus one shared state machine preserves the
boundary while leaving placement decisions to the owning adapter.

### D2. Use a logical view path and retain source identity separately

The public path form is `/knowledge/<space-id>/<relative-path>`. The package
parses the stable Space ID prefix, validates the Knowledge-relative suffix, and
passes a normalized relative path to the trusted adapter. The adapter maps that
relative path to its private view root. Results identify the stable Space ID and
relative path; they never contain the trusted source root or private view root.

This keeps a Knowledge Space ID and path useful across local bindings while
preventing an execution path from becoming a portable locator. C1 persists no
origin namespace. The #547 qualification seam is reserved for a stable origin
namespace distinct from the current governing-authority binding, as described by
the newer #581 identity direction; C1 therefore does not claim a cross-authority
portable locator or turn the current authority into permanent identity.

Path checks reuse the shipped Knowledge restrictions: Markdown suffix, component
and byte limits, no traversal/empty components/backslashes/control characters,
regular files only, no links, and no source metadata or credentials. The adapter
performs the final no-follow and containment checks because string validation
alone cannot establish filesystem safety.

### D3. Make the materialized view directory the one draft truth

Admission captures the bounded selected source set and creates a private base
manifest containing bytes and hashes. The adapter materializes the admitted
snapshot in one private view directory; that directory is the sole draft-byte
truth seen by FileView operations and configured executor tools. A copy-on-write
or overlay mechanism may implement the directory, but an independent in-memory
draft store SHALL not become authoritative. The package assigns an internal view
revision to the base and increments it after each accepted mutation or refresh.
A source change detected while admission is validating the base yields
`file_view_stale`.

The FileView lifetime is independent of a SandboxInstance, executor process, or
branch/session placement. At most one writable view per Run is a staged C1
restriction for mutation scope; it does not make the view ID an executor ID or
require a view to be recreated whenever an executor is replaced or reused. An
adapter may attach or detach an already admitted view only after the repeated
authorization check, and an unavailable attachment fails closed.

The view's private revision makes coverage precise. Every read observation is
keyed by path and revision. A mutation invalidates coverage for the changed file;
the next mutation must observe the new revision. The base manifest alone never
counts as model-observed coverage. This prevents a digest or a hidden snapshot
from authorizing replacement of bytes the model did not receive.

Configured executor tools can mutate the same materialized directory. Before a
FileView read, edit, or later publication handoff, the trusted adapter freezes
other writers, refreshes the directory against the prior manifest, validates all
changed paths/bytes, advances the view revision, and invalidates coverage for
changed files. Unauthorized files, links, invalid UTF-8, or bound violations make
the operation fail closed. This refresh is an internal adapter operation, not a
model-facing fourth file tool.

The live Knowledge adapter remains a separate path. C1 does not alter its
resolver, and the runtime binds `knowledge_read`/`knowledge_search` to live
Space access. An active view therefore cannot change the meaning of an existing
tool call.

### D4. Reuse the existing line and result bounds

The package uses the existing logical-line rules and 2,000-line/15,000 UTF-16
read result limits. It returns numbered whole lines, exact `nextOffset`, and the
existing line/output cut reasons. A caller-supplied `limit` that completes its
requested range normally leaves `cutReason` absent, even when the file has later
lines. An output cap never clips a line; an oversized first selected line is a
closed limit error. Coverage records only bytes that the successful response
actually exposed, including EOF when the response reached the current end.

The parser is shared by the view read and can be reused by the live adapter only
after its current results and tests remain byte-for-byte compatible. C1 does not
rewrite historical Knowledge observations or generic tool truncation.

### D5. Make mutation preconditions explicit and asymmetric

`write` is whole-file replacement. The package accepts it only when coverage
spans every current file byte and EOF at the current revision, or when a trusted
read observation proves the exact path absent at the current base. `edit` is
targeted replacement. It searches literal `oldText` in the current draft, refuses
zero or multiple matches, and accepts the operation when coverage spans the
unique match range at the current revision. It does not require unseen file bytes
to be copied into model context.

Both operations validate the resulting UTF-8 Markdown and per-file bound before
mutating the materialized view directory. They return a bounded draft summary,
not content hashes or private paths. Failed preconditions are side-effect free.
The package does not
attempt an implicit rebase, fuzzy edit, regex replacement, or last-writer-wins
merge; those would weaken the recovery boundary C2 must later publish.

### D6. Make adapter admission a repeated authorization boundary

The runtime asks a trusted authorization port before opening a view and before
each new file-tool binding. The check receives the Run identity, stable Space ID,
view ID, current view state, and selected executor policy from trusted context.
It returns a capability or a closed denial. Model arguments can supply only the
operation's public path/range/content fields.

The mount handoff contains the same logical root, source set, current materialized
view directory, current draft revision, and path mapping for every adapter. A
native or managed adapter that cannot provide that exact view or cannot freeze and
refresh external writers refuses with `file_view_executor_unavailable`. The
contract does not prescribe how the adapter establishes the mount or which tools
the environment provides; it does require one shared directory and draft state
once admitted.

### D7. Keep C1 draft-only and preserve approval boundaries

The package exposes operation contracts to trusted adapters but does not register
hosted `read`/`write`/`edit` declarations in the current model tool catalog. C2
owns hosted persistent draft exposure after its retry recovery gate. A personal
adapter can consume the contract only through the existing #659 per-file approval
path; the shared package does not turn that approval into a Run-wide grant.

This preserves the current `tool-calling` read-only loop and keeps retries from
replaying a canonical side effect. C1's tests cover policy refusal and inventory
stability rather than introducing a provisional public write tool that would
need to be removed or migrated. C2 owns the publication state machine and must
keep candidate-published and accepted distinct, even where a local adapter can
perform both transitions in one workflow.

## Risks / Trade-offs

- **[Coverage race]** A source or draft may change between observation and a
  mutation. **Mitigation:** bind coverage to a private view revision, invalidate
  the changed file's ranges after mutation, and refuse stale coverage.
- **[Filesystem confusion]** A safe-looking path string can still resolve through
  a link or escape a root. **Mitigation:** adapters perform no-follow entry checks,
  containment validation, and regular-file checks; the package returns closed
  errors and never falls through to another root.
- **[Context leakage]** A private root, hash, or raw filesystem error could enter
  a tool result. **Mitigation:** typed public result/error constructors and tests
  assert that model-facing payloads contain only logical identity and bounded
  operation fields.
- **[Executor divergence]** One adapter could expose a stale copy while another
  sees the draft. **Mitigation:** the materialized view directory is the one byte
  truth; the mount contract carries one view handle and revision, and admission
  fails when the adapter cannot freeze/refresh and guarantee the same view.
- **[Durability gap]** A process crash discards a draft. **Mitigation:** C1 calls
  all mutations drafts and leaves persistence/recovery to C2; hosted writes stay
  unadvertised until that gate exists. C2 records candidate publication and
  authority acceptance as separate outcomes.
- **[API coupling]** Extracting live Knowledge code into the package could alter
  shipped behavior. **Mitigation:** keep the shared package's port separate and
  require compatibility tests before reusing any live reader helper.

## Migration Plan

1. Land this proposal with no model catalog or live Knowledge behavior change.
2. On `knowledge-files/views-core`, add `packages/file-views` and its pure unit
   tests for path mapping, line reads, coverage, draft transitions, and errors.
3. On `knowledge-files/views-adapters`, add trusted binding/mount ports and
   adapter contract tests, including reauthorization, one writable view per Run,
   and same-view observations. Keep concrete native/Sandbox placement out of
   this layer.
4. After C1 is approved and merged, C2 and C3 may develop against the frozen
   contract. The eventual linear stack is:

   `master <- knowledge-files/proposal <- knowledge-files/views-core <-
knowledge-files/views-adapters <- knowledge-files/publication-storage <-
knowledge-files/publication-git <- knowledge-files/publication-integration <-
knowledge-files/publication-acceptance <- knowledge-files/sandbox-runtime <-
knowledge-files/sandbox-node-tools <- knowledge-files/sandbox-acceptance <-
knowledge-files/finalize`

5. The shared finalizer runs spec sync, strict validation, Markdown/format/diff
   checks, and archive movement for all connected changes only after every
   implementation task is checked. There is no database or canonical-content
   migration to roll back in C1; removing the package and adapters restores the
   prior public behavior.

### Dispatch map

| Layer                            | Owner            | Boundary                                                                  | Required verification                                                 |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `knowledge-files/proposal`       | C1 proposal      | This proposal, design, delta spec, and tasks                              | Strict OpenSpec + Markdown/format/diff checks                         |
| `knowledge-files/views-core`     | C1 core          | `packages/file-views` contract, state machine, validation, and pure tests | Package lint, typecheck, unit/coverage tests                          |
| `knowledge-files/views-adapters` | C1 adapters      | Trusted binding, mount, reauthorization, and adapter contract tests       | Focused adapter tests, API typecheck/lint, same-view and denial cases |
| `knowledge-files/publication-*`  | C2               | Recovery, canonical publication, and hosted/personal integration          | C2 recovery and owner-isolation gates; depends on C1                  |
| `knowledge-files/sandbox-*`      | C3               | Concrete executor runtime and configured tool integration                 | C3 isolation and same-directory acceptance; depends on C1             |
| `knowledge-files/finalize`       | Shared finalizer | Sync/archive all connected specs and task records                         | Strict `--specs`/`--all`, Markdown, format, diff checks               |

## Open Questions

The concrete adapter backing and executor environment remain intentionally
undecided for C1. C3 can choose them while preserving the logical path, one-view
mount, authorization, and draft-state contract defined here. C2 likewise chooses
publication storage and provider mechanics while preserving the distinction
between publishing a candidate and accepting it.
