---
type: Reference
title: "ECC"
description: "MIT catalog of skills and hooks for peer coding CLIs, plus an alpha Rust control plane that tails SQLite session output by row id."
resource: "https://github.com/affaan-m/ECC"
tags: [harness, skills, hooks, tui, peer-coding-agent]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "b38be6a7f6350964d59328b52f0624e1d1d552d1"
sources:
  - id: vision-deferrals
    resource: "https://github.com/leon0399/llame/blob/6a7b3ad7c4babd59bc6f7afea15a416ee53c4494/VISION.md#L331-L345"
    title: "Automatic memory, a first-party CLI, and child orchestration stay deferred"
  - id: ecc-license
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/LICENSE#L1-L3"
    title: "MIT license, copyright line 2026 Affaan Mustafa"
  - id: ecc-package
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/package.json#L2-L4"
    title: "npm package ecc-universal 2.2.3"
  - id: ecc-bins
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/package.json#L499-L506"
    title: "npm bins are Node scripts"
  - id: ecc-cli
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/ecc.js#L9-L22"
    title: "ecc setup and install dispatch to Node scripts"
  - id: ecc-cargo
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/Cargo.toml#L1-L6"
    title: "ecc-tui 0.1.0 is a separate Rust package"
  - id: ecc-readme-alpha
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/README.md#L1-L21"
    title: "ECC 2.0 README calls the directory an alpha SQLite control plane"
  - id: ecc-output-since
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/store.rs#L4157-L4177"
    title: "get_output_since reads session_output rows with id greater than the cursor"
  - id: ecc-dashboard-cursor
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/tui/dashboard.rs#L4518-L4522"
    title: "The dashboard asks for a snapshot until it has a cursor, then for rows after it"
  - id: ecc-spawn-runner
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L3031-L3049"
    title: "A session runner is another copy of the ECC binary"
  - id: ecc-setsid
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L3072-L3086"
    title: "Unix runners call setsid before exec"
  - id: ecc-agent-program
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L2355-L2372"
    title: "A configured runner wins; otherwise claude, codex, opencode, or gemini"
  - id: ecc-harness-kind
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/mod.rs#L18-L46"
    title: "HarnessKind names more agents than the default program match"
  - id: ecc-argv
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L3122-L3176"
    title: "Claude --print argv and Codex exec workspace-write argv"
  - id: ecc-budget
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L1203-L1234"
    title: "A global token or cost budget collects live sessions to pause"
  - id: ecc-hooks
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/hooks/hooks.json#L2-L11"
    title: "PreToolUse on Bash runs a Node dispatcher"
  - id: ecc-observe
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/hooks/observe.sh#L15-L39"
    title: "The hook reads stdin JSON and exits 0 when it is empty"
  - id: ecc-observe-write
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/hooks/observe.sh#L200"
    title: "OBSERVATIONS_FILE is PROJECT_DIR/observations.jsonl"
  - id: ecc-observe-append
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/hooks/observe.sh#L385-L391"
    title: "The hook prints the observation and appends it to that file"
  - id: ecc-homunculus
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/SKILL.md#L140-L144"
    title: "The skill stores observer data outside the Claude home"
  - id: ecc-observer-claude
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/agents/observer-loop.sh#L399-L401"
    title: "The observer spawns claude --print with Read and Write"
  - id: ecc-opencode-plugin
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/.opencode/plugins/ecc-hooks.ts#L1-L14"
    title: "The OpenCode plugin header maps Claude hook phases onto OpenCode events"
  - id: ecc-pane-host
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/server.js#L55-L71"
    title: "The control pane defaults to 127.0.0.1:8765 and allows actions unless --read-only"
  - id: ecc-pane-action
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/actions.js#L96-L115"
    title: "An unknown action id throws; a known one is cargo in ecc2"
  - id: ecc-pane-spawn
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/server.js#L107-L114"
    title: "runAction spawns the action command with process.env"
  - id: ecc-pane-post
    resource: "https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/server.js#L290-L297"
    title: "--read-only answers an action POST with 403"
---

# ECC

- **Stack:** npm package `ecc-universal` `2.2.3`. The `bin` map has six names: `ecc` and `ecc-universal` both run `scripts/ecc.js`; `ecc-install`, `ecc-control-pane`, `ecc-memory-mcp`, and `ecc-plan-canvas` are separate scripts.[^ecc-package][^ecc-bins] `ecc2/` is a separate Rust package, `ecc-tui` `0.1.0`.[^ecc-cargo] **License:** MIT.[^ecc-license]

ECC (Everything Claude Code) is a catalog the peer CLI executes, plus an alpha control plane that starts those CLIs. Nothing in this tree was run. The `ecc2/` README calls that directory alpha and says it is usable for local experimentation.[^ecc-readme-alpha]

