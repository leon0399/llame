## 1. Delivery and approval

Exact delivery stack: `master <- system-provided-skills/proposal <- system-provided-skills/catalog <- system-provided-skills/activation <- system-provided-skills/finalize`.

The proposal layer owns planning artifacts. The catalog layer owns configuration, discovery, read-only package resolution, and the inspection API. The activation layer owns explicit selection, prompt baselines, reminders, and durable Run integration. The finalize layer owns canonical documentation sync, archive, and issue closure.

- [ ] 1.1 Obtain approval of the final proposal revision before implementation; verify the approval references that revision. Use `$gh-stack` and `$openspec-apply-change` for every implementation layer and create only the next approved layer.
- [ ] 1.2 Before catalog implementation, inspect #763's delivered admission interface and coordinate the skill locator projection without changing its permission decisions; verify explicit and proactive reads have a documented common admission path.

## 2. Catalog layer

- [ ] 2.1 Add `skills.directories` schema/default/path resolution and operator setup documentation; verify empty defaults, explicit home expansion, relative resolution, rejection of secret interpolation before resolution, bounds, and restart behavior with config tests.
- [ ] 2.2 Implement bounded immediate-child discovery, ordered overrides, format/control validation, and diagnostics; verify malformed winners never reveal a lower-precedence body and unreadable sources cannot produce a partial winning map.
- [ ] 2.3 Add live `skill://` catalog/package/resource reads and read-only dispatch, with model-visible absolute file/package paths; verify root versus trailing-slash forms, range/raw/listing limits, symlink containment, encoded traversal, and special-file refusal.
- [ ] 2.4 Integrate read eligibility and existing permission checks without enabling host execution or mutation; verify skills-only configuration admits no absolute-path host authority and denied locators never open a file.
- [ ] 2.5 Add authenticated bounded catalog inspection; verify two owners see the same operator packages, unauthenticated requests fail, and no owner mutation or other-owner data appears.
- [ ] 2.6 Exercise a fixture package with references, relative script instructions, an interpreter script importing a sibling module, and task-relative input; verify real paths reach model output and ordinary Bash executes unchanged text with explicit `cwd`, subject to existing native authority.
- [ ] 2.7 Run focused API checks and relevant repository lint/typecheck/build checks for the catalog layer; record the exact commands and results in its PR without closing #770.

## 3. Activation layer

- [ ] 3.1 Persist owner-scoped per-Run baseline/last-disclosed state and resolve the disclosure epoch before prompt rendering; implement bounded catalog discovery/deltas; verify no prompt re-render on package edits or model switches, next-user-turn re-baselining after ordinary and transition compaction, restart recovery, omitted-entry promotion, and honest overflow handling.
- [ ] 3.2 Parse explicit dollar mentions and load selected skills through common admission before the first model request; verify multi-skill order, deduplication, code/escape exclusions, manual-only behavior, per-selection failure continuation, and partial recovery using stable activation ordinals. Reuse `runTool` and extract its trusted caller context before pre-request activation; verify no independent permission evaluator or synthetic assistant tool record is introduced.
- [ ] 3.3 Add the two context producers with total author-time ordering and final-text persistence; verify the user text is retained under existing delimiter sanitation, receipts include actual output, and recovery after completed activation does not re-read changed files.
- [ ] 3.4 Verify live edit/removal behavior across user turns and within an active Run: new loads see current state, old observations replay unchanged, and unsolicited reminders never appear mid-Run. Include a surviving script after source removal to prove ordinary Bash permissions remain authoritative.
- [ ] 3.5 Verify explicit and proactive skills cannot grant tools, expose server credentials, mutate through skill locators, or access another owner's Knowledge; run meaningful negative isolation tests through the Run boundary.
- [ ] 3.6 Verify model-facing behavior with deterministic model fixtures: only relevant bodies load, multiple skills coexist, references stay lazy, scripts receive valid paths, and owner-visible results retain provenance, published skill paths, and baseline and per-item precedence framing under an operator-replaced prompt. Include reserved-delimiter payloads and envelope-preserving truncation tests. Run applicable API/integration/E2E checks and repository gates; record any environment limitation separately from defects.

## 4. Finalize layer

- [ ] 4.1 Use `$openspec-sync-specs` to synchronize the five capability deltas and update SPEC/operator docs; verify new behavior is documented once in its owning capability and Knowledge path privacy remains unchanged.
- [ ] 4.2 Reconcile #770 with the approved configured-source, live-read, path-publication, and reminder decisions; keep #772 and #782 separate and verify no new native dependency was invented.
- [ ] 4.3 Run strict OpenSpec validation, Markdown lint, format checks, and `git diff --check`; complete required delivery review/CI for the stack with recorded results.
- [ ] 4.4 After implementation verification, use `$openspec-archive-change`; verify every task is complete and the archive is valid. Only this final layer uses `Closes #770`; reconcile project status after its delivery PR is merged.
