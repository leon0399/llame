## Why

The skill catalog refuses a package that is a symbolic link unless its real directory lies under one of the configured sources. An operator whose skills directory is a set of links into a dotfiles checkout or another tool's skill store gets 8 of 41 packages. Every reference harness (oh-my-pi, Codex CLI, OpenCode, Claude Code) follows package symlinks from an operator-configured root wherever they point and reserves containment for third-party plugin roots; llame applies the plugin rule to every root. This proposal owns issue #868.

## What Changes

- A symbolic link that is an immediate child of a configured skill source resolves to its real directory, and that directory need not lie under any configured source. A configured source is trusted by being configured.
- Unchanged: a dangling or non-directory package link is an unavailable entry with a diagnostic; `SKILL.md`, sidecars, and `skill://<name>/<path>` resources stay contained to the resolved real package; the published `skillDirectory` is the real path; later sources still override earlier ones by name; `kb://` keeps refusing every symbolic link.
- The package-symlink rule moves from the `native-file-tools` skill-locator requirement to `agent-skills`, which owns discovery; the resource-containment rule stays in `native-file-tools`.
- One real-path containment helper replaces the duplicated `isInside` copies and the three skill containment algorithms, and the Knowledge Space late check adopts it. Behavior otherwise unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-skills`: configured sources may contain package symlinks resolving anywhere on the host; discovery resolves them to their real directory; dangling links are unavailable entries; package-internal containment is unchanged.
- `native-file-tools`: the skill-locator requirement no longer constrains where a package symlink resolves; it keeps resource containment to the selected real package and the refusal of escaping links and special files.

## Impact

- `apps/api/src/skills/skill-catalog.ts`: `resolvePackageDirectory` drops the root-union check and keeps the dangling/non-directory diagnostics; `escapesPackage` and `skill-target.ts` `containIntoPackage` call one shared helper.
- `apps/api/src/skills/skill-target.ts`, `apps/api/src/knowledge/knowledge-filesystem.ts`: adopt the helper (`isInsideSpace`), no behavior change.
- New helper module beside the existing path helpers in `packages/native-file-tools` (the package already owns `path.ts` and the `O_NOFOLLOW` policy), exporting a real-path-inside-root check and the nearest-existing-ancestor walk `skill-target.ts` already implements.
- Tests: `skill-catalog.test.ts` "refuses a child symlink resolving outside every configured source" inverts into "admits a child symlink resolving outside every configured source"; "admits a child symlink whose real target is inside a configured source", the dangling and escaping-resource scenarios, and every Knowledge symlink test pass unmodified.
- Docs: `docs/` skill operator guidance states that sources may link to packages anywhere on the host and that the operator is trusted for those links; `CHANGELOG.md` entry.
- Out of scope: per-source `followSymlinks` configuration (Agent Plugins, #784, will get the contained rule); deduplication by real path across differently named entries; `kb://`, `bash` cwd, and directory-listing traversal (#714).
