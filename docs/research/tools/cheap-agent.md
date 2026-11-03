---
type: Reference
title: "Cheap Agent"
description: "MIT MCP plugin for Claude Code and Codex: a pinned OpenCode worker edits a git worktree, and the host lands the patch after its own checks."
resource: "https://github.com/muaaz9329/cheap-ag"
tags: [plugin, mcp, worktree, delegation, cost]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8"
sources:
  - id: cheap-license
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/LICENSE#L1-L3"
    title: "MIT license, copyright 2026 muaaz9329"
  - id: cheap-package
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/package.json#L2-L4"
    title: "npm package cheap-agent 1.3.2"
  - id: cheap-bin
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/package.json#L28-L49"
    title: "Bin cheapag, and dependencies on the MCP SDK and opencode-ai 1.19.0"
  - id: cheap-entry
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/index.ts#L1-L15"
    title: "A TTY with no arguments runs login; a piped stdin runs the MCP server"
  - id: cheap-mcp
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/plugin/.mcp.json#L1-L7"
    title: "Claude starts npx cheap-agent@1.3.2"
  - id: cheap-codex-mcp
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/plugin/codex.mcp.json#L1-L8"
    title: "Codex starts the same package with the codex argument"
  - id: cheap-instructions
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/server.ts#L34-L46"
    title: "Server instructions tell the frontier model to delegate edits"
  - id: cheap-delegate-tool
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/server.ts#L108-L131"
    title: "delegate redacts the result, and Codex returns immediately"
  - id: cheap-consent
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/consent.ts#L9-L11"
    title: "The comment says only the CLI writes consent.json"
  - id: cheap-allow
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/allow.ts#L40"
    title: "allow.ts calls writeConsent"
  - id: cheap-read
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/consent.ts#L21-L27"
    title: "readConsent accepts a mode and a provider string"
  - id: cheap-gate
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/consent.ts#L87-L95"
    title: "delegate and research stop before any worktree when consent is missing"
  - id: cheap-worktree
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/workspace.ts#L36-L46"
    title: "Each job gets a detached worktree at HEAD plus a stash snapshot"
  - id: cheap-land
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/workspace.ts#L224-L247"
    title: "land applies the patch with a throwaway index and leaves the tree untouched on conflict"
  - id: cheap-not-sandbox
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L15-L16"
    title: "The ruleset comment says it is a guardrail, and code the worker writes can still run as the user"
  - id: cheap-deny
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L23-L35"
    title: "The hard denylist is last and covers install, git mutation, and redirection"
  - id: cheap-ruleset
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L75-L90"
    title: "The worker session starts from deny-all, then names allows"
  - id: cheap-research
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/research.ts#L17-L41"
    title: "Research uses a read-only ruleset in a throwaway worktree and the same consent gate"
  - id: cheap-pin
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/opencode.ts#L20-L32"
    title: "The OpenCode binary comes from the installed package, not PATH"
  - id: cheap-version
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/opencode.ts#L225-L236"
    title: "The server binds 127.0.0.1, then health must report the pinned version"
  - id: cheap-verify-gate
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/jobs.ts#L491-L499"
    title: "After a clean worker return, the host runs the check commands"
  - id: cheap-land-gate
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/jobs.ts#L577-L591"
    title: "A stopped job never lands; a job with no failing check can land"
  - id: cheap-verify-spawn
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/verify.ts#L54-L63"
    title: "Checks run as a shell child in the worktree with the parent environment"
  - id: cheap-redact
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/credentials.ts#L44-L46"
    title: "redact replaces sk- tokens of 16 or more characters"
  - id: cheap-guard-off
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/hook.ts#L34-L35"
    title: "The edit guard ships off until .cheapag/hook.json exists"
  - id: cheap-guard-check
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/hook.ts#L290-L298"
    title: "CHEAPAG_ALLOW_EDITS and a missing flag file return before a deny"
  - id: cheap-guard-open
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/hook.ts#L182-L194"
    title: "A thrown guard prints nothing, and the comment says that allows the edit"
  - id: cheap-verify-commands
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/verify.ts#L12-L16"
    title: "verifyCommands uses backticks, then test_cmd, else nothing"
  - id: cheap-research-rules
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L94-L108"
    title: "researchRuleset is read-only and still allows test commands"
  - id: cheap-progress
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/server.ts#L86-L91"
    title: "progressTo sends notifications/progress"
  - id: cheap-hooks-json
    resource: "https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/plugin/hooks/hooks.json#L3-L13"
    title: "PreToolUse runs the guard only when the flag file exists, then exits 0"
