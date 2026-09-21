---
name: openspec-sync-specs
description: Use when a change's delta specs must reach main specs without archiving the change.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires OpenSpec 1.13.1
metadata:
  upstream: https://github.com/Fission-AI/OpenSpec
  upstreamVersion: "1.13.1"
---

Merge a change's delta specs into the project's main specs. This is agent-driven: you read each delta and edit its main spec, so an intelligent merge preserves what the delta does not mention. The change stays active — syncing is not archiving.

`references/spec-merge.md` is the conditional detail: read it when the canonical delta or main-spec shapes are unfamiliar, or when a selected delta brings a missing main spec, a REMOVED or RENAMED operation, or a possible capability retirement. Read it once per such case and keep it for the rest of the run — never re-read it for each capability while it is unchanged. Routine ADDED and MODIFIED merges against existing specs follow the invariants in step 4.

**Root and store.** Before any write, run `openspec list --json` and read `root`: a root object means OpenSpec is set up here; `"root": null` means it is not, and a write would create the root as a side effect. When the user names a store, or the work lives in one, run `openspec store list --json` and pass `--store <id>` on every command that reads or writes specs and changes; keep it selected for the rest of the workflow, and use the paths the CLI returns instead of cwd guesses. A `status` error naming `openspec/config.yaml` as a declared store this machine cannot resolve is not an uninitialized project — stop before writing and show its `message` and `fix`. With no root: if this workflow was auto-selected, answer the request normally without OpenSpec; if the user asked for OpenSpec explicitly, stop and ask whether to `openspec init`, target a store, or continue without OpenSpec. Never initialize or hand-create a root as a side effect.

`<capability-path>` is a spec directory relative to `specs/` (for example `user-auth` or `identity/user-auth`); keep each delta's full path when resolving its main spec.

**Input**: an optional change name. Infer it from the conversation; auto-select when exactly one active change exists; otherwise prompt with the choices from `openspec list --json`. Announce the selected change and how to override it.

## Steps

1. **Resolve change context.** Run `openspec status --change "<name>" --json`. Main specs live under `<planningHome.root>/openspec/specs/` — use that store-aware root for every main-spec path instead of a hardcoded repo path.

2. **Fix the delta set.** `artifactPaths.specs.existingOutputPaths` is the only source of delta specs. When the `specs` entry is missing or the list is empty, report that there is nothing to sync and stop without requesting artifact instructions or writing a main spec; never infer deltas from other artifacts.

   Sync every listed path unless the caller narrowed the set. A caller narrows it by naming complete entries copied verbatim from that list — archive does this inline, and a user can too, for example by naming the entry ending in `/specs/billing/invoices/spec.md`. Then sync only the named paths, carry the narrowed selection through the whole run, and never widen it back: the withheld deltas belong to a caller that deliberately excluded them. A named path that is not in the list is not synced — report it and stop rather than dropping it silently. An empty named list means there is nothing to sync.

3. **Take one specs-rule snapshot before the first write.** Reuse a valid snapshot a caller supplied (archive fetches it before invoking this workflow inline); otherwise run `openspec instructions specs --change "<name>" --json` once with the same selected-root flags. If it exits non-zero or returns invalid JSON, report it, correct the invocation and retry; if it still fails, stop the run before any main-spec write — never treat the failure as an absent rule set. Omitted `rules` means no artifact rules are configured and the merge below proceeds unchanged. Apply `rules` only to the content and form of the specs this merge writes; they are artifact rules, not operation guidance, and their text is never copied into a spec or summary.

4. **Merge each selected delta** into `<planningHome.root>/openspec/specs/<capability-path>/spec.md`, applying every operation semantically and idempotently: an operation changes only what it names, and every requirement, scenario, and piece of wording the delta does not mention survives in the main spec's existing order. ADDED and MODIFIED are the routine path — ADDED adds a requirement the main spec lacks, and a name already present is updated to match the delta; MODIFIED folds the delta's description and scenario changes into its requirement. An existing spec's `## Purpose` is authoritative — a delta's `## Purpose` only seeds a brand-new spec. Never copy a delta file as-is, never emit delta operation headers, and never write an empty `## Requirements`.

   A missing main spec, a REMOVED or RENAMED operation, or a possible capability retirement follows `references/spec-merge.md` for the operative details: a missing main spec may be created only from ADDED requirements, with the delta's Purpose when it has one, and a capability may be retired — its `spec.md` deleted — only when every guard there holds. When a guard fails, change nothing for that capability, stop it, and report the blocking condition; never write a partial or empty spec to make the merge look complete.

5. **Validate.** Run `openspec validate --specs` with the same selected-root flags. When it fails, repair the merge this workflow owns and re-validate; report problems the merge cannot resolve and do not claim the sync succeeded.

6. **Report.** List the capabilities updated and the operations applied, any new spec left with a TBD Purpose so it gets written, any capability retired with its deleted `spec.md`, its Purpose, and either a pasteable `git checkout` or checkout-scoped recovery guidance, and the fact that the change remains active and unarchived.

## Contracts

- Syncing never approves the change, and never copies rule, context, or delta operation text into a main spec.
