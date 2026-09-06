## 1. Delivery contract and prerequisites

Use `$gh-stack` and `$openspec-apply-change` for each assigned implementation
layer. The proposal bundle is `knowledge-files/proposal`; implementation waits
for explicit proposal-PR approval under CONTRIBUTING.md. No implementation branch
is created by this proposal.

Exact landing stack:

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

C1 owns the views layers; C2 owns the four publication layers; C3 owns the
Sandbox layers. C2 and C3 may develop concurrently against approved C1 contracts,
but land in this order after rebasing. Agents do not revert or independently
redefine another lane's modules. One integrator owns final spec synchronization
and archive for the bundle. #212 is closed only by publication-acceptance after
its revised scope has been agreed; the proposal and substrate layers do not
claim completion.

- [ ] 1.1 On publication-storage, verify approval of C2's managed enrollment, external-repository refusal, local-only acceptance, and single-file scope; reconcile #212's issue text before implementation and record the approved revision in the handoff.
- [ ] 1.2 On publication-storage, verify the #659 successor Knowledge/runtime packages and C1 views-core/views-adapters contracts exist on the base; inspect `gh stack view --json` and package builds, and stop integration rather than recreating missing extractions.

## 2. publication-storage: owner-scoped intent and enrollment state

This layer owns new hosted publication schema/repositories, the personal SQLite
equivalent, and the shared publisher's storage boundary. It does not expose write
tools or alter C1 file operations.

- [ ] 2.1 Add disabled-by-default enrollment and one-publication-slot-per-Run records with bounded base/desired content and durable state transitions; verify uniqueness across duplicate and changed provider call IDs, and retained recovery data after Chat deletion.
- [ ] 2.2 Generate transactional/idempotent Drizzle migrations and personal store migrations; verify `pnpm --filter api db:check`, enabled and forced RLS, negative cross-owner reads/writes, missing-identity denial, and existing data preservation.
- [ ] 2.3 Implement durable initialization ownership and owner-scoped recovery enumeration without a cross-tenant reaper; verify interrupted/concurrent first enablement and unknown metadata refusal using process-failure tests.
- [ ] 2.4 Run affected package/API lint, typecheck, coverage, build, and integration checks; verify no executable write tools were enabled by this storage layer.

## 3. publication-git: local candidate acceptance and live installation

This layer owns `packages/knowledge-publication` repository operations and the
local-only publication adapter, using real filesystem/Git tests. It consumes
C1's manifest and leaves CLI, HTTP, and model-loop policy to the next layer.

- [ ] 3.1 Implement the supported cross-process lock and persistence preflight; verify two processes exclude each other, a paused holder is not bypassed, process death releases ownership, and unsupported filesystems fail closed.
- [ ] 3.2 Implement Git initialization without content commits, safe recognition of publisher-owned metadata, and refusal of external repositories; verify existing files and dirty/untracked content remain byte-identical after success and every injected failure.
- [ ] 3.3 Implement single-file diff validation, unchanged handling, observed-base conflict detection, and bounded preimage retention; verify create, correction, dirty target, rename/delete/bulk refusal, symlink/hardlink/parent escape, UTF-8, and byte limits.
- [ ] 3.4 Build deterministic candidate commits and fence local accepted-ref changes using exact expected parent; verify identical reconstruction, unexpected ref movement refusal, unrelated files/index entries excluded, and no inherited hooks/filters/commands or secret-bearing diagnostics.
- [ ] 3.5 Implement temporary-file installation and intent reconciliation; inject failure before/after journal, object write, accepted-ref update, rename, fsync, and receipt settlement, and verify one commit, preserved third-party bytes, and honest accepted versus recovery-pending results.
- [ ] 3.6 Verify revocation and cancellation at each acceptance/install boundary, including recovery of previously installed effects without authorizing new writes; run package lint, typecheck, coverage, sequential build, and focused hosted/personal storage integration.

## 4. publication-integration: owner settings and first-party tool execution

This layer owns the hosted publication setting/API, exact write-tool admission,
snapshot rebinding, retry recovery, and personal Node publication integration.
It must not broaden MCP eligibility or implement a Sandbox executor.

- [ ] 4.1 Add the owner-controlled publication setting endpoint and personal operation; verify malformed selectors, other-owner denial, explicit enablement, disable/drain behavior, no automatic conversion, and existing Knowledge reads without Git.
- [ ] 4.2 Wire C1 `read`, `write`, and `edit` plus C2 `publish` into the approved runtime paths; verify owner/view checks per admission, exact allowlists, unchanged historical declarations, output bounds, and personal per-operation approve/deny behavior.
- [ ] 4.3 Update every catalog, schema, snapshot-binding, and executable classification gate atomically; verify an unrelated write-low-risk tool and a write-capable MCP declaration remain unavailable despite allowlisting or claimed idempotence.
- [ ] 4.4 Serialize same-view reads/mutations/publication in provider order while retaining independent read concurrency; verify same-step dependencies, failure outcomes for every call, and unchanged step-cap accounting.
- [ ] 4.5 Reconcile the Run publication slot before model execution on retries, fence stale draft attempts, and restore the existing accepted observation without another effect; verify queue redelivery, changed model arguments, terminal Run recovery, and no repeated native execution.
- [ ] 4.6 Add a bounded operator recovery procedure for unresolved effects and safe rollback instructions; verify them against an interrupted fixture rather than claiming a generic reset restores correctness.
- [ ] 4.7 Run API/package lint, typecheck, coverage, integration, sequential builds, OpenAPI lint and generation; verify a second client-generation pass produces no additional diff.

## 5. publication-acceptance: #212 and combined #39 proof

This layer owns the end-to-end feature proof and shipping documentation, without
adding publication semantics or changing shared interfaces.

- [ ] 5.1 Add the research-to-note-to-new-Chat-read-to-episodic-recall scenario using existing fixtures; verify refresh/reopen, source attribution, one accepted commit, and no reliance on a Git remote or Sandbox.
- [ ] 5.2 Execute the same minimal publication contract against the personal Node and hosted worker with negative owner isolation for hosted data; verify differing storage/approval adapters preserve the same candidate/acceptance outcomes.
- [ ] 5.3 Update CHANGELOG, ROADMAP, SPEC, operator docs, and #212's completion evidence for the behavior actually shipped; verify current live-read behavior and deferred shell/bulk/federation scope are accurately stated.
- [ ] 5.4 Run focused product E2E and every applicable CONTRIBUTING.md gate; self-review and monitor the ready PR as required, and use `Closes #212` only after the evidence is complete.

## 6. finalize: integrator-owned synchronization and archive

- [ ] 6.1 After all bundle implementation layers pass, sync C2 deltas with `$openspec-sync-specs`, update the tool-calling Purpose to reflect the admitted first-party write exception, and verify full requirement/scenario preservation with strict spec validation.
- [ ] 6.2 As part of the single bundle finalization, verify every artifact and task in all three changes is complete, archive C2 with `$openspec-archive-change`, and preserve checked task history; run strict `--specs` and `--all`, Markdown lint, format check, and `git diff --check`.
