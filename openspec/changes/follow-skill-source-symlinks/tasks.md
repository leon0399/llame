## 1. Proposal prerequisites

Delivery uses `$gh-stack` and, after proposal approval,
`$openspec-apply-change`. The intended stack is:

```text
master
  <- follow-skill-source-symlinks/proposal
  <- follow-skill-source-symlinks/policy
  <- follow-skill-source-symlinks/containment
  <- follow-skill-source-symlinks/finalize
```

The proposal layer owns only these OpenSpec artifacts. Policy owns the
discovery rule change, its tests, docs, and changelog; its PR closes #868.
Containment owns the shared real-path helper and the migration of its three
call sites with no behavior change. Finalize owns canonical spec sync and
archive. Implementation branches require approval of the reviewed proposal;
publication and merging require separate authority.

- [ ] 1.1 Link this change to #868 and record the D1 trust decision in the proposal; verify no configuration key is introduced.
- [ ] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [ ] 1.3 Before implementation, inspect the current stack/base and reconcile any landed change to `skill-catalog.ts`, `skill-target.ts`, or the Knowledge filesystem since the proposal was written.

## 2. Policy layer

- [ ] 2.1 In `apps/api/src/skills/skill-catalog.ts` `resolvePackageDirectory`, remove the configured-root containment branch and keep the unresolved-link and non-directory diagnostics; verify `skill-catalog.test.ts` with "refuses a child symlink resolving outside every configured source" inverted to an admission test asserting availability and `skillDirectory` equal to the real directory, and every other test in the file unmodified.
- [ ] 2.2 Add a `skill-target.test.ts` case reading `skill://<name>` and `skill://<name>/<resource>` for a package linked from a source to a directory outside every source; verify both succeed with real `resolvedPath` and `skillDirectory`, and the existing escaping-resource and dangling tests pass unmodified.
- [ ] 2.3 Update `docs/skills.md`: sources may contain links to packages anywhere on the host, the operator is trusted for those links, package-internal links stay contained; add the `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes.
- [ ] 2.4 Verify with the affected workspace lint, typecheck, and the focused skill test files, strict OpenSpec validation, formatting, and diff checks. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 3. Containment layer

- [ ] 3.1 Add a helper module beside `packages/native-file-tools/src/path.ts` exporting a real-path-inside-root check and the nearest-existing-ancestor walk currently in `skill-target.ts`; verify with unit tests for inside, outside, equal-to-root, missing leaf under an existing ancestor, and `ELOOP`.
- [ ] 3.2 Migrate `skill-catalog.ts` (`escapesPackage`) and `skill-target.ts` (`containIntoPackage`) to the helper and delete both `isInside` copies; verify `skill-catalog.test.ts` and `skill-target.test.ts` pass unmodified.
- [ ] 3.3 Migrate `apps/api/src/knowledge/knowledge-filesystem.ts` `isInsideSpace` to the helper; verify the Knowledge filesystem, host-path, and binding test files pass unmodified and `knowledge_search` still refuses symbolic-link entries.
- [ ] 3.4 Verify with the affected workspace lint, typecheck, and focused tests; confirm no other real-path containment implementation remains under `apps/api/src` and record the sweep in the PR body.

## 4. Finalize layer

- [ ] 4.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for `agent-skills` and `native-file-tools`; verify the modified requirements replace their canonical blocks and unrelated scenarios are preserved, then run strict spec/all validation.
- [ ] 4.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 4.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.
