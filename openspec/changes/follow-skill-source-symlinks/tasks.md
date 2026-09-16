## 1. Proposal prerequisites

Delivery uses `$gh-stack` and, after proposal approval,
`$openspec-apply-change`. The intended stack is:

```text
master
  <- follow-skill-source-symlinks/proposal
  <- follow-skill-source-symlinks/policy
  <- follow-skill-source-symlinks/listing
  <- follow-skill-source-symlinks/finalize
```

The proposal layer owns only these OpenSpec artifacts. Policy owns the
deletion of link resolution and containment, the reader switch, tests, docs,
and changelog. Listing owns the link rendering in the shared directory
renderer, the `realPath` read detail, and the skill envelope real directory;
its PR closes #868. Finalize owns canonical spec sync and archive. Implementation branches require approval of the reviewed proposal;
publication and merging require separate authority.

- [ ] 1.1 Link this change to #868 and record the D1 trust decision in the proposal; verify no configuration key is introduced.
- [ ] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [ ] 1.3 Before implementation, inspect the current stack/base and reconcile any landed change to `skill-catalog.ts`, `skill-target.ts`, or `native-files.ts` since the proposal was written.

## 2. Policy layer

- [ ] 2.1 In `apps/api/src/skills/skill-catalog.ts`, reduce `resolvePackageDirectory` to "resolves to a directory holding `SKILL.md`, else unavailable with the unresolved-link diagnostic when the child is a link"; delete `escapesPackage`, `isInside`, the `realPath` port, and the source-root `realpath`; verify `skill-catalog.test.ts` with the three escaping-link refusals inverted to admission tests, "follows a configured source root symlink to its real directory" retargeted to the link path, and every other test unmodified.
- [ ] 2.2 In `apps/api/src/skills/skill-target.ts`, delete `containIntoPackage`, `nearestExistingAncestor`, and `isInside`; the host path is the discovered package directory joined with the validated resource segments; verify `skill-target.test.ts` with "refuses a resource symlink resolving outside the package" inverted, "reads a package whose configured source root is a symlink" retargeted to the link path, and the missing-leaf `not_found` with sibling suggestions still produced by the reader.
- [ ] 2.3 In `apps/api/src/tools/native-files.ts` `executeSkill`, read through the link-following reader with the same `displayPath`, envelope reserve, and selector handling; verify `native-files.test.ts` skill cases pass unmodified and a `SKILL.md` that is itself a link reads successfully.
- [ ] 2.4 Add one test that a package linked from a source to a directory outside every source is discovered, available, and readable through `skill://<name>` and `skill://<name>/<resource>` with `skillDirectory` and `resolvedPath` equal to the link paths; verify a dangling child link is still an unavailable entry with its diagnostic.
- [ ] 2.5 Update `docs/skills.md` (sources may link to packages anywhere on the host; links are followed without verification; the operator is trusted for them; published paths are the configured link paths); verify `pnpm lint:markdown` passes.
- [ ] 2.6 Verify with the affected workspace lint, typecheck, and the focused skill and native-files test files, strict OpenSpec validation, formatting, and diff checks; confirm the only `realpath` under `apps/api/src/skills` is the display-only one that fills the real-directory result field (D7), and none participates in resolution or containment. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 3. Listing layer

- [ ] 3.1 In `packages/native-file-tools/src/directory-listing.ts`, classify a link by its target kind with one metadata read and one `realpath`, render `- name@/ -> <target>`, `- name@ -> <target>`, or `- name@? -> <raw link text>`, never descending; verify the listing tests that cover `@` entries are updated to the new line shape and every other listing test passes unmodified, including determinism and bound tests.
- [ ] 3.2 Add listing tests for a link to a directory, a link to a file, a dangling link, a multi-hop link (link to link to directory) resolving to the final target, and a link to a special entry; verify each renders as specified and none is opened.
- [ ] 3.3 In `packages/native-file-tools/src/read.ts`, add `realPath` to host file read details when the canonical path differs from the path given and omit it otherwise; verify content, header, and line numbering are unchanged by reading through a linked directory, and that `kb://` reads carry no `realPath`.
- [ ] 3.4 In `apps/api/src/tools/native-files.ts`, add the real package directory to the `skill://` result details beside the link-path `skillDirectory`; verify `native-files.test.ts` skill cases pass with the added detail and the envelope reserve still accounts for it.
- [ ] 3.5 Verify with the affected workspace lint, typecheck, and the focused listing, read, and native-files test files, strict OpenSpec validation, formatting, and diff checks; add the `CHANGELOG.md` entry. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 4. Finalize layer

- [ ] 4.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for `agent-skills` and `native-file-tools`; verify the modified requirements replace their canonical blocks, the "Escaping link fails" scenario now covers only special files, the listing requirement carries the link rendering, the added real-path requirement is present, and unrelated scenarios are preserved, then run strict spec/all validation.
- [ ] 4.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 4.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.
