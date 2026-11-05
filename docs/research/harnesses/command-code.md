---
type: Reference
title: "Command Code"
description: "Closed terminal coding agent whose public GitHub tree is a mods registry; the docs describe an append-only JSONL session, a host-drawn TUI, a permission ladder, and ripgrep code search."
resource: "https://github.com/CommandCodeAI/command-code/tree/630bbf418f62bcdea627e57e6dca60151452355b"
tags: [harness, tui, sessions, permissions, closed-source, search]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-11-04"
observed:
  date: "2026-11-04"
  revision: "630bbf418f62bcdea627e57e6dca60151452355b"
sources:
  - id: cc-readme
    resource: "https://github.com/CommandCodeAI/command-code/blob/630bbf418f62bcdea627e57e6dca60151452355b/readme.md#L31-L63"
    title: "README identifies the npm CLI, taste-1, and the docs"
  - id: cc-tree
    resource: "https://github.com/CommandCodeAI/command-code/tree/630bbf418f62bcdea627e57e6dca60151452355b"
    title: "Commit tree contains readme.md, .github, and mods"
  - id: cc-mods
    resource: "https://github.com/CommandCodeAI/command-code/blob/630bbf418f62bcdea627e57e6dca60151452355b/mods/README.md#L1-L5"
    title: "The public tree's mods registry is what the mods hub reads"
  - id: cc-npm
    resource: "https://www.npmjs.com/package/command-code/v/1.88.2"
    title: "npm command-code 1.88.2, license UNLICENSED, four bins"
  - id: cc-quickstart
    resource: "https://commandcode.ai/docs/quickstart"
    title: "Quickstart: Node 22, cmd, and the workspace trust prompt"
  - id: cc-sessions
    resource: "https://commandcode.ai/docs/sessions"
    title: "Sessions are append-only JSONL trees with checkpoints"
  - id: cc-headless
    resource: "https://commandcode.ai/docs/headless"
    title: "Headless mode prints NDJSON events and a final result line"
  - id: cc-context
    resource: "https://commandcode.ai/docs/context"
    title: "Compaction tiers and what stays in the model window"
  - id: cc-interactive
    resource: "https://commandcode.ai/docs/interactive-mode"
    title: "Interactive mode layout, input prefixes, and keybindings"
  - id: cc-permissions
    resource: "https://commandcode.ai/docs/permissions"
    title: "Permission ladder, modes, and sub-agent policy"
  - id: cc-tools
    resource: "https://commandcode.ai/docs/reference/tools"
    title: "Built-in tools, including grep, glob, and codemode"
  - id: cc-memory
    resource: "https://commandcode.ai/docs/memory"
    title: "AGENTS.md tiers and how memory reaches the model"
  - id: cc-taste
    resource: "https://commandcode.ai/docs/taste"
    title: "Taste packages and the taste-1 claim"
  - id: cc-skills
    resource: "https://commandcode.ai/docs/skills"
    title: "Skill locations and progressive disclosure"
  - id: cc-hooks
    resource: "https://commandcode.ai/docs/hooks"
    title: "Hook events and the plan-mode skip"
  - id: cc-mod-docs
    resource: "https://commandcode.ai/docs/mods"
    title: "Mod render tree, trust gate, and approval limits"
  - id: cc-mcp
    resource: "https://commandcode.ai/docs/mcp"
    title: "MCP transports, scopes, and tool names"
---

# Command Code

- **Stack:** The product is the terminal coding agent installed as the npm package `command-code`. The registry record for `1.88.2` lists license `UNLICENSED` and four binaries (`cmd`, `cmdc`, `command-code`, `commandcode`), each pointing at `dist/index.mjs`.[^cc-npm] The docs require Node.js 22 or newer and refuse to start on Node 20.[^cc-quickstart] On native Windows the short alias is `cmdc`, because `cmd` is the Windows shell; macOS, Linux, and WSL use `cmd`.[^cc-quickstart] The commit tree has three top-level entries: `readme.md`, `.github/` (issue templates and logos), and `mods/`. There is no `LICENSE` file and no agent source in that listing.[^cc-tree]

