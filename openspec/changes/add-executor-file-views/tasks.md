## Delivery Stack

Use `$gh-stack` for every branch transition and keep this exact eventual linear
order:

```text
master
  <- knowledge-files/proposal
  <- knowledge-files/views-core
  <- knowledge-files/views-adapters
  <- knowledge-files/publication-storage
  <- knowledge-files/publication-git
  <- knowledge-files/publication-integration
  <- knowledge-files/publication-acceptance
  <- knowledge-files/sandbox-runtime
  <- knowledge-files/sandbox-node-tools
  <- knowledge-files/sandbox-acceptance
  <- knowledge-files/finalize
```

The connected proposal layer contains the related proposal directories; this
task file records only C1 implementation and shared-finalization tasks. Do not
create implementation branches before Leo's explicit proposal approval. After
C1 is approved, C2 publication and C3 sandbox work may be developed in parallel
against the frozen FileView contract and then linearized in the order above.
Each implementation layer uses `$openspec-apply-change` only for its assigned
tasks, marks only its own tasks checked, and replays lower-layer fixes upward
with `$gh-stack`.

Ownership map: `knowledge-files/views-core` owns the shared package and pure
tests; `knowledge-files/views-adapters` owns trusted binding, mount, and adapter
contract tests; `knowledge-files/publication-*` owns C2 recovery/publication and
its own task history; `knowledge-files/sandbox-*` owns C3 runtime/tool work and
its own task history; `knowledge-files/finalize` is the one shared finalizer for
sync/archive across all connected changes. C1 never closes #212.

## 1. `knowledge-files/views-core` - C1 Shared FileView Module

**Base:** `knowledge-files/proposal`

**Ownership:** `packages/file-views` pure contract/state/validation and focused
tests. No API, database, Git publisher, model tool registration, or concrete
Sandbox implementation. Implement with `$openspec-apply-change` and
`$gh-stack` after proposal approval.

- [ ] 1.1 Add the zero-dependency `packages/file-views` workspace package, exports, TypeScript configuration, and package checks; verify its build, lint, typecheck, and unit-test commands run without importing `apps/api` or an executor SDK.
- [ ] 1.2 Define private FileView binding and logical source identity types carrying opaque view ID, Run identity, stable Space ID, relative paths, base manifest hashes/bytes, observed coverage, and draft revision; verify type/serialization tests omit roots, host paths, hashes, and origin namespace from model-facing values.
- [ ] 1.3 Implement logical `/knowledge/<space-id>/` path mapping and Markdown path validation with component/byte bounds, traversal/link/excluded-file rejection, and closed errors; verify table-driven tests cover valid paths, host paths, symlinks, `.git`, credentials, controls, and out-of-set files.
- [ ] 1.4 Implement the existing logical-line parser and bounded read result (`offset`, `limit`, numbering, delimiter preservation, `nextOffset`, cut reasons, 2,000-line and 15,000-UTF-16 caps); verify empty files, LF/CRLF/lone-CR, terminal delimiters, continuation, output-limit behavior, oversized lines, invalid ranges, invalid UTF-8, and normal explicit-limit behavior.
- [ ] 1.5 Implement revision-keyed read coverage and absence observations, proving full-file byte/EOF coverage for `write` and exact target-range coverage for `edit`; verify partial pages, hash-only observations, stale revisions, external refresh invalidation, and mutation invalidation cannot authorize an overwrite.
- [ ] 1.6 Implement literal unique `edit` and whole-file `write` draft transitions against the materialized view directory with UTF-8/Markdown/file-size validation and atomic failure behavior; verify creation requires observed absence, replacement requires full coverage, missing/ambiguous matches fail, successful drafts remain private, and later view reads see the draft.
- [ ] 1.7 Run the complete package verification for this layer, including focused coverage for every `executor-file-views` requirement and `git diff --check`; verify no existing Knowledge tool declaration or live-read behavior changes.

## 2. `knowledge-files/views-adapters` - C1 Trusted Adapter Contract

**Base:** `knowledge-files/views-core`

**Ownership:** Trusted binding/admission, repeated authorization, materialized
view handoff, refresh/freeze lifecycle, view lifetime, and adapter contract
tests. Keep concrete executor placement and environment construction unresolved.
Implement with `$openspec-apply-change` and `$gh-stack`.

- [ ] 2.1 Add the trusted admission port that receives Run owner context and current Space binding, permits at most one writable Space/view per Run, supports optional private scratch, and keeps FileView lifetime independent of executor process/SandboxInstance/branch/session; verify missing identity, revoked access, duplicate writable views, detach/reattach, and scratch isolation.
- [ ] 2.2 Add repeated authorization for every new view-tool binding and the closed policy/executor-unavailable outcomes; verify model arguments cannot select owner, root, view ID, executor, or source locator and revocation is checked before filesystem access.
- [ ] 2.3 Add the adapter mount and materialized-directory contract that passes one logical root, admitted source set, path mapping, current draft revision, and view handle to configured tools; verify fake native and managed adapters observe identical draft bytes, external command changes are frozen/refreshed with coverage invalidation, and an incapable adapter cannot fall back to live content or a host directory.
- [ ] 2.4 Preserve the personal adapter's #659 per-file approval seam and keep hosted persistent draft writes out of the model catalog until C2's recovery gate; verify policy-denied writes are closed, two personal file writes do not share one approval, and the existing `knowledge_search`/`knowledge_read` declarations remain unchanged.
- [ ] 2.5 Run focused adapter tests plus package/API typecheck and lint checks applicable to the touched contracts; verify all failures are structured, secret/path-safe, atomic, and free of silent native/live fallback.

## 3. `knowledge-files/finalize` - Shared Spec Sync and Archive

**Base:** `knowledge-files/sandbox-acceptance`

**Ownership:** One shared finalizer owns canonical sync, final task records, and
archive movement for every connected change. This layer contains no runtime,
storage, API, or publication repair. Use `$openspec-sync-specs`,
`$openspec-archive-change`, and `$gh-stack`; C2 and C3 task details remain in
their sibling changes.

- [ ] 3.1 Sync the verified C1 `executor-file-views` delta and all approved C2/C3 deltas into canonical specs; verify `pnpm exec openspec validate --specs --strict` passes and unrelated Knowledge/tool requirements remain unchanged.
- [ ] 3.2 Confirm every connected change's status JSON is complete and every implementation task is checked; verify the finalizer stops on missing artifacts or unchecked tasks rather than using an incomplete archive path.
- [ ] 3.3 Archive all connected changes while preserving checked task history, then run `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify the final diff contains canonical sync/archive movement and the correct issue-closing owner.