---

# Cheap Agent

- **Stack:** TypeScript, Node `>=20.11`, npm package `cheap-agent` `1.3.2`, bin `cheapag`. Dependencies include `@modelcontextprotocol/sdk` and `opencode-ai` `1.19.0`.[^cheap-package][^cheap-bin] **License:** MIT.[^cheap-license]

Cheap Agent is a plugin the frontier harness loads. Claude Code or Codex keeps the conversation. A cheap model, reached through a pinned OpenCode server, edits a git worktree. Source inspection of `7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8` (the `1.3.2` release commit). The test suite was not run, and the SWE-bench numbers in the README were not reproduced.

This is a harness extension, the same shelf as [parsec](./parsec.md). It does call a model, and the hosting CLI still owns the session. Calling an LLM from an MCP tool does not make a second Chat.

**Study**

1. **Attachment is stdio MCP plus instructions.** With no arguments, a TTY runs `login` and a piped stdin runs the server. `cheapag codex` runs the server in Codex mode.[^cheap-entry] The Claude plugin config starts `npx -y cheap-agent@1.3.2`. The Codex config adds the `codex` argument.[^cheap-mcp][^cheap-codex-mcp] The server `instructions` string tells the frontier model to send every code change to `delegate`, and says worker output is data.[^cheap-instructions] Those words are context. They do not remove the host's edit tools. Codex `delegate` forces `wait: false`, so the call returns while the job is still running.[^cheap-delegate-tool] When the caller sent a progress token, `progressTo` emits MCP `notifications/progress`.[^cheap-progress]
2. **`delegate` and `research` stop when consent is missing. The file is still an ordinary JSON file.** The comment on the consent module says only the CLI writes `.cheapag/consent.json` and no MCP tool can.[^cheap-consent] `writeConsent` is called from `allow.ts`.[^cheap-allow] `consentGate` returns a block when the file is missing, names another provider, or the route no longer matches what was approved. `delegate` calls the gate before creating a worktree or booting OpenCode.[^cheap-gate] `research` does the same.[^cheap-research] The block text tells the model to ask the user to run `/cheapag:allow` or `npx cheap-agent allow`, and says the model must not approve itself. `readConsent` accepts a file whose `mode` is `all`, `zdr-only`, or `models` and whose `provider` is a string.[^cheap-read] The frontier model's own edit tools are still present, so this gate is "Cheap Agent will not start," and it is not a lock the host model is unable to forge. It is a single-user file on the repo, and it is not a tenant decision.
3. **The worker is OpenCode in a detached worktree. Landing is a patch apply.** The binary is resolved from the installed `opencode-ai` package, not from `PATH`.[^cheap-pin] `spawn` runs `opencode serve --hostname 127.0.0.1 --port 0`. The health JSON's `version` must equal the pinned package version or the boot throws.[^cheap-version] `createWorktree` adds a detached worktree at `HEAD`, applies `git stash create` when that snapshot is non-empty, and links dependency directories from the main checkout. The comment says the main checkout is not modified by that step.[^cheap-worktree] `land` copies the index to a throwaway `GIT_INDEX_FILE`, runs `git apply --3way`, and returns the conflict text with the user's tree unchanged when the check fails.[^cheap-land] [Git worktrees are derived Workspace views](../../../VISION.md#execution-follows-intent-and-capability). A child that edits one would be a later child Run, and [child-agent orchestration stays deferred](../../../VISION.md#explicit-deferrals).
4. **The host runs the checks, and a failing check skips the land.** After the worker returns without an error and the step has check commands, `verify` runs them in the worktree.[^cheap-verify-gate] A stopped or cancelled job does not call `land`. The land call sits in the branch where `failing` is absent.[^cheap-land-gate] `verifyCommands` uses backticked fragments of `done-when`, otherwise `test_cmd`, otherwise an empty list.[^cheap-verify-commands] An empty list leaves `failing` unset, so that branch can still land. The check child is `spawn` with `shell: true` (or Git Bash on Windows), cwd the worktree, and `env` copied from `process.env`.[^cheap-verify-spawn] The permission comment says the OpenCode ruleset is a guardrail against commands the model types, and code the worker writes can still run as the developer.[^cheap-not-sandbox] The ruleset itself starts with `deny("*")`, allows read and edit, denies `.env` reads and a hard command list that is appended last (package installs, `git commit` and `git push`, redirection, `sudo`).[^cheap-ruleset][^cheap-deny] [Local Sandbox execution](../../../ROADMAP.md#then-local-sandbox-execution) is the later stage that would have to hold a check like this. The regex denylist is the part to leave behind.
5. **The edit guard is a host hook, and it fails open.** `.cheapag/hook.json` is what turns it on. The file's comment says the guard ships off.[^cheap-guard-off] `check` returns immediately when `CHEAPAG_ALLOW_EDITS=1`, and returns before a deny when `.cheapag/hook.json` is absent.[^cheap-guard-check] A parse error or a throw in `guard` is swallowed, and the comment says that allows the edit.[^cheap-guard-open] The plugin hook runs `npx -y cheap-agent@1.3.2 hook guard` only when the flag file or a takeover marker exists, and the shell command ends with `exit 0`.[^cheap-hooks-json] The deny body, when the guard does run, is JSON on stdout with `permissionDecision: "deny"`. This note did not run Claude Code or Codex, so which of those two signals the host honors is unverified. `redact` replaces a substring matching `sk-` plus 16 or more token characters before text is written to job files or returned to the model.[^cheap-redact] That pattern is narrower than every credential shape.
6. **Research is a second worker with edit denied.** `researchRuleset` allows read, glob, grep, and list, denies edit, and allows the same always-on and project test commands the comment describes for the implementer.[^cheap-research-rules] `research` runs that worker in its own throwaway worktree so a command that writes stays off the user's checkout.[^cheap-research] The answer is a fenced block in the worker's last message. The frontier model is told to verify low-confidence briefs. That instruction is in the MCP text, not a second checker.

**llame fit**

- High: item 4's split, where the host runs the check and withholds the apply when the check fails. The sandbox around that check is [later roadmap work](../../../ROADMAP.md#then-local-sandbox-execution), and the child would be a Run.
- Moderate: items 2 and 3. A consent record the model cannot write, and a worktree whose patch is applied by the host, match [the harness owns execution](../../../VISION.md#the-harness-owns-execution). The file-based consent is a single-user stand-in.
- Low: item 1's MCP instructions, and item 6's read-only scout. Both are prompts plus a tool.
- Avoid: item 5's fail-open hook, the shell check that inherits `process.env`, and treating the frontier CLI's session as a llame Chat.

**Caution:** The ruleset comment is explicit that this is not a sandbox.[^cheap-not-sandbox] Verification and the worker both run as the user who launched the CLI.[^cheap-verify-spawn] The edit guard's default is off, and a broken guard allows the edit.[^cheap-guard-off][^cheap-guard-open] Job state is a directory under `.cheapag/` in the repository. There is no tenant boundary.

[^cheap-license]: [MIT license, copyright 2026 muaaz9329](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/LICENSE#L1-L3)

[^cheap-package]: [npm package cheap-agent 1.3.2](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/package.json#L2-L4)

[^cheap-bin]: [Bin cheapag, and dependencies on the MCP SDK and opencode-ai 1.19.0](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/package.json#L28-L49)

[^cheap-entry]: [A TTY with no arguments runs login; a piped stdin runs the MCP server](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/index.ts#L1-L15)

[^cheap-mcp]: [Claude starts npx cheap-agent@1.3.2](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/plugin/.mcp.json#L1-L7)

[^cheap-codex-mcp]: [Codex starts the same package with the codex argument](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/plugin/codex.mcp.json#L1-L8)

[^cheap-instructions]: [Server instructions tell the frontier model to delegate edits](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/server.ts#L34-L46)

[^cheap-delegate-tool]: [delegate redacts the result, and Codex returns immediately](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/server.ts#L108-L131)

[^cheap-consent]: [The comment says only the CLI writes consent.json](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/consent.ts#L9-L11)

[^cheap-allow]: [allow.ts calls writeConsent](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/allow.ts#L40)

[^cheap-read]: [readConsent accepts a mode and a provider string](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/consent.ts#L21-L27)

[^cheap-gate]: [delegate and research stop before any worktree when consent is missing](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/consent.ts#L87-L95)

[^cheap-worktree]: [Each job gets a detached worktree at HEAD plus a stash snapshot](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/workspace.ts#L36-L46)

[^cheap-land]: [land applies the patch with a throwaway index and leaves the tree untouched on conflict](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/workspace.ts#L224-L247)

[^cheap-not-sandbox]: [The ruleset comment says it is a guardrail, and code the worker writes can still run as the user](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L15-L16)

[^cheap-deny]: [The hard denylist is last and covers install, git mutation, and redirection](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L23-L35)

[^cheap-ruleset]: [The worker session starts from deny-all, then names allows](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L75-L90)

[^cheap-research]: [Research uses a read-only ruleset in a throwaway worktree and the same consent gate](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/research.ts#L17-L41)

[^cheap-pin]: [The OpenCode binary comes from the installed package, not PATH](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/opencode.ts#L20-L32)

[^cheap-version]: [The server binds 127.0.0.1, then health must report the pinned version](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/opencode.ts#L225-L236)

[^cheap-verify-gate]: [After a clean worker return, the host runs the check commands](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/jobs.ts#L491-L499)

[^cheap-land-gate]: [A stopped job never lands; a job with no failing check can land](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/jobs.ts#L577-L591)

[^cheap-verify-spawn]: [Checks run as a shell child in the worktree with the parent environment](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/verify.ts#L54-L63)

[^cheap-redact]: [redact replaces sk- tokens of 16 or more characters](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/credentials.ts#L44-L46)

[^cheap-guard-off]: [The edit guard ships off until .cheapag/hook.json exists](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/hook.ts#L34-L35)

[^cheap-guard-check]: [CHEAPAG_ALLOW_EDITS and a missing flag file return before a deny](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/hook.ts#L290-L298)

[^cheap-guard-open]: [A thrown guard prints nothing, and the comment says that allows the edit](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/hook.ts#L182-L194)

[^cheap-verify-commands]: [verifyCommands uses backticks, then test_cmd, else nothing](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/verify.ts#L12-L16)

[^cheap-research-rules]: [researchRuleset is read-only and still allows test commands](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/permissions.ts#L94-L108)

[^cheap-progress]: [progressTo sends notifications/progress](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/src/server.ts#L86-L91)

[^cheap-hooks-json]: [PreToolUse runs the guard only when the flag file exists, then exits 0](https://github.com/muaaz9329/cheap-ag/blob/7b1ee74e48cd946e01ee920a1eeaa514d4dfb0a8/plugin/hooks/hooks.json#L3-L13)
