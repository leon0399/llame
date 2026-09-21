---
name: openspec-archive-change
description: Use when finalizing a completed OpenSpec change into the archive.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires OpenSpec 1.13.1
metadata:
  upstream: https://github.com/Fission-AI/OpenSpec
  upstreamVersion: "1.13.1"
---

Move a completed change into the archive without losing checked history or shipping unsynced specs.

**Root and store.** Before any write, run `openspec list --json` and read `root`: a root object means OpenSpec is set up here; `"root": null` means it is not, and a write would create the root as a side effect. When the user names a store, or the work lives in one, run `openspec store list --json` and pass `--store <id>` on every command that reads or writes specs and changes; keep it selected for the rest of the workflow, and use the paths the CLI returns instead of cwd guesses. A `status` error naming `openspec/config.yaml` as a declared store this machine cannot resolve is not an uninitialized project — stop before writing and show its `message` and `fix`. With no root: if this workflow was auto-selected, answer the request normally without OpenSpec; if the user asked for OpenSpec explicitly, stop and ask whether to `openspec init`, target a store, or continue without OpenSpec. Never initialize or hand-create a root as a side effect.

**Input**: an optional change name. Infer it from the conversation; auto-select when exactly one active change exists; otherwise prompt with the active changes from `openspec list --json`, showing each schema when known. Announce the selected change and how to override it.

`<capability-path>` is a spec directory relative to `specs/` (for example `user-auth` or `identity/user-auth`); keep each delta's full path when resolving its main spec.

## Steps

1. **Load archive inputs first.** Once the planning root is known, run `openspec instructions archive --change "<name>" --json` with the same selected-root flags. `context` is required project input and `operationGuidance` is advisory; both are optional fields of a successful response — their absence is not an error, a failed lookup is. If the command exits non-zero or returns invalid JSON, report it, repair the invocation (name, flags, store selection) and retry; if it still fails, stop before any write or move rather than archiving without the policy these inputs carry. Apply what fits, report conflicts and keep the controlling value (built-in steps, explicit user choices, resolved paths, CLI checks), and never infer skipped prompts, replacement paths, or flags from either. Never copy their text into specs, artifacts, or summaries.

2. **Check artifacts and tasks before moving anything.**

   - `openspec status --change "<name>" --json` → `schemaName`, `planningHome`, `changeRoot`, `artifactPaths`, `actionContext`, and `artifacts`, the completion state. Every artifact must be `done` or `skipped`; a change that declares `skip_specs` satisfies the requirement with `skipped`.
   - Read the tasks file (typically `tasks.md`). A checkbox is complete only when its content is exactly `x` or `X` — spacing inside the brackets may vary, so `- [ x]` counts. Every other marker is incomplete: `- [ ]`, `- []`, and markers OpenSpec assigns no meaning to such as `- [~]` or `- [-]`. With no tasks file, proceed without a task warning.
   - If either check finds incomplete work, stop and report exactly what is missing: this repo's policy — CONTRIBUTING.md and the injected archive guidance — does not archive incomplete artifacts or unchecked tasks, so there is no confirmation override to offer.

3. **Assess delta-spec sync state.** Use `artifactPaths.specs.existingOutputPaths` as the only delta-spec source; when the entry is missing or empty, treat the sync as complete and proceed to step 5, and do not infer deltas from other artifacts.

   Compare every delta with its main spec at `<planningHome.root>/openspec/specs/<capability-path>/spec.md` — the store-aware root from status, never a hardcoded repo path — and classify each capability as already synced, needing sync, or sync-blocked. A missing main spec is not automatically "already synced": when a delta meets the missing-spec, REMOVED-only, or `retire_capabilities` case, consult `../openspec-sync-specs/references/spec-merge.md` at that point — it is the canonical rule for those cases here and in the sync itself. Deltas that only add or modify requirements need no reference read. Report all capabilities together, including a blocked one among otherwise syncable ones.

   Then carry out the archive the user already requested — do not re-ask for steps that request covers:

   - sync-blocked: explain the blocker; sync is impossible and unsynced archive is not permitted here, so stop after naming what blocks it. Never start a sync while a capability is sync-blocked.
   - changes needed: proceed to step 4; the sync is mandatory here, so there is no separate sync confirmation to ask for.
   - already synced: proceed to step 5 without re-running a sync that would change nothing.

   Stop and ask only when the authorization for the archive itself is genuinely missing (for example the workflow was auto-selected without an archive request) or the intended change or archive target is ambiguous; honor an explicit cancellation or a policy block at any point.

4. **Sync, then verify before moving.** When the classification calls for a sync:

   - Fetch `openspec instructions specs --change "<name>" --json` once with the selected-root flags, handling a failed lookup as in step 1: report it, correct the invocation and retry, and if it still fails, stop before any main-spec write — never treat it as an absent rule set. Pass a valid snapshot to the sync run, which reuses it instead of re-fetching.
   - Run the `openspec-sync-specs` workflow inline for this change and wait for it to finish. Never run it in the background or delegate it asynchronously: step 5 moves `changeRoot` while a detached sync would still be reading it, leaving the change archived and the main specs stale. If your harness can only delegate, delegate synchronously and wait.
   - Re-verify every capability that has a delta, not only the ones the sync reported: ADDED requirements present; MODIFIED requirements carrying the delta's description and scenario changes with their other scenarios intact; REMOVED requirements gone, with a retired capability's `spec.md` deleted and a spec the sync deliberately kept and reported counting as a match; RENAMED requirements present under the new name and absent under the old one.
   - If the sync failed or any capability still differs, repair the cause and re-run the sync — nothing has moved and `changeRoot` is intact; if the difference persists, or a guard or policy blocker explains it, report the difference and stop without moving the change.

5. **Move the change with the native CLI.** Nothing has moved until this point and nothing may move unless the precondition holds: step 2 found every artifact and task complete, and steps 3–4 left every delta verified in sync (or none existed). Run the installed CLI with the selected-root flags (`--store <id>` when a store is selected):

   ```bash
   openspec archive "<name>" --skip-specs --yes --json
   ```

   - `--skip-specs` prevents a second, redundant spec merge from being performed programmatically on top of the synchronization steps 3–4 already carried out and verified. It is never a way to bypass synchronization: a capability step 3 classed as needing sync must have completed step 4 first, and a sync-blocked capability stopped the workflow before this command.
   - `--yes` only consumes the archive authorization step 3 confirmed was already given. It grants nothing, and it neither supplies a missing archive request nor substitutes for project policy the CLI does not enforce.
   - Require a successful exit whose JSON reports `archive.path`; that is the archive location step 6 reports. On a collision the CLI exits non-zero with an `archive_target_exists` status and moves nothing — report that error and suggest renaming the existing archive instead. Never overwrite or merge, and never fall back to a hand-run `mv`.
   - The CLI moves the change directory whole, so `.openspec.yaml` and the checked task history travel with it; never rewrite tasks to make the archive look complete. Let the CLI derive the dated archive name — never construct that path or its date by hand.

6. **Report and hand off.** State the change, schema, final archive location, and whether specs were synced (a sync this run counts only when step 4's verification passed; on the already-synced path, report them as already in sync).

   Readiness gated the movement; the movement now gates whatever policy stages follow. When the repo's policy defines post-archive gates — publishing the finalize layer as a draft, self-reviewing the actual diff before ready, the GitHub review/CI loop, and merge authorization — complete them in that order. Archive completion is not approval and never authorizes publication or merge by itself.

## Contracts

- Artifact-rule text is never copied into specs, artifacts, or summaries.