**Study**

1. **The published package installs content into a host that already owns the loop.** `scripts/ecc.js` dispatches `setup` and `install` to other Node scripts.[^ecc-cli] `hooks/hooks.json` registers a `PreToolUse` matcher on `Bash` whose command is Node and ends in `scripts/hooks/pre-bash-dispatcher.js`.[^ecc-hooks] The OpenCode plugin file's header says it maps Claude's `PreToolUse`, `PostToolUse`, and `Stop` onto OpenCode's `tool.execute.before`, `tool.execute.after`, and session events.[^ecc-opencode-plugin] Skills are Markdown the host is expected to follow. The start of `observe.sh` reads JSON from stdin, sets the phase from its argument or `CLAUDE_HOOK_EVENT_NAME`, and exits 0 when stdin is empty.[^ecc-observe] Later the same script sets `OBSERVATIONS_FILE` to `$PROJECT_DIR/observations.jsonl` and appends one JSON object to it.[^ecc-observe-write][^ecc-observe-append] `PROJECT_DIR` comes from `detect-project.sh`, and the skill documents that directory under `CLV2_HOMUNCULUS_DIR`, `$XDG_DATA_HOME/ecc-homunculus`, or `$HOME/.local/share/ecc-homunculus`, outside `~/.claude`.[^ecc-homunculus] When enough observations accumulate, `observer-loop.sh` spawns `claude --print` with `--allowedTools Read,Write`, model `${ECC_OBSERVER_MODEL:-haiku}`, and `ECC_SKIP_OBSERVE=1`.[^ecc-observer-claude] llame's current sequence defers semantic fact extraction and automatic memory injection.[^vision-deferrals] A second Claude process with `Write` in its argv is a proposal to study only after that deferral is lifted, and the proposal would keep the write inside llame's tool gate.
2. **`ecc2` is a peer-process supervisor with a SQLite output log.** The README says session runners are separate processes and the database is the cross-process source of truth.[^ecc-readme-alpha] `spawn_session_runner_for_program` starts the ECC executable again with `run-session`, a session id, a task, an agent name, and a cwd.[^ecc-spawn-runner] On Unix, `configure_background_runner_command` detaches that child with `setsid`.[^ecc-setsid] `get_output_since` selects `session_output` rows with `id > cursor`, ordered by `id`, and returns the last id as the next cursor.[^ecc-output-since] The dashboard uses a full snapshot until it holds a cursor, then calls `get_output_since`.[^ecc-dashboard-cursor] The cursor value is a row id from the SQLite file the README calls the cross-process source of truth. The dashboard keeps the last id it has seen in memory. [llame's run-event stream](../../../apps/api/src/runs/runs.controller.ts#L194-L248) chooses `Last-Event-ID` over `after_sequence` and then reads stored rows past that cursor, so a restarted API still has the tail. The standalone CLI that would show those events remains unselected backlog and excludes a daemon workspace registry.[../../../ROADMAP.md#backlog-standalone-personal-node-and-cli]
3. **The default argv covers four CLIs. The enum names more.** `HarnessKind` includes Claude, Codex, OpenCode, Gemini, Cursor, Kiro, Trae, Zed, Factory Droid, and Windsurf.[^ecc-harness-kind] `agent_program` returns `claude`, `codex`, `opencode`, or `gemini` unless a configured runner supplies a program, and any other kind bails with `Unsupported agent type`.[^ecc-agent-program] The Claude argv in that function is `--print`, `--name ecc-{session}`, then optional profile flags (`--model`, `--allowed-tools`, `--disallowed-tools`, `--permission-mode`, `--add-dir`, `--max-budget-usd`, `--append-system-prompt`) and a `--` before the task. The Codex argv is `exec --skip-git-repo-check --sandbox workspace-write --cd <working_dir> --color never`, plus optional `--model` and `--add-dir`.[^ecc-argv] `enforce_budget_hard_limits` sums token and cost metrics across sessions and, when a configured global budget is exceeded, collects Pending, Running, and Idle sessions to pause.[^ecc-budget] Whether the pause reaches the child process was not traced past that collection. [Starting the CLI in a directory may create a native-placement grant](../../../VISION.md#execution-follows-intent-and-capability) for that directory. Codex `workspace-write` is the peer's own sandbox flag, and this note did not execute it.
4. **`ecc control-pane` is a localhost page over the same database.** Argument parsing defaults the bind to `127.0.0.1` and port `8765`, and sets `allowActions` unless the process was started with `--read-only`.[^ecc-pane-host] A POST to `/api/actions/:id` looks the id up in a closed map. An unknown id throws from `buildControlPaneAction`. A known id sets `command` to `cargo` and cwd to `ecc2/` under the repo root; the argument list comes from that action's definition, including the query and a limit.[^ecc-pane-action] `runAction` spawns that command with `process.env`.[^ecc-pane-spawn] `--read-only` answers that POST with 403.[^ecc-pane-post] The bind address is a flag, so a non-loopback `--host` is an operator choice this note did not try.

**llame fit**

- Moderate: item 2's row-id tail, as a shape for a future CLI surface over the run-event log that already exists. The CLI itself is backlog.[../../../ROADMAP.md#backlog-standalone-personal-node-and-cli]
- Low: item 1's hook scripts as examples of host-owned observation. Automatic memory stays deferred.[../../../VISION.md#explicit-deferrals]
- Low: items 3 and 4. Peer argv and a local operator page are install machinery.
- Avoid: importing the observer's `claude --print` with `Write`, or treating `ecc2` session ids as Chat or Run identity. [A Run stays llame's unit of execution](../../../VISION.md#runs-are-the-unit-of-execution).

**Caution:** The catalog and `ecc2` were not executed. The observer's analysis child is allowed to `Write`.[^ecc-observer-claude] The control pane's default allows the closed set of `cargo` actions and `runAction` inherits the process environment.[^ecc-pane-host][^ecc-pane-spawn] There is no tenant boundary in either surface.

[^ecc-license]: [MIT license, copyright line 2026 Affaan Mustafa](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/LICENSE#L1-L3)

[^ecc-package]: [npm package ecc-universal 2.2.3](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/package.json#L2-L4)

[^ecc-bins]: [npm bins are Node scripts](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/package.json#L499-L506)

[^ecc-cli]: [ecc setup and install dispatch to Node scripts](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/ecc.js#L9-L22)

[^ecc-cargo]: [ecc-tui 0.1.0 is a separate Rust package](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/Cargo.toml#L1-L6)

[^ecc-readme-alpha]: [ECC 2.0 README calls the directory an alpha SQLite control plane](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/README.md#L1-L21)

[^ecc-output-since]: [get_output_since reads session_output rows with id greater than the cursor](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/store.rs#L4157-L4177)

[^ecc-dashboard-cursor]: [The dashboard asks for a snapshot until it has a cursor, then for rows after it](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/tui/dashboard.rs#L4518-L4522)

[^ecc-spawn-runner]: [A session runner is another copy of the ECC binary](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L3031-L3049)

[^ecc-setsid]: [Unix runners call setsid before exec](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L3072-L3086)

[^ecc-agent-program]: [A configured runner wins; otherwise claude, codex, opencode, or gemini](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L2355-L2372)

[^ecc-harness-kind]: [HarnessKind names more agents than the default program match](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/mod.rs#L18-L46)

[^ecc-argv]: [Claude --print argv and Codex exec workspace-write argv](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L3122-L3176)

[^ecc-budget]: [A global token or cost budget collects live sessions to pause](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/ecc2/src/session/manager.rs#L1203-L1234)

[^ecc-hooks]: [PreToolUse on Bash runs a Node dispatcher](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/hooks/hooks.json#L2-L11)

[^ecc-observe]: [The hook reads stdin JSON and exits 0 when it is empty](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/hooks/observe.sh#L15-L39)

[^ecc-observe-write]: [OBSERVATIONS_FILE is PROJECT_DIR/observations.jsonl](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/hooks/observe.sh#L200)

[^ecc-observe-append]: [The hook prints the observation and appends it to that file](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/hooks/observe.sh#L385-L391)

[^ecc-homunculus]: [The skill stores observer data outside the Claude home](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/SKILL.md#L140-L144)

[^ecc-observer-claude]: [The observer spawns claude --print with Read and Write](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/continuous-learning-v2/agents/observer-loop.sh#L399-L401)

[^ecc-opencode-plugin]: [The OpenCode plugin header maps Claude hook phases onto OpenCode events](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/.opencode/plugins/ecc-hooks.ts#L1-L14)

[^ecc-pane-host]: [The control pane defaults to 127.0.0.1:8765 and allows actions unless --read-only](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/server.js#L55-L71)

[^ecc-pane-action]: [An unknown action id throws; a known one is cargo in ecc2](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/actions.js#L96-L115)

[^ecc-pane-spawn]: [runAction spawns the action command with process.env](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/server.js#L107-L114)

[^ecc-pane-post]: [--read-only answers an action POST with 403](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/control-pane/server.js#L290-L297)

[^vision-deferrals]: [Automatic memory, a first-party CLI, and child orchestration stay deferred](https://github.com/leon0399/llame/blob/6a7b3ad7c4babd59bc6f7afea15a416ee53c4494/VISION.md#L331-L345)
