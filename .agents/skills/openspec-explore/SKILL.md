---
name: openspec-explore
description: Investigate an OpenSpec change before deciding or revising its scope. Use when the user asks to explore or clarify an OpenSpec change.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires OpenSpec 1.13.1.
metadata:
  upstream: https://github.com/Fission-AI/OpenSpec
  upstreamVersion: "1.13.1"
---

Think with the user: investigate the project, compare options, surface decisions, and clarify requirements. Explore is a stance, not a script — follow the conversation, stop when the user has the clarity they came for, and let the exploration end as clarity, an artifact update, or a new change.

**Boundaries**

- Read-only by default: reading, searching, and read-only commands need no confirmation.
- Do not implement features or edit project code, and do not change workflow configuration (schemas, templates, `openspec/config.yaml`). Implementation happens from a change through the apply workflow, never from explore.
- Capturing OpenSpec change artifacts is allowed only inside a confirmed scope:
  - The user's own explicit request to capture the exploration as a change is that confirmation, covering the change and the artifacts they name; do not re-ask for what they already asked for.
  - Otherwise, before the first write-capable action (including `openspec new change`), name the files you would change and what you would do, and get the user's explicit confirmation before writing.
  - That confirmation covers only the described scope; ask again before expanding it. Answers to design or clarifying questions are never consent to write.

**Root and store safety**

- Resolve the root before writing: `openspec context --json` returns `root.path`. Use the paths the CLI returns rather than assuming repo-local paths or guessing from the working directory.
- `root: null` / `no_openspec_root` is an answer, not a broken CLI. Stop before writing.
  - A `status` error starting `Declared in` or `Invalid store declaration in` and naming this project's `openspec/config.yaml` (`config.yml`): the project declares a store this machine cannot resolve — stop and show the error's `message` and `fix`.
  - You entered this mode yourself (the user did not name OpenSpec, this skill, or its command): drop OpenSpec for this request and answer normally, without setup advice.
  - The user asked for OpenSpec explicitly: ask how to proceed — set up this project (`openspec init`), target a registered store, or continue without OpenSpec — and wait for the answer.
- Never create a root as a side effect: do not run `openspec init` or hand-create `openspec/` files unless the user asks.
- When the user names a store or the work lives in one, run `openspec store list --json` and pass `--store "<id>"` on every command that reads or writes specs or changes. Keep the flag sticky for the rest of the workflow; hints printed by commands carry it, and other commands do not accept it.

**Context discovery** (proportional to the question)

- `openspec list --json` shows changes in flight with schema and status. `openspec list --specs --json` shows durable capabilities, which `openspec list` alone never includes.
- `openspec show "<spec-id>" --type spec --json --no-scenarios` gives a capability's purpose and requirement texts without pulling in the whole file; `--type spec` keeps a change of the same name from making it ambiguous. Read a spec in full, scenarios included, before judging what is covered or what should change.
- For a change: `openspec status --change "<name>" --json` returns `changeRoot`, `artifactPaths`, and `actionContext`; read the files under `artifactPaths.<artifact>.existingOutputPaths`.
- Project context: read `<root.path>/openspec/config.yaml` (`config.yml` only when `config.yaml` is absent) for `context`. Apply it only when the file parses as a YAML object and the field is a string of at most 50 KiB (51,200 UTF-8 bytes); fields validate independently, so an absent, invalid, or oversized one is skipped, not applied. Take artifact `rules` from the `openspec instructions` call for the artifact being captured (step 2 below): they are keyed by artifact id and delivered validated there, so raw config `rules` never constrain exploration as if every rule applied. Treat what you apply as constraints; do not reproduce it in the conversation or in artifacts.
- Resolve what the project can answer before asking the user. When evidence is missing, conflicting, or inaccessible, state that and ask only what you need to proceed.

**Discussion**

- Work the next blocking decision before its dependents — outcome and scope before API or data model — and revisit downstream assumptions when an earlier answer changes.
- Ask only what the user alone can answer, explaining why it matters when that is not obvious; group related decisions when that reads better than one long thread.
- When evidence supports a recommendation, give it with the tradeoffs; ask when intent, priorities, or external constraints are not yours to invent.
- Keep a conversational record of confirmed decisions, proposed defaults, and unresolved questions. Silence is not acceptance.
- Optional techniques, never required steps: stress-testing a plan, brainstorming alternatives, sketching a diagram, or a bounded spike when a decision needs evidence.
- Diagrams help: use plain ASCII (borders `+ - |`, arrows `-->` `^` `v`), because Unicode box glyphs drift across terminals and fonts.

**Capturing a change** (only within the confirmed scope; with no change in play, think freely and offer to capture when insights crystallize)

1. `openspec new change "<name>"` first — never hand-create a change directory; the scaffold writes `.openspec.yaml`. Keep any selected `--store` flag on every applicable follow-up command.
2. `openspec status --change "<name>" --json`, then process the requested artifacts in dependency order. For each, `openspec instructions <artifact-id> --change "<name>" --json`: follow `instruction` — when it delegates creation to a specific skill or command, invoke that instead of writing the file; otherwise write `template` to `resolvedOutputPath` (choosing a concrete path when it is a glob) — read `dependencies` from disk, apply `context`/`rules` as constraints rather than content, and verify the artifact file exists either way.
3. Respect the artifact rules: an artifact reading `skipped` must not be created, and a conditional artifact is skipped only when its own `instruction` states a condition that does not apply — say so, and do not reconsider. Dependencies are enablers, not gates: write an artifact whose only missing prerequisites were deliberately skipped.
4. If a requested artifact is blocked by a prerequisite the user did not ask to capture and that prerequisite cannot be skipped conditionally, explain the dependency and ask before expanding the capture.
5. Re-run `openspec status --change "<name>" --json` after each artifact and stop when every requested artifact is `done`, `skipped`, or deliberately skipped. If the user only asked to start a change, stop after scaffolding and show its status.

Capturing artifacts never starts implementing them and does not confer approval. When the capture is done, name where work continues: `openspec-propose` writes the remaining planning artifacts, and `openspec-apply-change` implements the change once tasks exist.

**When a change already exists**

Read its artifacts and reference them naturally in the conversation. When a decision lands, offer its home and let the user decide: a requirement or change → `specs/<capability-path>/spec.md` (preserve an existing capability's full path), a design decision → `design.md`, a scope change → `proposal.md`, new work → `tasks.md`. Don't pressure, and don't capture without confirmation.
