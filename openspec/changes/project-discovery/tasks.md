# Tasks

## 1. Proposal layer

Branch `project-discovery/proposal` has parent `master`. It owns planning artifacts, the Project instructions glossary clarification, and the two proposed ADRs. Estimated authored churn is 1200 to 1700 lines, with no generated output. This layer closes no feature issue.

The exact delivery stack is:

```text
master
  <- project-discovery/proposal
  <- project-discovery/instructions-api
  <- project-discovery/locator
  <- project-discovery/context
  <- project-discovery/editor
  <- project-discovery/finalize
```

Every layer can merge after its parent passes its gates. No two implementation layers require a joint merge. The context layer has an inseparable worker revision boundary for selection events, preparation, dispatch, recovery, and compaction. Do not split that invariant to meet the review target. Only the proposal branch exists before approval.

Use `$gh-stack` for branch, publication, and merge operations. After published proposal approval, create only the next layer and run `$openspec-apply-change` for its assigned tasks. Re-estimate authored churn against each immediate parent. Report generated SQL snapshots, OpenAPI, and web client output separately. Do not defer shipping documentation to finalize.

For this delivery, Leo authorizes the next layer after focused local proof and multi-agent self-review while CI, mutation checks, and GitHub review continue concurrently. This replaces the before-next-layer review ordering below. Mark ready only after normal CI passes. Complete every CI, mutation, reviewer, unresolved-comment, and required-action gate before final handoff and archive readiness.

- [x] 1.1 Write and commit the proposal, design, all delta specs, and the applicable ADRs. Prove strict validation and canonical scenario preservation.
- [x] 1.2 Run independent iterative review round one with at least two reviewers. Verify findings and commit the author's accepted revisions separately.
- [x] 1.3 Run independent iterative review round two with at least two reviewers. Verify findings and commit the author's accepted revisions separately.
- [x] 1.4 Complete proposal SR against the actual parent-relative diff and `REVIEW_GUIDE.md`. Prove Markdown lint, formatting, strict OpenSpec validation, and `git diff --check`.
- [x] 1.5 Publish this layer as a draft through `$gh-stack`. Verify its immediate base, draft state, issue references, and delivery Project fields.
- [x] 1.6 Reconcile merged proposal approval and ready-proposal review evidence before implementation. Normal current-head CI passed or skipped. Leo merged the approved revision after actionable threads were resolved. The merged proposal's failed pullfrog job is recorded rather than represented as passing.

## 2. Instructions API layer

Branch `project-discovery/instructions-api` has parent `project-discovery/proposal`. It owns literal instruction persistence and the owner API. Estimated authored churn is 700 to 1100 lines. Generated migration metadata, OpenAPI, and client output are separate. This layer references #1329 without closing it.

- [x] 2.1 Add nullable instructions through a generated additive migration. Preserve enabled and forced owner RLS. Prove existing Projects receive null and cross-owner direct SQL changes fail.
- [x] 2.2 Extend PATCH and explicit Project responses with save, replace, omission, clear, length-before-whitespace normalization, and archive semantics from `projects`. Prove focused API integration cases, including missing identity, non-BMP bounds, and both whitespace boundary scenarios.
- [x] 2.3 Regenerate OpenAPI and the web client through the existing commands. Prove OpenAPI lint and a clean second generation of owned outputs.
- [x] 2.4 Update API/operator documentation and the dated changelog for the shipped contract. Remove only completed roadmap entries. Run affected API lint, typecheck, focused tests, build, Markdown lint, formatting, and diff checks.
- [x] 2.5 Publish draft and complete layer SR before ready. Complete GR, current-head CI, and delivery Project updates before the next layer.

## 3. Project locator layer

Branch `project-discovery/locator` has parent `project-discovery/instructions-api`. It owns owner-scoped Project discovery and registered location disclosure. Estimated authored churn is 1300 to 1900 lines. It references #333 and #1489 without closing either. It ships before the context producer advertises Project locators.

- [x] 3.1 Add one pure Project resource parser shared by native dispatch and permission projection. Prove UUID identity, root alias, case normalization, invalid forms, selector-free rejects, and read-only mutation refusal.
- [x] 3.2 Render active and archived metadata listings and current Project details through tenant-scoped repositories. Include only linked owner repositories and owner checkouts. Prove foreign/missing equivalence and an absent identity's failure.
- [x] 3.3 Render registered local paths and Machine locators with kind, parent, and executor identity. Label them unverified. Prove no filesystem, git, or Machine contact, no implicit entry, and no effect on later admission.
- [x] 3.4 Reuse native Markdown text selection, raw/outline representations, line counts, output bounds, and progressing continuation notices. Contain every authored or registered field without forged headings or entries. Prove all entries and maximum-length escaped values remain reachable.
- [x] 3.5 Expose native scheme acceptance to generic prompt imports and tool descriptions. Prove one admitted import, data-only framing, no imported instruction activation, and no filesystem trigger from printed checkout locations.
- [x] 3.6 Update locator and read reference pages, their indexes, permission examples, privacy documentation, and the dated changelog. Remove only completed roadmap work. Record the narrow registered-location disclosure exception without exposing private configuration.
- [ ] 3.7 Run focused tool, projection, prompt-import, and integration checks plus affected API lint, typecheck, build, Markdown lint, formatting, and diff checks. Publish draft and complete SR before ready, then GR, current-head CI, and delivery Project updates.

