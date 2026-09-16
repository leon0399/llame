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
reader option, the deletion of link resolution and containment, the
`realSkillDirectory` envelope field, tests, and docs. Listing owns the link
rendering in the shared directory renderer, the `realPath` read field, the
listing tests, the read tool description, and the changelog; its PR
closes #868. Finalize owns canonical spec sync and archive. Implementation branches
require approval of the reviewed proposal; publication and merging require
separate authority.

- [ ] 1.1 Link this change to #868 and record the D1 trust decision in the proposal; verify no configuration key is introduced.
- [ ] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [ ] 1.3 Before implementation, inspect the current stack/base and reconcile any landed change to `skill-catalog.ts`, `skill-target.ts`, `native-files.ts`, `packages/native-file-tools/src/read.ts`, or `directory-listing.ts` since the proposal was written.

## 2. Policy layer

- [ ] 2.1 In `packages/native-file-tools/src/read.ts`, add `followSymlinks?: boolean` (default `false`) to `NativeReadOptions`; thread it into `resolveResolvedTarget` (accept a link leaf and decide file-versus-directory from the followed `stat`), `streamFileWindow`, and `readFailure`/`missingFileMessage` so a miss under a linked parent still yields sibling suggestions; rewrite the docstring that says a symbolic link is always refused; verify `read.test.ts` passes unmodified, a new test reads a linked `SKILL.md` and lists a linked directory through the option, and the existing `kb://` link-refusal tests in `apps/api/src/knowledge/` and `apps/api/src/tools/native-files.test.ts` pass unmodified because `kb://` never sets the option.
- [ ] 2.2 In `apps/api/src/skills/skill-catalog.ts`, make `fileKind` report a link's followed target kind (`directory` through a link-to-directory) while keeping its `lstat` branch for dangling detection; reduce `resolvePackageDirectory` to "resolves to a directory holding `SKILL.md`, else unavailable naming the unresolved link or the non-directory target"; delete `escapesPackage`, `isInside`, the `realPath` port, and the source-root `realpath`; verify `skill-catalog.test.ts` with these edits: "refuses a child symlink resolving outside every configured source" becomes "admits a child symlink resolving outside every configured source" asserting availability and the link path; "admits a child symlink whose real target is inside a configured source" asserts the link path; "follows a configured source root symlink to its real directory" becomes "publishes a configured source root symlink as given"; "refuses a SKILL.md symlink that resolves outside its package directory" and "refuses a sidecar symlink that resolves outside its package directory" become admission tests; a new test asserts a child link to a regular file is an unavailable entry naming the target kind; every other test, including the dangling `SKILL.md` and sidecar tests, passes unmodified.
- [ ] 2.3 In `apps/api/src/skills/skill-target.ts`, delete `containIntoPackage`, `nearestExistingAncestor`, and `isInside`; the host path is the discovered package directory joined with the validated resource segments, and `resolveSkillLocator` resolves `realSkillDirectory` with one `realpath` and returns it; update the comments that describe real paths and refused links; verify `skill-target.test.ts` with these edits: "refuses a resource symlink resolving outside the package" becomes "follows a resource symlink resolving outside the package"; "resolves a resource symlink that stays inside the package" asserts the link path; "refuses a missing leaf beneath an escaping intermediate symlink" keeps the missing-leaf `not_found` and asserts the present file under the link reads; "reads a package whose configured source root is a symlink" asserts the link path; the traversal-validation tests pass unmodified.
- [ ] 2.4 In `apps/api/src/skills/skill-results.ts` and `apps/api/src/tools/native-files.ts`, add `realSkillDirectory` to `skillResultEnvelope` when it differs from `skillDirectory` so the existing reserve covers it, and pass `followSymlinks: true` from `executeSkill`; verify `native-files.test.ts` with these edits: "refuses an escaping resource symlink without opening it" becomes a successful outside read; "never lists an outside directory through an escaping symlink" becomes a test that a miss under a linked directory lists that directory's siblings; the skill envelope cases and "refuses encoded traversal and special files" pass unmodified; a new test reads `skill://<name>` and `skill://<name>/<resource>` for a package linked outside every source and asserts link-path `skillDirectory`/`resolvedPath` and `realSkillDirectory`.
- [ ] 2.5 Update `docs/skills.md` (sources may link to packages anywhere on the host; links are followed without verification; the operator is trusted for them; published paths are the configured link paths, with `realSkillDirectory` beside them) and `docs/native-files.md:117-121` (drop the containment sentences); verify `pnpm lint:markdown` passes.
- [ ] 2.6 Verify with the affected workspace lint, typecheck, and the focused skill, read, and native-files test files, strict OpenSpec validation, formatting, and diff checks; confirm the only `realpath` under `apps/api/src/skills` is the one that fills `realSkillDirectory`. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 3. Listing layer

- [ ] 3.1 In `packages/native-file-tools/src/directory-listing.ts`, extend `DirectoryPort` with the metadata, `realpath`, and `readlink` operations and update the three fake ports in `directory-listing.test.ts`; give `DirEntry` a target kind and target beside its own kind; render `- name@/ -> <target>`, `- name@ -> <target>`, or `- name@? -> <raw link text>`; keep `compareEntries` and `readChildDirs` keyed on the entry's own kind; resolve link metadata only for entries that will be rendered; add a `kb://` carve-out that renders bare `- name@`; verify every existing listing test passes unmodified except those asserting the old `@` line shape, which are updated, and the determinism and bound tests pass.
- [ ] 3.2 Add listing tests for a link to a directory (rendered `@/ -> target`, not descended), a link to a file, a dangling link (raw link text), a multi-hop link resolving to the final target, a link to a special entry, and a `kb://` listing containing a link (bare `- name@`, read still `not_found`); verify none opens the link.
- [ ] 3.3 In `packages/native-file-tools/src/source-lines.ts` and `path.ts`, add `realPath?: string` to `ReadSuccessBase`, thread it through `ReadTarget`, and set it in both `emptyReadResult` and `emptyMultiReadResult` before any line is measured, only for absolute host-path reads whose canonical path differs; verify a read through a linked directory carries it with header and numbering unchanged, a multi-range read carries it, an ordinary read does not, `kb://` and `skill://` reads do not, and a read near the result cap through a link truncates one line earlier than through the canonical path.
- [ ] 3.4 Update `apps/api/src/prompts/tools/read.md` (listing line shapes for links, `realPath`) and `docs/native-files.md:155-157`; add the `CHANGELOG.md` entry; verify `pnpm lint:markdown` and the packaged-description tests pass.
- [ ] 3.5 Verify with the affected workspace lint, typecheck, and the focused listing, read, and native-files test files, strict OpenSpec validation, formatting, and diff checks. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 4. Finalize layer

- [ ] 4.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for `agent-skills` and `native-file-tools`; verify the modified requirements replace their canonical blocks, the added real-path requirement is present, and unrelated scenarios are preserved; then rename the canonical scenario "Escaping link fails" to "Special-file resource link fails" directly in `openspec/specs/native-file-tools/spec.md`, and run strict spec/all validation.
- [ ] 4.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 4.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.
