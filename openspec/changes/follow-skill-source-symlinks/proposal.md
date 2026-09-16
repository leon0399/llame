## Why

The skill catalog refuses a package that is a symbolic link unless its real directory lies under one of the configured sources, and contains every link inside a package to that package's real directory. An operator whose skills directory is a set of links into a dotfiles checkout or another tool's skill store gets 8 of 41 packages. oh-my-pi, Codex CLI, OpenCode, and Claude Code all follow package symlinks from an operator-configured root wherever they point; oh-my-pi additionally never resolves real paths and publishes the link path it discovered. llame is the outlier, and the outlier costs three containment algorithms and a `realpath` port. Separately, a directory listing marks a link with `@` but never says where it leads, so a model without shell access cannot learn a link's target at all; the `ls -l` answer costs one `realpath` per link. This proposal owns issue #868 and absorbs the useful part of #714, which closes.

## What Changes

- Skill discovery and `skill://` reads apply ordinary operating-system link semantics and perform no symbolic-link resolution, verification, or containment. A configured source is trusted by being configured.
- A symlinked immediate child of a source is a package when it resolves to a directory holding `SKILL.md`, wherever that directory lies. Links inside a package are followed wherever they point, including a `SKILL.md` that is itself a link. A child link that cannot be resolved or is not a directory stays an unavailable entry with a diagnostic.
- Published `skillDirectory` and `resolvedPath` are the paths as discovered beneath the configured source (the link path), not resolved real paths. A source root that is itself a link publishes its link path too.
- The "resource symlink SHALL resolve only within the selected real package" rule, the root-union containment, and the `realPath` catalog port are removed; the "Escaping link fails" scenario narrows to the retained special-file refusal.
- Directory listings render a link as `- name@/ -> <canonical target>` for a directory target, `- name@ -> <canonical target>` for a file target, and `- name@? -> <raw link text>` when dangling or special; links are still never descended. Same renderer on host paths, `kb://`, and `skill://`. The bullet shape stays; no `tree` glyphs.
- A host-path file `read` whose canonical path differs from the path given carries `realPath` in its details; content and header are unchanged. A `skill://` result carries the real package directory in its details beside the link-path `skillDirectory`.
- Unchanged: `kb://` refuses every link; host `edit` and replace-mode `write` follow through a link, create-mode `write` refuses an existing link, replace on a dangling link is `not_found`; `bash` cwd is operating-system semantics. Nothing else about skills, `kb://` (which keeps refusing every link), `bash`, or directory listings changes.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-skills`: sources may contain package symlinks resolving anywhere; discovery and reads follow operating-system semantics with no containment; dangling child links are unavailable entries; published paths are the discovered link paths.
- `native-file-tools`: the skill-locator requirement drops resource containment and escaping-link refusal, keeps the special-file refusal, and publishes discovered rather than real paths; the directory-listing requirement renders each link's target kind and canonical target; a new requirement reports `realPath` in read details when a host path is reached through a link.

## Impact

- `apps/api/src/skills/skill-catalog.ts`: `resolvePackageDirectory` keeps only "is it a directory with a `SKILL.md`" plus the unresolved-link diagnostic; `escapesPackage`, `isInside`, and the `realPath` port are deleted; `fileKind` no longer branches on links beyond following them.
- `apps/api/src/skills/skill-target.ts`: `containIntoPackage`, `nearestExistingAncestor`, and `isInside` are deleted; the resolved host path is the discovered package path joined with the validated resource segments.
- `apps/api/src/tools/native-files.ts` `executeSkill`: reads through the link-following reader `packages/native-file-tools` already uses for host paths, keeping the skill result envelope and reserve.
- Tests: `skill-catalog.test.ts` "refuses a child symlink resolving outside every configured source", "refuses a SKILL.md symlink that resolves outside its package directory", "refuses a sidecar symlink that resolves outside its package directory", and `skill-target.test.ts` "refuses a resource symlink resolving outside the package" invert to admission tests; "follows a configured source root symlink to its real directory" and "reads a package whose configured source root is a symlink" change their expected path to the link path; dangling-link tests pass unmodified; every Knowledge symlink test is untouched.
- `packages/native-file-tools/src/directory-listing.ts` (`classifyEntry`, `formatEntry`) gains the target-kind and target rendering; `packages/native-file-tools/src/read.ts` adds `realPath` to host-read details; `apps/api/src/tools/native-files.ts` adds the real directory to the skill result envelope details. Listing tests for `@` entries update to the new line shape; every other listing test is unchanged.
- Docs: `docs/skills.md` states that sources may link to packages anywhere on the host, that links are followed without verification, and that the operator is trusted for them; `CHANGELOG.md` entry.
- Out of scope: per-source link configuration (Agent Plugins, #784, may introduce a contained source class); deduplication by real path; following links inside a listing (#714 closes as not planned; if #738 recursive listing ever descends, a global canonical-path visited set as Codex uses is the guard); `tree`-style glyphs.
