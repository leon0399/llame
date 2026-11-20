# Project discovery and instructions

## Why

A Project groups Chats and links repositories, but its purpose and instructions never reach the agent. The agent cannot discover registered checkout locations through the Project before it chooses a Workspace for a task.

## What Changes

- Add literal, owner-authored Project instructions with save and clear operations. Replace the Instructions demo and remove the fake Context-files panel.
- Supply current Project identity, description, instructions, and a detail locator through a `project` context snapshot. Do not include repository inventories automatically.
- Resolve Project context during execution preparation, not message admission. After first dispatch, preserve that selection throughout the Run, recovery, and compaction.
- Derive reminder told state from the producer's own items in reconstructed context. Add no per-producer told-state columns.
- Add read-only `projects://` discovery. List active Projects by default and archived Projects through an explicit listing. Individual reads expose metadata, instructions, linked repositories, and registered checkout locators with executor identities.
- Label checkout locations as unverified. Do not probe executors, enter a Workspace, select a worktree, or add navigation instructions through discovery.
- Keep automatic Project context independent of `read` availability. Explicit reads remain subject to owner isolation and the existing permission policy.
- Keep Project guidance additive with personalization. Neither source replaces the other or changes tool authority.

## Capabilities

### New Capabilities

- `project-context`: execution-bound Project guidance, transcript-derived told state, supersession, recovery, and compaction.
- `project-discovery`: owner-scoped Project locators, listings, detail documents, and registered checkout disclosure.

### Modified Capabilities

- `projects`: literal instructions in Project storage, owner APIs, and the real editing experience.
- `context-injection`: author-time placement of the bundled `project` producer.
- `personalization`: Project instructions and personalization share the authored-guidance level without a relative override hierarchy.
- `native-file-tools`: acceptance of the read-only `projects://` scheme through native `read`.
- `tool-call-permissions`: canonical Project resource matching without filesystem probes or authority over returned checkout locations.

## Impact

The API adds one nullable instructions field and regenerates its OpenAPI document and web client. The worker adds Project context preparation and transcript-based recovery. Native `read`, permission projection, prompt imports, packaged descriptions, and reference documentation learn the scheme through their existing acceptance mechanism.

This change deliberately exposes owner-registered checkout locations to the model through admitted Project detail reads. It does not expose daemon configuration, SSH credentials, prompt source paths, or Knowledge bindings. Automatic reminders and Project listings contain no checkout paths.

The proposal branch is `project-discovery/proposal`, initialized through `gh stack` before artifact creation. This PR contains planning artifacts and two proposed ADRs only. Implementation waits for approval of the published revision.

## Intent and evidence

- [Per-Project instructions, #1329](https://github.com/leon0399/llame/issues/1329) owns the instructions outcome. The implementation layer that supplies working editing and automatic guidance closes it.
- [Projects inside Chats, #333](https://github.com/leon0399/llame/issues/333) owns broader awareness. This change completes discovery and current-Project context only, not the whole epic.
- [Runtime-plugin reminder state decision](https://github.com/leon0399/llame/issues/1489#issuecomment-6715360525) requires transcript-derived told state, without producer columns.
- [Bundled-producer clarification](https://github.com/leon0399/llame/issues/1489#issuecomment-6721190466) retains spec authority for bundled producers.
- [Default Workspace proposal, #1429](https://github.com/leon0399/llame/issues/1429) can change Project defaults later. Discovery must not interpret today's defaults as instructions to enter a location.
- The owner confirmed the behavior after a design grilling on 2026-11-20. The final clarification leaves Workspace navigation unspecified and keeps the operator policy as the approval boundary.
- Current code stores Project metadata and real repository links. `apps/web/app/(chat)/projects/[id]/project-side-panel.tsx` contains the local-state Instructions and Context demos.

## Acceptance

1. An owner saves, replaces, and clears literal Project instructions. Another owner cannot read or change them. Archived Projects reject instruction edits.
2. A queued Run uses the Project state current at execution preparation. After dispatch, edits and filing changes cannot change that Run's applied guidance.
3. Reminder comparison uses reconstructed transcript items. Unchanged state emits no duplicate snapshot within an epoch. Compaction restores the applicable state for its first subsequent request.
4. `projects://` supports bounded active and archived discovery. Detail reads expose actionable registered checkout locators without executor contact or implicit entry.
5. Explicit reads obey `read` policy. Automatic current-Project guidance still works without the `read` tool.
6. Project instructions remain additive with personalization. Project metadata and another Project's instructions remain reference data in tool observations.
7. Public shares, shared forks, exports, and search do not gain private Project context. Historical private context is not erased by a Project edit or deletion.

## Non-goals

No autonomous filing, Project creation tool, recall ranking, context-file storage, instruction imports, live checkout inspection, new navigation policy, or runtime-plugin framework. No replacement of existing repository defaults or Workspace entry semantics.

## Assumptions and open decisions

The capability remains owner-only. Duplicate Project names remain valid, so locators use UUIDs. Technical defaults and failure boundaries appear in the design and delta specs. No product decision remains open from the grilling.
