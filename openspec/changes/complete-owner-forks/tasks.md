Track [#154](https://github.com/leon0399/llame/issues/154) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#806](https://github.com/leon0399/llame/issues/806) and [#170](https://github.com/leon0399/llame/issues/170) are separate work, not native blockers of this change.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Carry forward approval of the actual proposal revision (v5) and recheck native blockers before creating the implementation branch. Publication and merge each require separate permission.

```text
(master) <- complete-owner-forks/proposal
         <- complete-owner-forks/implementation
         <- complete-owner-forks/finalize
```

The proposal layer owns only proposal, design, delta specs, schema metadata, and this task list. `implementation` owns the complete owner-copy behavior; its merge satisfies the acceptance and its PR uses `Closes #154`. `finalize` owns only spec sync, checked task records, and archive movement. The superseded v4 stack (#816, #817, #828) is closed, not merged.

After each layer's verification, commit its owned changes and checked tasks, publish only with permission using `gh stack submit --auto`, inspect its actual base/diff, self-review, and follow the ready-PR monitoring rules before adding the next layer. Record shipping changes in that layer's dated changelog entry. Do not put live delivery status in this file.

## 1. `complete-owner-forks/implementation`: complete owner forks

- [ ] 1.1 Add nullable `chats.inheritedContextOriginAt` and generate the Drizzle migration; verify `pnpm --filter api db:check` and `pnpm db:generate` report no further change. Resolve the temporal anchor as latest copied compaction, then recorded origin, then creation time (design D4).
- [ ] 1.2 Extend the owner copy in `ChatsService.forkChat` to run under `REPEATABLE READ` and copy messages with original `createdAt` and `usage`, dense sequences, and remapped `inReplyTo`; leave `forkSharedChat` and its allowlist unchanged (design D1, D2, D6). Remove the obsolete "usage is not copied" comment.
- [ ] 1.3 Copy every compaction with `uptoSeq` inside the copied prefix: new IDs, remapped `parentId` and `uptoSeq`, verbatim `summary`, `replacementHistory`, `usage`, and `createdAt`. Fail atomically on a missing parent mapping or malformed replacement history; add no regeneration path (design D2).
- [ ] 1.4 Copy the source's `recencyDigestBaseline`, `recencyDigestTold`, and `recencyDigestRebakedFrom` through `ChatsRepository.setRecencyDigest`, remapping the marker to the copied compaction or null; copy the context origin at Chat creation (design D3, D4).
- [ ] 1.5 Extend `fork-chat.integration.test.ts` under the self-provisioning suite: multi-generation compacted history, a fork during an in-flight Run, an anchor that excludes a later checkpoint, a marker naming an uncopied compaction, fork-of-fork origin, and source deletion. Prove prefix equality through the real context builder and provider serializer against the source at the same boundary, and that a deliberate timestamp reset or checkpoint drop fails the comparison (design V1, V2, V4).
- [ ] 1.6 Negative coverage: foreign source and anchor return not found and commit nothing; shared/public forks, public views, exports, and search projections contain no compaction, digest, usage, timestamp, or origin state; a re-bake marker cannot reference another Chat's compaction (design V3).
- [ ] 1.7 Verify the browser surface: a copied checkpoint renders in the fork, inherited usage and timestamps display, and continuing the fork emits no fork notice (design V5). Run a focused product E2E covering fork and continuation; report environment failures separately.
- [ ] 1.8 Run API `lint`, `typecheck`, `test:coverage`, `test:integration`, and `build`; confirm OpenAPI is unchanged or regenerate it with a clean second generation. Update `SPEC.md` continuity sections and the dated `CHANGELOG.md`; remove only the completed #154 roadmap item. Verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and strict change validation before using `Closes #154`.

## 2. `complete-owner-forks/finalize`: spec sync and archive

- [ ] 2.1 After the implementation layer is published, verified, self-reviewed, and checked, create only the finalize layer with `$gh-stack` and run `$openspec-sync-specs`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; this layer contains no application fix or feature shipping record.
- [ ] 2.2 Inspect `pnpm exec openspec status --change complete-owner-forks --json` and this task list; stop if an artifact or prior task is incomplete. Complete this final task as part of running `$openspec-archive-change`, preserve all checked history, and verify strict specs/all validation, Markdown lint, formatting, and `git diff --check` on the archived result. The feature issue remains closed by `implementation`, not by this layer.
