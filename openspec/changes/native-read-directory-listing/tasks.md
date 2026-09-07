## Delivery stack

Use `$gh-stack` and `$openspec-apply-change` after proposal approval. The
connected delivery order is:

```text
master
  <- native-read-directory-listing/proposal
  <- native-read-directory-listing/listing
  <- native-read-directory-listing/finalize
```

`listing` owns the reader walk, rendering, bounds, tool description, and docs.
`finalize` owns spec sync, task records, and archive. #704 is closed by the
`listing` layer. No task changes `edit`, `write`, the mutation fence, filtering,
metadata, ordering selectors, or symlink following.

## 1. listing

- [ ] 1.1 Add a directory walker in `packages/native-file-tools` behind an injected `{ lstat, opendir }` port; verify with tests that it reads two levels, counts grandchildren without rendering them, lists symbolic links with `@` and never descends them, and returns `(empty directory)` for an empty root.
- [ ] 1.2 Implement ordering and rendering: directories first, `localeCompare` names, absolute-path header, two-space indent, `- name/` / `- name` / `- name@`; verify byte-identical output across two reads of an unchanged fixture and a directories-before-files ordering test.
- [ ] 1.3 Implement bounds: child cap of 20 with `… N more`, depth-2 elision last-first with an elided-count line when over the common result cap, then whole-line truncation with `nextOffset` for an oversized requested level; verify each stage with fixtures that trigger exactly one stage.
- [ ] 1.4 Route directory targets through `read`: range selectors slice requested-level listing lines without context, `:raw` fails with `invalid_selector`, `edit` and `write` on a directory still return `not_regular_file`; verify with reader and mutate tests.
- [ ] 1.5 Update the `read` tool description and `docs/native-files.md` to describe directory listings and bounds; verify `pnpm lint:markdown` and `pnpm format:check` pass.
- [ ] 1.6 Run `packages/native-file-tools` and `apps/api` lint, typecheck, and focused tests; verify the API tool-runner test that asserts a directory read fails is updated to assert the listing.

## 2. finalize

- [ ] 2.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `--all --strict`; verify both pass.
- [ ] 2.2 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes.
- [ ] 2.3 Confirm every task above is checked, then run `$openspec-archive-change`; verify `openspec status --change native-read-directory-listing --json` reports complete before archiving.
