## Context

See proposal.md for motivation. The state that shapes the approach:

- `apps/api/src/skills/skill-catalog.ts` `resolvePackageDirectory` (312-336): a non-link child is a package if it is a directory; a link is `realPath`-resolved, refused when the real path is outside every configured root, then checked to be a directory. `escapesPackage` (414-429) contains `SKILL.md` and sidecar links to the package's real directory. `apps/api/src/skills/skill-target.ts` `containIntoPackage` (167-212) contains `skill://<name>/<path>` reads to the package's real directory with a nearest-existing-ancestor walk so a missing leaf still yields the reader's own `not_found`. `isInside` is copy-pasted verbatim in both files (472, 216).
- `apps/api/src/knowledge/knowledge-filesystem.ts` `isInsideSpace` (326-343) is a third real-path-inside-root check; the Knowledge host-path walk (`knowledge-filesystem-host-path.ts`) refuses every symbolic-link component by design and is not a containment check.
- `packages/native-file-tools/src/path.ts` owns the generic open policy (`O_NOFOLLOW` for resolved targets, follow for absolute host paths) and is imported by both `apps/api/src/skills` and `apps/api/src/knowledge`.
- Discovery is one level deep, so no traversal cycle can arise from following a package link; a self-referential link fails `realpath` with `ELOOP` and becomes an unavailable entry.
- Reference behavior (revisions in #868): oh-my-pi's `.agents/skills` scan admits symlinked directories with no containment and reserves real-path containment for Agent Plugins; Codex follows for user, repo, and admin roots and contains only plugin `DirectChildren`; Claude Code documents cross-disk skill symlinks; the Agent Skills spec is silent.

## Goals / Non-Goals

**Goals:**

- A configured source's package links resolve wherever they point; everything inside a package stays inside it.
- One containment implementation across skills and Knowledge.

**Non-Goals:**

- Per-source symlink configuration. Agent Plugins (#784) will introduce the second trust class and the contained rule with it.
- Deduplication of two differently named entries that resolve to one real directory.
- Any change to `kb://` link refusal, `bash` cwd resolution, or directory-listing traversal (#714).
- Cycle detection beyond what `realpath` already reports; discovery does not recurse.

## Decisions

**D1 Trust is a property of the source.** A configured source is trusted by being configured, so a link an operator places in it is the operator's choice and resolves anywhere on the host. Alternative: keep root-union containment and document listing the real roots as sources. Rejected: every reference harness follows for operator roots, and the workaround makes the operator enumerate targets the filesystem already names. The one instance shape where this widens reach, `skill://` allowlisted without host `read`, is accepted because only the operator can place the links.

**D2 The package boundary stays.** `SKILL.md`, sidecars, and resources still resolve only within the package's real directory. This is what gives `skill://<name>/<path>` a stable meaning and what keeps a package from reaching beyond itself; it costs nothing for ordinary packages, which have no internal links. Alternative: follow everything. Rejected: the reference harnesses that follow package links (oh-my-pi Agent Plugins, Codex plugins) still contain resources where they contain anything.

**D3 `agent-skills` owns the discovery rule.** The sentence moves out of the `native-file-tools` skill-locator requirement, which keeps only resource containment. The read tool should not own how packages are found.

**D4 One helper in `packages/native-file-tools`.** `realpathWithin(root, candidate)` and the nearest-existing-ancestor walk live beside `path.ts`, which already owns link policy and is imported by both consumers. `skill-catalog.ts`, `skill-target.ts`, and `knowledge-filesystem.ts` call it; the two `isInside` copies are deleted. Behavior is unchanged, proven by the existing skill and Knowledge symlink tests passing unmodified. Alternative: a helper in `packages/runtime-safety`. Rejected: that package has no filesystem concern today and would gain one for a two-function module.

**D5 Published paths are real paths.** `skillDirectory` and `resolvedPath` are the real directory and file, as they already are for links inside a source, and as oh-my-pi publishes them. A dotfiles path therefore becomes model-visible; it already is for any admitted link, and the skill result envelope is the documented exception to host-path privacy.

## Risks / Trade-offs

- [A source pointed at a third-party checkout could link to arbitrary host files] → Sources are operator-configured only; the same operator can allowlist host `read`. Documented under D1 and in the operator guidance. Agent Plugins will carry their own contained rule.
- [Inverting the refusal test hides a regression in package-internal containment] → The escaping `SKILL.md`, sidecar, and resource tests are separate and stay unmodified.
- [The helper extraction changes a boundary check subtly] → Existing tests in `skill-catalog.test.ts`, `skill-target.test.ts`, and the Knowledge filesystem suites pin every boundary case and pass unmodified; the extraction PR includes no behavior change.

## Migration Plan

Two layers, one PR each:

1. Policy: `resolvePackageDirectory` drops the root-union check; test inverted; spec deltas; docs and changelog.
2. Consolidation: helper extracted, three call sites migrated, duplicates deleted; no behavior change.

No data or configuration migration. An operator who added real roots as a workaround may remove them; nothing breaks if they stay.

## Open Questions

None that change the specs, approach, or task breakdown.