Command Code (`cmd`) is the CLI coding agent at [commandcode.ai](https://commandcode.ai). The README describes it as a coding agent that learns coding taste, and the install path it gives is `npm i -g command-code` then `cmd`.[^cc-readme] This note records that README, the mods registry, and the live docs. Those doc URLs are not git objects and do not display a package version, so the study below is the docs' account, not a line in `1.88.2`. The package body was not opened. Nothing was installed or run.

**Study**

1. **The session file is an append-only JSONL tree, and a turn commits when it finishes.** The docs say a session is one JSONL file under `~/.commandcode/projects/<slug>/`. The first line is a header (session id, creation time, working directory). Later lines are entries, and each entry points at a parent, so `/rewind`, `/tree`, and fork can keep more than one branch. The file is not rewritten in place; navigation moves a pointer and new entries are appended. A completed turn is appended as it commits. An interrupted turn is absent from the file. A user message that opened a turn which then failed on a model or API error is still written. A session with no exchange leaves no file. A damaged transcript loads with corrupted lines skipped.[^cc-sessions] Compaction appends its own entry (a summary plus a pointer to the first entry kept verbatim) and leaves the older lines on disk. `/tree` can still reach them.[^cc-sessions] `/fork` copies the whole tree, checkpoints, and file-backup history. `/clone` copies the active branch only, and rewind in the clone starts empty.[^cc-sessions] Headless (`cmd -p`) sessions are saved and stay out of the interactive `/resume` picker; an exact id still resumes them, including into the interactive UI.[^cc-sessions][^cc-headless] Each prompt also opens a checkpoint: conversation position plus a byte backup of files later written or edited, kept 30 days and capped at 200 backups per session, 10 MB per file. A rewind restores conversation, code, or both, and the docs say the rewound state is what a later resume shows. Oversized files are left untouched because they were never captured. If the disk is low, checkpointing pauses for the session and says so.[^cc-sessions] A per-session scratchpad, by default under `/tmp` and movable with `COMMANDCODE_SCRATCHPAD_BASE`, is shared with sub-agents, skips ordinary permission prompts, and fails open: if it cannot be created, the feature disables and the session continues.[^cc-sessions] llame's [Chat is the conversation and a Run is one turn](../../../VISION.md#runs-are-the-unit-of-execution). Command Code's docs describe one session file that holds the turns. [Compaction stores a checkpoint and leaves source messages in place](../../../SPEC.md#21-compaction-checkpoint). The JSONL compaction entry is the same shape of idea: the model reads a summary plus a tail, and the earlier entries stay addressable.

2. **Headless output is one process's stdout.** `cmd -p` runs a query, writes the answer to stdout, and exits. `--output-format json` writes newline-delimited JSON: `{"type":"event","event":{...}}` lines as the run goes, then one `{"type":"result",...}` line with `subtype` (`success`, `error`, or `max_turns`), usage, `durationMs`, and `finalText`. The documented example event is `tool_running` with a tool call id, name, and description. Unknown `event.type` values are meant to be ignored. `sessionId` is omitted when the run fails before a session is resolved. `stopReason` is omitted on any error result. `--verbose` prints the resolved session id to stderr; the page's diagram labels that stream as progress. Exit `0` is success, `8` is the turn cap (default 100), and `3` is unauthenticated, among a fixed table of codes.[^cc-headless] The docs do not describe a cursor, a sequence number, or a second client attaching to that stream. A follow-up is a new `cmd -p --continue` or `--resume <id>` process, which resumes the persisted transcript.[^cc-headless] By default a headless run allows file reads, grep, and glob, and blocks file writes, edits, and shell. `--yolo` (or `--dangerously-skip-permissions`) lifts that block. `--permission-mode yolo` sets the mode and leaves the block in place.[^cc-headless] Tools that need a person, such as asking a question or opening a plan, stay disabled unless `--tools-all` or `--tools-enable` names them.[^cc-headless] When `ask_user_question` is enabled headless, the tools page says the first option is auto-answered and the choice is disclosed to the model.[^cc-tools] llame's [clients replay an append-only run-event log and do not own execution](../../../SPEC.md#94-run-events). The interactive-mode page describes the screen as the terminal session.[^cc-interactive] The headless stream is a separate `cmd -p` process, and it ends when that process exits.[^cc-headless]

3. **The screen is a feed, an input, and a status line. The approval dialog stays with the host.** The interactive-mode page draws three bands: a feed of tool rows and the reply (`READ`, `EDIT`, `BASH`), the input, and a line under the input for the file, model, and mode. `/statusline` chooses which items that line shows (model, reasoning level, branch, session name) and which indicators sit under it. The layout is saved across sessions. Mods may add status items.[^cc-interactive] Three prefixes change the input. `/` opens a command menu ranked by name prefix, then name contains, then description. `!` runs the rest of the line as a shell command and adds the command and its output to the session. `@` completes a path, reads that file into context, and also loads `AGENTS.md` files between the file and the project root.[^cc-interactive][^cc-memory] A paste longer than 300 characters collapses to a `[Text#N]` placeholder; the full text is what gets submitted. `ctrl+g` opens the prompt in `$EDITOR`.[^cc-interactive] `shift+tab` (and `alt+m` where Shift-Tab never arrives) cycles `default` → `accept-edits` → `plan` → `yolo`. `dont-ask` is off that cycle. `escape` stops the current work. `escape` twice opens rewind.[^cc-interactive] The sessions page says the two presses have to land within 500 ms.[^cc-sessions] Overrides live in `~/.commandcode/keybindings.json`, keyed by action id, and unmentioned actions keep their defaults.[^cc-interactive] A permission prompt offers allow once, allow and remember, or deny with feedback. Remembered shell rules persist a prefix, except bases that run arbitrary code (`bash`, `python`, `curl`), which persist the exact command. A safety-forced prompt (destructive command, sensitive path, outside-workspace path, explicit `ask` rule) is yes/no once, and the session or project choice is hidden. `ctrl+e` can ask a background model to explain a shell command. That explanation is on demand by default; turning the setting off generates one for every prompt.[^cc-permissions] `/mode yolo` is refused because slash commands are agent-invokable; the docs say the way into permission bypass is `shift+tab` or a launch flag.[^cc-permissions] Mods draw with strings or a small element tree (`text`, `row`, `box`, `button`, `progress`, `divider`, `input`, `select`, `markdown`). They do not mount components. A crashing render becomes a one-line warning. `cmd.ui.override` can restyle the spinner, tool rows, user messages, and command output. The permission prompt and other approval dialogs are absent from that list. `onPermissionRequest` sees prompts the engine was about to show; a safety-forced prompt can be denied by a mod and cannot be allowed.[^cc-mod-docs] The mods page says that in print mode the UI bridge answers confirm with false and select/input with undefined.[^cc-mod-docs]

4. **One ladder answers allow, ask, or deny, and a sub-agent does not get the parent's prompt.** The docs say rules are enforced by Command Code. `AGENTS.md` can change what the model tries. Deny rules, then ask rules, match in every mode, including `yolo`. The published ladder's first matching rung wins. After those two, the rungs are an outside-workspace gate, a plan-mode mutation deny, a taste-directory write (allowed when taste learning is on, otherwise redirected to the `taste` tool, and skipped by `yolo`), a malformed-write deny, a read-only allow, a root/home removal breaker that still asks under `yolo` (and denies under `dont-ask` and `plan`), then `yolo` allow, sensitive-write ask, allow rules, the `accept-edits` fast path, and otherwise ask. `dont-ask` turns a would-be ask into a deny. Allow rules sit after those mode gates. The decision table says an allow is honored in plan mode only when the call is plan-compatible. Deny and ask match aggressively (env prefixes, wrappers, every subcommand, the raw string if parsing fails). Allow matches conservatively, and an unparseable command never auto-allows.[^cc-permissions] `default` prompts for mutations and allows reads. `accept-edits` allows ordinary workspace edits and a short list of filesystem commands, and still prompts for recursive `rm`. `plan` is read-only except a plan file under `~/.commandcode/plans/`. `yolo` skips ordinary prompts and still honors deny rules, ask rules, and the root/home breaker. `dont-ask` runs what policy already allows and denies the rest; the docs call it the CI mode.[^cc-permissions] File-tool reads of secret-looking paths are allowed unless an `ask` or `deny` rule says otherwise. A read-only shell command aimed at secret material, such as `cat .env`, misses that fast path. The decision table then asks in `default` and `accept-edits`, denies in `plan`, allows in `yolo`, and denies in `dont-ask` unless an allow rule matches.[^cc-permissions] MCP tools use the canonical name `mcp__server__tool`. Display names are not keys. `mcp__*` is valid in deny and ask, and an allow rule has to name the server. Plan mode removes write tools, `enter_plan_mode`, and all `mcp__*` tools from the schema. `write_file` stays for the plans directory only, `shell_command` stays for read-only commands, and the `task_*` tools stay. The tools page says a remote tool's read-only status cannot be verified, so the MCP schema is hidden rather than left to a runtime denial.[^cc-tools] The `agent` tool itself never prompts. A sub-agent runs the same pipeline, and where the main loop would draw a prompt the sub-agent policy auto-allows. Deny rules, plan-mode writes, and anything the main loop would prompt on for safety are denied.[^cc-permissions] A policy denial carries guidance and the turn continues. A human "no" ends the turn.[^cc-permissions] llame evaluates a startup `tools.permissions` policy at the execution gate, with `default`, `read-only`, and `bypass` modes. `bypass` skips that policy and leaves the other mandatory controls. An interactive approval workflow does not ship ([Approvals](../../../SPEC.md#75-approvals)). The Command Code ladder is prior art for that later workflow: deny and ask outrank the bypass mode, a remembered shell allow names a prefix or an exact command, a remembered MCP allow names `mcp__server__tool`, and a safety prompt is not cached. The sub-agent auto-allow stays out of a llame child. [The harness owns execution](../../../VISION.md#the-harness-owns-execution), and [a child is a Chat of Runs](../../../VISION.md#runs-are-the-unit-of-execution), so a prompt the parent would have shown stays a decision on that child Run.

5. **Documented code search is ripgrep `grep` plus `glob`. The tools page does not describe an embedding index.** `grep` takes a ripgrep regex, an optional path and glob, and `output_mode` of `content`, `files_with_matches` (the default), or `count`. The default line cap is 250. The docs say it runs a bundled ripgrep, then `rg` on `PATH`, then a pure-runtime gitignore-aware search. The ripgrep path ignores user ripgrep config, strips ANSI, re-excludes VCS directories, clamps columns at 500, returns a real error for a bad regex, and salvages partial results on timeout. `glob` searches hidden and gitignored files by default (`.git` excluded), returns 100 paths unless `limit` says otherwise (max 10,000), and uses a 20-second deadline (60 seconds on WSL) with the same partial-result salvage.[^cc-tools] Text tool output is capped at 25,000 tokens. Over-limit output is replaced with a notice to retry with a narrower query. `read_file` and the web tools bound themselves and are exempt. A multi-file `read_file` also stops near 100 KB and names the files it skipped.[^cc-tools] `web_search` is a client call to Command Code's own server route, with domain filters re-checked on the client. It is web search.[^cc-tools] `codemode` lets the model run a short script that calls other tools. The context receives what the script prints or returns. `searchTools` finds tools by description. The script sandbox has no file system, network, timers, or process access. In every mode a script cannot edit or write files, run commands, ask the user, review a plan, switch plan mode, load tools, or start another script. The default setting offers the tool when an MCP server is connected, and the script calls those MCP tools. Nested calls still go through the permission pipeline.[^cc-tools] The bundled `explore` sub-agent is read-only codebase exploration.[^cc-tools] The context page says that child spends its own window on file reads and search, and the parent receives the report.[^cc-context] A semantic index is a different mechanism from this page. What the page does specify, and what a llame code-search tool can use, is a lexical tool with an explicit fallback when the binary is missing, a cap that asks for a narrower query, a partial result on timeout, and a child whose bulk reads stay out of the parent transcript. [Indexes and embeddings are rebuildable projections](../../../VISION.md#human-readable-knowledge-is-canonical). [Search indexes are derived state](../../../VISION.md#memory-has-distinct-stores).

6. **Standing instructions, learned taste, and skills are three different loads.** Memory is `AGENTS.md`, loaded every request from three additive tiers: user `~/.commandcode/AGENTS.md`, then the project file (`<project>/AGENTS.md` or else `<project>/.commandcode/AGENTS.md`, the first that exists), then subdirectory files. Subdirectory memory loads when you `@`-mention a file, or when the agent reads a file you referenced. The walk goes from that file's directory up to the project root, outermost first. Each block is headed by its source path. `@path` imports inside a memory file expand up to five levels, and a missing path stays as text. Because memory sits in the system prompt, an edit is picked up on the next request and compaction does not summarize it away.[^cc-memory] Taste is a separate store of markdown learnings at `.commandcode/taste/**/taste.md`, `~/.commandcode/taste/`, and a remote package under the account. The taste page says an LLM reads prompts, edits, and correction diffs into signals, a model it names `taste-1` classifies each signal into a category and a confidence, and an LLM writes the learning as markdown that later turns read. The page says `taste-1` is not a text model, that the LLM calls are the visible traffic, and that `taste-1` is the middle step.[^cc-taste] The README names `taste-1` as the model that enforces coding taste and does not describe that pipeline.[^cc-readme] The classifier is absent from the public tree, so this note does not check the architecture.[^cc-tree] The stored artifact the docs do specify is editable markdown with a category and a confidence.[^cc-taste] Skills are folders with `SKILL.md`. The catalog of names and descriptions rides in the system prompt. `activate_skill` loads the body.[^cc-tools] `/skill-name` does the same.[^cc-skills] Project `.commandcode/skills/` wins over `.agents/skills/`, then the user directories, then extra paths, then bundled skills. When two locations share a name, the higher-precedence copy wins the bare name, and the shadowed copy is reported rather than dropped silently. When the bare name is a built-in or a custom command, `/skill:<name>` runs the skill.[^cc-skills] Loaded skill instructions are carried through every compaction tier verbatim.[^cc-context] That split matches [distinct stores](../../../VISION.md#memory-has-distinct-stores): `AGENTS.md` is curated markdown, taste is an optional derived preference, and a skill is instructions loaded when a task names them. Automatic taste extraction is the deferred automatic-injection path. A skill body that loads on activation, with the catalog left in the prompt, is the shape of a catalog that stays small until a task names it.

7. **Hooks are four events. Mods are unsandboxed code behind a trust prompt.** A hook is an executable. It reads JSON on stdin and writes JSON on stdout. `PreToolUse` can deny the tool. `PostToolUse` is advisory. `Stop` can force another iteration, capped at three retries, after which the turn ends with a line that names the script. `SessionStart` (startup, resume, clear) can inject context and cannot block the session from opening. Plan mode skips hooks entirely.[^cc-hooks] The first workspace launch asks whether to trust the folder.[^cc-quickstart] Project mods load after that prompt, because a mod is code. User-scope mods and `--mod` load regardless. The mods page says there is no sandbox, and that package installs run npm with `--ignore-scripts`. Print mode loads user-scope and `--mod` mods only; project mods stay out unless `--dangerously-skip-permissions` is set, because print mode never shows the trust prompt. The same page says a hot reload disposes the old registrations and keeps `cmd.state`, except tools added with `addTool`, which keep the old code until the next session because the tool set is fixed for the session.[^cc-mod-docs] MCP servers are stdio or HTTP, stored at local, project (`.mcp.json`), or user scope, with local overriding project overriding user. OAuth client secrets are stripped from the committed project file and stored in `~/.commandcode/mcp-tokens.json`. Browser tokens from the login flow are stored in that file too.[^cc-mcp] Servers connect in the background, and session start does not wait on them. MCP tool output has its own 25,000-token budget.[^cc-tools] The mods hub reads `mods/registry.json` from the public repository.[^cc-mods]

**llame fit**

- High: item 1's append-only transcript with a compaction entry that points at the first kept message, read against [the compaction checkpoint](../../../SPEC.md#21-compaction-checkpoint). Fast compact mode, which the context page limits to `/compact-mode fast`, keeps the last 20 tool calls from 50% of the window and the last 10 from 80%, then summarizes at 90%. The default mode waits for that summary, and if the summary cannot be produced the page says it falls back to the tier-2 tool-call trim.[^cc-context] llame's checkpoint admits no tool records across the boundary ([Compaction checkpoint](../../../SPEC.md#21-compaction-checkpoint)).
- High: item 2, as a boundary for the TUI. Subscribe to [run events](../../../SPEC.md#94-run-events) with a cursor. The headless NDJSON shape (typed events, then one terminal result, unknown types ignored, session id omitted on early failure) is a useful wire for a one-shot client, and it does not replace replay.
- High: item 3's host-drawn approval dialog, the refusal to let a slash command enter bypass, and a remembered shell allow that stores a prefix, or the exact command when the base is `bash`, `python`, or `curl`. That is input for the unshipped interactive approval flow in [Approvals](../../../SPEC.md#75-approvals).
- High: item 4's canonical `mcp__server__tool` id, with deny and ask outranking `yolo`, and `dont-ask` as a fail-closed allowlist for unattended runs.
- High: item 5, for a future code-search tool. The documented search is lexical, capped, and willing to return a partial hit. Wide reads are delegated. An embedding index would be a separate design. This page does not supply one.
- Moderate: item 6's three loads. Curated `AGENTS.md`, derived taste markdown, and a skill body that loads on activation.
- Low: item 3's mod element tree, as a way for an extension to add a row while the host keeps the approval dialog. Item 7's missing sandbox is the reason to treat project code as trusted-or-absent.

**Caution:** The tools page says `yolo` silently admits an outside directory as a workspace root on the first write.[^cc-tools] The permissions page says `yolo` also grants an outside directory, without a prompt, for a read or a shell working directory.[^cc-permissions] The scratchpad and a damaged JSONL both continue after a failure to create or to parse.[^cc-sessions] Sub-agent ordinary prompts auto-allow.[^cc-permissions] File-tool reads of `.env` are allowed until a rule restricts them.[^cc-permissions] The `taste-1` architecture is a doc claim.[^cc-taste] The npm package is `UNLICENSED`, and the public repository publishes the registry.[^cc-npm][^cc-mods]

[^cc-readme]: [README identifies the npm CLI, taste-1, and the docs](https://github.com/CommandCodeAI/command-code/blob/630bbf418f62bcdea627e57e6dca60151452355b/readme.md#L31-L63)

[^cc-tree]: [Commit tree contains readme.md, .github, and mods](https://github.com/CommandCodeAI/command-code/tree/630bbf418f62bcdea627e57e6dca60151452355b)

[^cc-mods]: [The public tree's mods registry is what the mods hub reads](https://github.com/CommandCodeAI/command-code/blob/630bbf418f62bcdea627e57e6dca60151452355b/mods/README.md#L1-L5)

[^cc-npm]: [npm command-code 1.88.2, license UNLICENSED, four bins](https://www.npmjs.com/package/command-code/v/1.88.2)

[^cc-quickstart]: [Quickstart: Node 22, cmd, and the workspace trust prompt](https://commandcode.ai/docs/quickstart)

[^cc-sessions]: [Sessions are append-only JSONL trees with checkpoints](https://commandcode.ai/docs/sessions)

[^cc-headless]: [Headless mode prints NDJSON events and a final result line](https://commandcode.ai/docs/headless)

[^cc-context]: [Compaction tiers and what stays in the model window](https://commandcode.ai/docs/context)

[^cc-interactive]: [Interactive mode layout, input prefixes, and keybindings](https://commandcode.ai/docs/interactive-mode)

[^cc-permissions]: [Permission ladder, modes, and sub-agent policy](https://commandcode.ai/docs/permissions)

[^cc-tools]: [Built-in tools, including grep, glob, and codemode](https://commandcode.ai/docs/reference/tools)

[^cc-memory]: [AGENTS.md tiers and how memory reaches the model](https://commandcode.ai/docs/memory)

[^cc-taste]: [Taste packages and the taste-1 claim](https://commandcode.ai/docs/taste)

[^cc-skills]: [Skill locations and progressive disclosure](https://commandcode.ai/docs/skills)

[^cc-hooks]: [Hook events and the plan-mode skip](https://commandcode.ai/docs/hooks)

[^cc-mod-docs]: [Mod render tree, trust gate, and approval limits](https://commandcode.ai/docs/mods)

[^cc-mcp]: [MCP transports, scopes, and tool names](https://commandcode.ai/docs/mcp)