## 4. Project context layer

Branch `project-discovery/context` has parent `project-discovery/locator`. It owns automatic Project guidance and durable execution-time selection. Estimated authored churn is 1700 to 2400 lines. The atomic dispatch and recovery invariant stays together even above the review target. This layer references #1329 and #333 without closing either.

- [ ] 4.1 Add a versioned write-once `run.project_bound` event in the existing event store. Resolve live affiliation before first dispatch and commit selection atomically with the attempt fence, context, and request record. Prove rollback freezes nothing and unchanged guidance still gets a recoverable selection.
- [ ] 4.2 Add the packaged Project snapshot template and producer rank. Render identity, description, literal instructions, locator, additive scope labels, and bounded authority without repository inventories or navigation rules. Prove neutralization and unchanged tool authority.
- [ ] 4.3 Derive told state from own text-bearing items in reconstructed active-epoch context. Include surviving in-Run items and exclude replaced reply items. Prove no duplicate, no told-state column, explicit move/clear/unfile supersession, and no reminder for never-filed Chats.
- [ ] 4.4 Restore the Run selection across attempts, segments, quota wake, and compaction. Exclude Project snapshots from summaries and re-establish guidance for the first post-checkpoint request. Prove live edits, unfiling, and deletion cannot change a bound selection. Prove a new null selection retires guidance that a summary can retain.
- [ ] 4.5 Cover Continue, Regenerate, steer, interrupt, owner forks, shared forks, and Project deletion. Prove new Runs resolve current context and old private history stays literal without public/share/export/search disclosure.
- [ ] 4.6 Integrate private selection-event handling and exact Project context inspection without changing system-only receipts. Prove [no assistant output from selection events](specs/project-context/spec.md#scenario-a-selection-event-produces-no-assistant-output) and [private payload exclusion](specs/project-context/spec.md#scenario-selection-payload-stays-outside-public-projections-and-receipts). Prove malformed recovery failure and negative cross-owner reads.
- [ ] 4.7 Document the worker revision boundary, provider sharing, historical retention, and additive guidance. Prove the cutover inventory includes parked dispatched Runs and blocks until settlement or an explicit operator decision. Update affected architecture/reference/operator pages, the dated changelog, and completed roadmap entries.
- [ ] 4.8 Run focused worker/serializer/integration checks, affected API lint and typecheck, the workspace build, Markdown lint, formatting, and diff checks. Publish draft and complete SR before ready, then GR and current-head CI before the next layer.

## 5. Real Project editor layer

Branch `project-discovery/editor` has parent `project-discovery/context`. It owns the working instruction editor and removal of fake Context files. Estimated authored churn is 600 to 1000 lines. This layer closes #1329 because persistence, editing, and automatic guidance now work together. It references #333 without closing that epic.

- [ ] 5.1 Replace the Instructions toggle with real query/mutation state, save, clear, server error handling, and retained unsaved drafts. Prove save and clear survive reload, and archived Projects remain read-only.
- [ ] 5.2 Remove the Context demo, sample files, and orphaned imports. Replace obsolete demo-interaction story assertions with observable editor behavior. Keep #1330 outside this layer.
- [ ] 5.3 Run Storybook consumer tests and previews and record preview URLs. Prove a focused product E2E that saves instructions, reloads, starts a Project Chat, and observes the model request's applied guidance.
- [ ] 5.4 Update affected owner-facing documentation, the dated changelog, and completed roadmap entries. Run affected web lint, typecheck, build, Markdown lint, formatting, and diff checks.
- [ ] 5.5 Publish draft with `Closes #1329`. Complete SR before ready, then GR, current-head CI, and delivery Project updates before the next layer. Keep #333 open for its remaining outcomes.

## 6. Finalize layer

Branch `project-discovery/finalize` has parent `project-discovery/editor`. It owns canonical spec synchronization, task records, and archive movement only. Estimated authored churn is 1000 to 1600 lines, with no generated output. It closes no feature issue.

- [ ] 6.1 Confirm all implementation layers are published, verified, and checked, including their GR gates. Reconcile all earlier task records against evidence. Prove no task remains incomplete before archive readiness.
- [ ] 6.2 Enter `project-discovery/finalize` through `$gh-stack` before `$openspec-sync-specs` writes any canonical specification. Synchronize approved deltas and verify all modified canonical requirements preserve their scenarios. Repair inbound ADR source links as part of archive movement.
- [ ] 6.3 Prove strict canonical and all-change validation, Markdown lint, formatting, and diff checks. Inspect `openspec status` and complete spec-sync and archive-readiness records before `$openspec-archive-change` moves the change.

Finalize SR and GR are post-archive gates, not unchecked prerequisites of archive execution. After readiness and archive movement, publish finalize as draft. Review its actual parent-relative diff, complete SR, mark ready only with current-head CI, and run GR/monitoring. Update delivery Project fields at each GitHub transition. Merge only with explicit permission and through `$gh-stack`.
