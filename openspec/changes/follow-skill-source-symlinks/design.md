## Context

See proposal.md for motivation. The state that shapes the approach:

- `apps/api/src/skills/skill-catalog.ts` `resolvePackageDirectory` (312-336): a non-link child is a package if it is a directory; a link is resolved through the `realPath` port, refused when the real path is outside every configured root, then checked to be a directory. `escapesPackage` (414-429) contains `SKILL.md` and sidecar links to the package's real directory. `apps/api/src/skills/skill-target.ts` `containIntoPackage` (167-212) contains `skill://<name>/<path>` reads with a nearest-existing-ancestor walk. `isInside` is duplicated verbatim in both files. Configured source roots are `realpath`-resolved so containment compares real paths on both sides.
- `packages/native-file-tools` exposes two readers: the host-path reader follows links; `readResolvedFile` opens with `O_NOFOLLOW` and refuses a link at the leaf, and is what `kb://` and `skill://` use today (`native-files.ts:150`).
- Discovery is one level deep, so no traversal cycle can arise; a self-referential link fails `stat` with `ELOOP` and becomes an unavailable entry.
- Reference behavior (revisions in #868): oh-my-pi admits symlinked children and publishes `path.join(dir, entry.name, 'SKILL.md')` with no `realpath` (`discovery/helpers.ts:495-502`); Codex follows for user, repo, and admin roots; OpenCode always follows; Claude Code documents cross-disk skill links. None contains resources inside a personal-root package.
- `kb://` refuses every link by design because Spaces are owner-scoped tenancy on a shared root. That is unchanged and unrelated: skills are operator-global.

## Goals / Non-Goals

**Goals:**

- Skills follow operating-system link semantics with no resolution, verification, or containment code.
- Published paths are what discovery walked, so the model and the owner see the same path the operator configured.

**Non-Goals:**

- Per-source link configuration; Agent Plugins (#784) may introduce a contained source class later.
- Deduplication of two differently named entries that resolve to one directory; override-by-name covers the shared-name case.
- Any change to `kb://` link refusal, `bash` cwd resolution, or directory-listing traversal (#714).
- Cycle detection; discovery does not recurse.

## Decisions

**D1 Trust is a property of the source; no link verification.** A configured source is trusted by being configured, so every link reachable from it is the operator's choice. Alternative A: keep root-union containment and document listing real roots as sources. Rejected: every reference harness follows for operator roots. Alternative B: follow package links but keep package-internal containment. Rejected: it keeps all three containment algorithms and the `realpath` port for a boundary no reference harness enforces on a personal root, and the operator who can place a package link can place an internal one. The one instance shape where this widens reach, `skill://` allowlisted without host `read`, is accepted because only the operator can place the links.

**D2 No `realpath` anywhere in skills.** Discovery classifies a child by `stat` (which follows links) and the `SKILL.md` presence check; reads open the discovered path with the link-following reader. Published `skillDirectory` and `resolvedPath` are the discovered paths, as oh-my-pi publishes them and as this harness's own sessions show (`[Skill directory: ~/.agents/skills/<name>]`). Alternative: publish real paths. Rejected: it needs the `realpath` port this change deletes, and it discloses a path the operator did not configure.

**D3 Dangling links stay visible.** A child link whose target is missing or not a directory remains an unavailable entry with a diagnostic, inspectable through `GET /api/v1/skills`. Alternative: skip silently as Codex's plugin mode does. Rejected: the operator placed the link and should see why it is not a skill.

**D4 `agent-skills` owns the rule.** The read tool's skill-locator requirement keeps only what a read does (envelope, selectors, special-file refusal) and defers link semantics to discovery.

**D5 Deletion, not replacement.** No containment helper is introduced; nothing remains to consolidate, and the Knowledge Space check stays the single implementation of its own rule. One implementation layer.

## Risks / Trade-offs

- [A source pointed at a third-party checkout could link to arbitrary host files] → Sources are operator-configured only; the same operator can allowlist host `read`. Documented in `docs/skills.md`. A contained source class can arrive with #784 without reopening this decision.
- [Inverting four refusal tests hides a regression in the dangling-link path] → The dangling `SKILL.md` and sidecar tests stay unmodified and are asserted separately.
- [A `SKILL.md` that is a link was refused at the leaf by `O_NOFOLLOW`] → The `skill://` read moves to the link-following reader; the envelope, reserve, and selector behavior are unchanged and covered by the existing `native-files.test.ts` skill cases.

## Migration Plan

One implementation layer: delete the containment code and the `realPath` port, switch the reader, invert the four refusal tests, retarget the two real-path tests to link paths, update `docs/skills.md` and `CHANGELOG.md`. No data or configuration migration. An operator who added real roots as a workaround may remove them.

## Open Questions

None that change the specs, approach, or task breakdown.
