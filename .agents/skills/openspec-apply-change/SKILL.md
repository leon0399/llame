---
name: openspec-apply-change
description: Use when implementing or resuming an OpenSpec change's tasks.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires OpenSpec 1.13.1
metadata:
  upstream: https://github.com/Fission-AI/OpenSpec
  upstreamVersion: "1.13.1"
---

Implement the tasks an OpenSpec change has authorized, verify each one, and check it off.

**Root and store.** Before any write, run `openspec list --json` and read `root`: a root object means OpenSpec is set up here; `"root": null` means it is not, and a write would create the root as a side effect. When the user names a store, or the work lives in one, run `openspec store list --json` and pass `--store <id>` on every command that reads or writes specs and changes; keep it selected for the rest of the workflow, and use the paths the CLI returns instead of cwd guesses. A `status` error naming `openspec/config.yaml` as a declared store this machine cannot resolve is not an uninitialized project — stop before writing and show its `message` and `fix`. With no root: if this workflow was auto-selected, answer the request normally without OpenSpec; if the user asked for OpenSpec explicitly, stop and ask whether to `openspec init`, target a store, or continue without OpenSpec. Never initialize or hand-create a root as a side effect.

**Input**: an optional change name. Infer it from the conversation; auto-select when exactly one active change exists; otherwise prompt with the choices from `openspec list --json`. Announce the selected change and how to override it.

## Steps

1. **Resolve the change.** Run `openspec status --change "<name>" --json` and read `schemaName`, `planningHome`, `changeRoot`, `actionContext`, and which artifact carries the tasks. Then run `openspec instructions apply --change "<name>" --json` and read `state`, `instruction`, `contextFiles`, `progress`, `tasks`, and any `context`, `operationGuidance`, or `missingArtifacts`.

2. **Follow the CLI state.**

   - `blocked`: show `instruction` and do not implement. With `missingArtifacts`, complete them: take the next `ready` artifact from `status` (not `skipped` or `blocked`) and fetch `openspec instructions "<artifact-id>" --change "<name>" --json` for its rules and template. Without them, do what `instruction` says to create or repair the tracking file. Never assume a different artifact is ready.
   - `all_done`: every task is checked; say so and point to the archive workflow.
   - Otherwise: implement.

3. **Consume `context` and `operationGuidance`.** `context` is required project input — apply the facts, conventions, and constraints it names. `operationGuidance` is advisory — consider every entry and follow the applicable ones. Neither replaces `state`, `instruction`, `tasks`, `progress`, or `contextFiles`, neither proves a task done, and neither unlocks a `blocked` state. If either conflicts with the built-in instruction, an explicit user choice, or a CLI-returned value, report the conflict and keep the controlling value; explain any entry you don't follow. Never copy their text into code or artifacts.

4. **Read every `contextFiles` path** from disk before editing, and re-read anything that may have changed since. Don't assume file names the CLI didn't list.

5. **Implement each pending task**: make the change, verify the behavior the task names, then immediately flip its `- [ ]` to `- [x]` in the task file. Check a box only when the specified behavior is fully implemented — never for partial or deferred work. Keep changes inside the change's scope, and keep the tasks file's checked history intact.

   Failures the change caused are part of the work: repair them and rerun the focused check that covers the change without asking for approval at each step; the repo's policy, via `context`, owns any broader sweep. Escalate only for a real decision or a blocker that cannot be repaired within the authorization:

   - a task is ambiguous in a way that changes scope, behavior, or acceptance;
   - the work needs behavior beyond the spec and tasks — surface the added scope; never silently drop, narrow, defer, or special-case specified behavior;
   - implementation invalidates approved scope — name the artifact to revise; re-approval is the user's decision;
   - the repo's policy (via `context` or `operationGuidance`) gates the next step on approval, publication, review, or merge that has not been granted;
   - a blocker outside the change that the authorization does not cover — an unprovisioned environment, a missing credential, or an unrelated pre-existing failure that stops the focused check — report it with the evidence that reproduces it, leave the affected task unchecked, and stop; never record a guessed success or a partial checkoff;
   - the user interrupts.

6. **Report** at a pause or at completion: change and schema, tasks completed this session, `N/M` progress, what remains, and the exact blocker or decision when paused. When every task is checked, say the change is ready for the archive workflow.

## Contracts

- Checkbox state records progress in the authorized layer, not approval: a fully checked change is never permission to cross the repo's policy gates.
- The workflow is complete when every assigned task is implemented, verified, and checked, or a real decision is escalated with what remains and why.
