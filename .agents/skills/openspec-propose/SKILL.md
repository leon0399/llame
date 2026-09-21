---
name: openspec-propose
description: Create or complete the planning artifacts for an OpenSpec change. Use when the user asks to propose or plan an OpenSpec change.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires OpenSpec 1.13.1
metadata:
  upstream: https://github.com/Fission-AI/OpenSpec
  upstreamVersion: "1.13.1"
---

Turn a request into an OpenSpec change whose planning artifacts are complete enough to review and, once approved, to implement.

**Done means** every artifact the apply phase transitively requires exists in the change, or is legitimately skipped. Build the whole set in one pass instead of pausing between artifacts for confirmation.

**Boundaries**

- Planning only: creating the change and its artifacts does not authorize implementation. Do not edit project code or start the apply workflow unless the user explicitly authorizes implementation and the project's approval gates are met.
- Artifact completion and `openspec status` readiness are not approval. Branch, approval, publication, and review gates arrive as the project's injected `context`, `rules`, and `operations` guidance — follow it; never infer permission from a finished artifact or bypass a gate.

**Input**: a change name (kebab-case) or a description of what to build; derive the name when only a description is given. Ask only about ambiguity that would materially change scope, observable behavior, compatibility, or acceptance criteria — resolve everything else from the project and record assumptions in the artifacts.

**Root and store safety**

- Resolve the root before writing: `openspec context --json` returns `root.path`. Use the paths the CLI returns rather than assuming repo-local paths or guessing from the working directory.
- `root: null` / `no_openspec_root` is an answer, not a broken CLI. Stop before writing.
  - A `status` error starting `Declared in` or `Invalid store declaration in` and naming this project's `openspec/config.yaml` (`config.yml`): the project declares a store this machine cannot resolve — stop and show the error's `message` and `fix`.
  - You selected this workflow yourself (the user did not name OpenSpec, this skill, or its command): drop OpenSpec for this request and answer normally, without setup advice.
  - The user asked for OpenSpec explicitly: ask how to proceed — set up this project (`openspec init`), target a registered store, or continue without OpenSpec — and wait for the answer.
- Never create a root as a side effect: do not run `openspec init` or hand-create `openspec/` files unless the user asks.
- When the user names a store or the work lives in one, run `openspec store list --json` and pass `--store "<id>"` on every command that reads or writes specs or changes. Keep the flag sticky for the rest of the workflow; hints printed by commands carry it, and other commands do not accept it.

**Flow**

1. **Project context.** Read `<root.path>/openspec/config.yaml` (`config.yml` only when `config.yaml` is absent) for `context`, and take per-artifact `rules` from the `openspec instructions` call that validates and delivers them. Apply `context` only when the file parses as a YAML object and the field is a string of at most 50 KiB (51,200 UTF-8 bytes); fields validate independently, so an absent, invalid, or oversized one is skipped, not fatal. Treat what you apply as constraints — use it to focus inspection and decisions, and never copy it into artifacts.

2. **Schema.** Omit `--schema` to keep the configured default. Add `--schema "<name>"` only when the user explicitly requests a schema by name. If they ask what workflows exist, run `openspec schemas --json` from the resolved root and let them choose.

3. **Create or continue the change.** When the request names an existing change to complete, continue it directly — no scaffolding, no confirmation. Otherwise run `openspec new change "<name>"` (with the chosen `--schema`); never hand-create the change directory: the CLI scaffolds `.openspec.yaml` and resolves the planning home. If a new change's name collides with an existing one, or the intended target is genuinely ambiguous, ask whether to continue the existing change or create a new one.

4. **Build the required set.** `openspec status --change "<name>" --json` returns `applyRequires`, each artifact's `status` and `requires` edges, and the resolved `changeRoot`, `artifactPaths`, and `actionContext`. The required set is `applyRequires` plus everything reachable through `requires`, walked transitively. `status` reports file existence only, so a `done` artifact still lists its dependencies — use the edges, not the status, to decide what must exist.

5. **Create each missing artifact in dependency order.** Run `openspec instructions <artifact-id> --change "<name>" --json` and work from its fields:

   - `instruction` — authoritative guidance for this artifact; follow it even for familiar names, and when it delegates creation to a skill or command, invoke that instead of writing the file.
   - `template` — the structure to fill; write the result to `resolvedOutputPath`, choosing a concrete path per `instruction` when it is a glob, then verify the file exists.
   - `context` / `rules` — constraints to apply, not content to copy.
   - `dependencies` — completed artifacts to read from disk before drafting this one (they may have changed since you last saw them); reuse those reads instead of re-reading unchanged files on every iteration.
   - `skipped` / `warning` — the change declares `skip_specs`, so this artifact must not be created; move on.

   Before drafting, inspect the relevant implementation, tests, configuration, and documentation outside `openspec/`, read-only and proportional to the change, and reuse the findings for later artifacts. Ground scope, design, and tasks in what you find: distinguish observed behavior from assumptions and proposed additions, and surface conflicts with existing specs instead of deciding silently.

6. **Close out the set.** Re-run `openspec status --change "<name>" --json` after each artifact — creating one can unblock others. An artifact is satisfied when it is `done`, reads `skipped`, or its own `instruction` states a condition that does not apply (say so, and do not reconsider it). `specs` is skipped only through the declared `skipped` status, never by your own judgment. Dependencies are enablers, not gates: if an artifact is `blocked` only by a deliberately skipped conditional dependency, write it anyway. If an artifact genuinely needs user input, ask and then continue.

7. **Present and hand off.** Run `openspec status --change "<name>"` and summarize the change name and location, the artifacts created, and any artifact skipped with its reason. Planning work normally ends here: stop, and `openspec-apply-change` follows once the user authorizes implementation and the project's approval gates are met. Continue into `openspec-apply-change` in the same turn only when implementation is already explicitly authorized and no approval gate remains outstanding.
