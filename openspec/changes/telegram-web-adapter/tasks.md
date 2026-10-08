Track [#940](https://github.com/leon0399/llame/issues/940) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the implementation layer, after proposal approval only.

```text
master
  <- telegram-web-adapter/proposal
  <- telegram-web-adapter/adapter
  <- telegram-web-adapter/finalize
```

| Layer                           | Parent     | Ownership                                                                    | Authored estimate | Closes |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------- | ----------------- | ------ |
| `telegram-web-adapter/proposal` | `master`   | The approved proposal, design, deltas, and this task list.                   | ~850              | none   |
| `telegram-web-adapter/adapter`  | `proposal` | The `telegram` adapter, its config plumbing, tests, prompt clause, and docs. | ~1,800            | #940   |
| `telegram-web-adapter/finalize` | `adapter`  | Spec sync and archive movement only.                                         | ~300              | none   |

The adapter layer is atomic: claim, requests, failure mapping, and both
renders ship together. It enables the user-visible feature, so it carries the
reference and operator docs and the changelog entry. Test fixtures are HTML
reduced to the elements the parser reads, not verbatim recordings, to keep the
layer inside the review budget.

## 0. proposal

- [x] 0.1 Run two adversarial review rounds with two independent reviewers each; verify findings against code, specs, and live Telegram responses; commit each round separately.
- [x] 0.2 Prove the final revision: `pnpm exec openspec validate telegram-web-adapter --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script diff of each MODIFIED block against its canonical requirement showing only the Telegram additions and every canonical scenario kept; record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. adapter

- [x] 1.1 Add `use: "telegram"` as a fieldless adapter in `llame-config.ts`, `llame.config.schema.json`, the `contract.ts` switch, and `llame.config.jsonc.example`; verify `contract.test.ts` and the `config-loader.test.ts` adapter-kind ordering case include it, and an entry with an extra field fails boot.
- [x] 1.2 Implement the claim grammar and request derivation in `adapters/telegram/adapter.ts` (design D1, D2); verify unit tests for every claimed, declined (`address`, no request), and unclaimed shape in the claims requirement, including the alias hosts, a port, the `/c/` path, `?q=`, both cursors, a repeated cursor, `before=0`, a selector-suffixed cursor, dropped query keys, a trailing slash, `http`, and a leading-zero id.
- [x] 1.3 Implement failure mapping (design D4); verify tests for the widget error element and a widget service message (`empty`), a preview `finalUrl` off `/s/{name}` and a post or preview whose final URL left `https://t.me` (`status`), a widget 200 without a message or error element, a preview 200 without the channel header, and a preview 200 with the header but neither a post element nor the "No posts found" placeholder (`parse`), and a shared-client failure, each falling through with no response body; separately verify that a page whose only post is a service message renders the header with no entries.
- [x] 1.4 Implement the message renderer in `adapters/telegram/render.ts` (design D5) against reduced widget and preview HTML fixtures; verify tests for a channel post with views and standard, custom, and paid reactions, bare emoji in the text, a hashtag `?q=` anchor rendered as plain text, a forwarded reply, a public-group sender heading, an album, every media note kind in D5 including audio told apart from a document by its icon class, a visible unsupported-media block, a supported post and a sticker post whose hidden fallback blocks render nothing, a link-preview card, a signature, and the edited marker, with no `telesco.pe` URL in any render.
- [x] 1.5 Implement the channel page (design D3, D6); verify tests for newest-first `i/n` numbering, a skipped `.service_message` with text, `---` separators, the header `URL:` with a cursor, cursor lines directly under the header, an `Older:`-only head page, a page with both cursors, and an empty page with the "No posts found" placeholder and empty-value links rendering no entry and no cursor line.
- [x] 1.6 Run a throwaway live smoke check through `createWebAdapters` against `t.me/durov/400`, `t.me/durov`, its `Older:` URL, a public-group post, `t.me/BotFather`, and `t.me/c/1/1`; record the observed outputs in the PR body and delete the script.
- [x] 1.7 Document the adapter in `docs/product/operator/web-adapters.md` (table row and section), `docs/product/reference/web-adapters.md` (Thread adapters entry, channel page shape, and that cursor pages take no selector), `docs/development/harness-comparison/read.md`, the hand-edited adapter clause in `apps/api/src/prompts/tools/read.md`, and a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [x] 1.8 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/tools/web-read src/instance-config`, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.9 Self-review the parent-relative diff against REVIEW_GUIDE.md and this change's specs before marking the PR ready; fix accepted findings with new commits and rerun affected checks.
- [ ] 1.10 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #940` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `telegram-web-adapter/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the synced `native-file-tools` and `instance-config` text matches the deltas word for word, with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change telegram-web-adapter --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
