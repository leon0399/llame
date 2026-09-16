## 1. Proposal prerequisites

Delivery uses `$gh-stack` and, after proposal approval,
`$openspec-apply-change`. The intended stack is:

```text
master
  <- follow-skill-source-symlinks/proposal
  <- follow-skill-source-symlinks/policy
  <- follow-skill-source-symlinks/finalize
```

The proposal layer owns only these OpenSpec artifacts. Policy owns the
deletion of link resolution and containment, the reader switch, tests, docs,
and changelog; its PR closes #868. Finalize owns canonical spec sync and
archive. Implementation branches require approval of the reviewed proposal;
publication and merging require separate authority.

- [ ] 1.1 Link this change to #868 and record the D1 trust decision in the proposal; verify no configuration key is introduced.
- [ ] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [ ] 1.3 Before implementation, inspect the current stack/base and reconcile any landed change to `skill-catalog.ts`, `skill-target.ts`, or `native-files.ts` since the proposal was written.

## 2. Policy layer

- [ ] 2.1 In `apps/api/src/skills/skill-catalog.ts`, reduce `resolvePackageDirectory` to "resolves to a directory holding `SKILL.md`, else unavailable with the unresolved-link diagnostic when the child is a link"; delete `escapesPackage`, `isInside`, the `realPath` port, and the source-root `realpath`; verify `skill-catalog.test.ts` with the three escaping-link refusals inverted to admission tests, "follows a configured source root symlink to its real directory" retargeted to the link path, and every other test unmodified.
- [ ] 2.2 In `apps/api/src/skills/skill-target.ts`, delete `containIntoPackage`, `nearestExistingAncestor`, and `isInside`; the host path is the discovered package directory joined with the validated resource segments; verify `skill-target.test.ts` with "refuses a resource symlink resolving outside the package" inverted, "reads a package whose configured source root is a symlink" retargeted to the link path, and the missing-leaf `not_found` with sibling suggestions still produced by the reader.
- [ ] 2.3 In `apps/api/src/tools/native-files.ts` `executeSkill`, read through the link-following reader with the same `displayPath`, envelope reserve, and selector handling; verify `native-files.test.ts` skill cases pass unmodified and a `SKILL.md` that is itself a link reads successfully.
- [ ] 2.4 Add one test that a package linked from a source to a directory outside every source is discovered, available, and readable through `skill://<name>` and `skill://<name>/<resource>` with `skillDirectory` and `resolvedPath` equal to the link paths; verify a dangling child link is still an unavailable entry with its diagnostic.
- [ ] 2.5 Update `docs/skills.md` (sources may link to packages anywhere on the host; links are followed without verification; the operator is trusted for them; published paths are the configured link paths) and add the `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes.
- [ ] 2.6 Verify with the affected workspace lint, typecheck, and the focused skill and native-files test files, strict OpenSpec validation, formatting, and diff checks; confirm no `realpath` call remains under `apps/api/src/skills`. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 3. Finalize layer

- [ ] 3.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for `agent-skills` and `native-file-tools`; verify the modified requirements replace their canonical blocks, the "Escaping link fails" scenario now covers only special files, and unrelated scenarios are preserved, then run strict spec/all validation.
- [ ] 3.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 3.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.
