Track [#154](https://github.com/leon0399/llame/issues/154) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#806](https://github.com/leon0399/llame/issues/806) and [#170](https://github.com/leon0399/llame/issues/170) are separate work, not native blockers of this change.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Carry forward approval of the actual proposal revision (v6) and recheck native blockers before creating the implementation branch. Publication and merge each require separate permission.

```text
(master) <- complete-owner-forks/proposal
         <- complete-owner-forks/implementation
         <- complete-owner-forks/finalize
```

The proposal layer owns only proposal, design, delta specs, schema metadata, and this task list. `implementation` owns the complete owner-copy behavior; its merge satisfies the acceptance and its PR uses `Closes #154`. `finalize` owns only spec sync, checked task records, and archive movement. The superseded v4 stack (#816, #817, #828) is closed, not merged.

After each layer's verification, commit its owned changes and checked tasks, publish only with permission using `gh stack submit --auto`, inspect its actual base/diff, self-review, and follow the ready-PR monitoring rules before adding the next layer. Record shipping changes in that layer's dated changelog entry. Do not put live delivery status in this file.

## 1. `complete-owner-forks/implementation`: complete owner forks

- [x] 1.1 In `ChatsService.forkChat`, read the source Chat, its messages, and its compactions under `REPEATABLE READ`; copy messages with `createdAt` and `usage` and dense sequences; copy every compaction within the prefix with new IDs and remapped `parentId`; insert the fork Chat with the source's `createdAt` and both frozen baseline triples, markers remapped through the compaction ID map or null. Extend `ChatsRepository.create`, `MessagesRepository.createMany`, and `CompactionsRepository.create` inputs as needed; leave `forkSharedChat` text-only. Remove the "usage is deliberately not copied" comments in `forkChat` and `forkSharedChat` (design D1-D3, D5).
- [x] 1.2 Add the three cases from design V1-V3 to `fork-chat.integration.test.ts` and update its existing compacted-source case; confirm in the running app that a copied checkpoint renders in the fork.
- [x] 1.3 Run API `lint`, `typecheck`, `test:coverage`, `test:integration`, and `build`; confirm `pnpm db:generate` reports no schema change and OpenAPI is unchanged. Update the `SPEC.md` continuity section and the dated `CHANGELOG.md`; remove only the completed #154 roadmap item. Verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and strict change validation before using `Closes #154`.

## 2. `complete-owner-forks/finalize`: spec sync and archive

- [x] 2.1 After the implementation layer is published, verified, self-reviewed, and checked, create only the finalize layer with `$gh-stack` and run `$openspec-sync-specs`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; this layer contains no application fix or feature shipping record.
- [x] 2.2 Inspect `pnpm exec openspec status --change complete-owner-forks --json` and this task list; stop if an artifact or prior task is incomplete. Complete this final task as part of running `$openspec-archive-change`, preserve all checked history, and verify strict specs/all validation, Markdown lint, formatting, and `git diff --check` on the archived result. The feature issue remains closed by `implementation`, not by this layer.
