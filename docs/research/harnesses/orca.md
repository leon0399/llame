---
type: Reference
title: "Orca"
description: "Two-tier peer-agent adapters (SDK/app-server versus PTY), durable session records with provider-native resume, and a bypass-by-default permission posture"
resource: "https://github.com/stablyai/orca"
observed:
  date: "2026-09-17"
  revision: "85d1ffc0726d8403f9494436c421c5e3d7932c47"
sources:
  - id: src-main-native-chat-agent-session-wire-structured-agent-session-adapter-ts-l154-l230
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts#L154-L230"
    title: "StructuredAgentSessionAdapter interface"
  - id: src-main-claude-claude-agent-sdk-process-spawn-ts-l29-l36
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/claude/claude-agent-sdk-process-spawn.ts#L29-L36"
    title: "Orca-owned Claude Code spawn"
  - id: src-main-codex-codex-app-server-connection-ts-l32-l56
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/codex/codex-app-server-connection.ts#L32-L56"
    title: "persistent codex app-server connection"
  - id: src-shared-structured-native-chat-launch-route-test-ts-l54-l57
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/structured-native-chat-launch-route.test.ts#L54-L57"
    title: "structured support limited to claude and codex"
  - id: src-shared-agent-hook-types-ts-l6-l21
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/agent-hook-types.ts#L6-L21"
    title: "AGENT_HOOK_TARGETS"
  - id: src-main-claude-claude-structured-inbound-control-ts-l39-l54
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/claude/claude-structured-inbound-control.ts#L39-L54"
    title: "canUseTool as a durable prompt"
  - id: src-shared-agent-session-record-ts-l22-l64
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/agent-session-record.ts#L22-L64"
    title: "AgentSessionRecord location, account home, and handle"
  - id: src-shared-agent-session-resume-ts-l246-l292
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/agent-session-resume.ts#L246-L292"
    title: "getAgentResumeArgv"
  - id: src-shared-worktree-create-preparation-ts-l1-l40
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/worktree/create-preparation.ts#L1-L40"
    title: "worktree preparation lock reason"
  - id: src-main-runtime-rpc-mobile-e2ee-auth-validation-ts-l28-l52
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/runtime/rpc/mobile-e2ee-auth-validation.ts#L28-L52"
    title: "authenticateMobileE2EE"
  - id: src-shared-tui-agent-permissions-ts-l6-l32
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/tui-agent-permissions.ts#L6-L32"
    title: "YOLO_TUI_AGENT_ARGS"
  - id: src-shared-tui-agent-launch-defaults-ts-l10-l14
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/tui-agent-launch-defaults.ts#L10-L14"
    title: "DEFAULT_TUI_AGENT_ARGS = YOLO_TUI_AGENT_ARGS"
  - id: src-shared-tui-agent-launch-defaults-ts-l111-l123
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/tui-agent-launch-defaults.ts#L111-L123"
    title: "bypass is the posture until changed"
  - id: src-main-runtime-runtime-worktree-pty-agent-sources-ts-l29-l47
    resource: "https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/runtime/runtime-worktree-pty-agent-sources.ts#L29-L47"
    title: "hook-derived status row for PTY agents"
---

# Orca

- **Stack:** Electron and TypeScript desktop (about 22k TS files), with `cloud/`, `mobile/` (Expo), and `native/` satellites; roughly 11k commits since 2026-03-16; MIT (Lovecast Inc.)

Desktop orchestrator that launches peer coding agents in parallel, one per git
worktree or plain folder, and renders their status in one place. It is the
largest shipped example of llame's meta-harness thesis: the host owns work
identity and lifecycle while the peer CLI executes. Roughly 37 agent kinds are
declared, including `omp`, which Orca can resume by session
id[^src-shared-agent-session-resume-ts-l246-l292].

**Study**

1. **Two adapter tiers, one interface.** `StructuredAgentSessionAdapter`
   (`acquire`, `dispatch`, `answerPrompt`, `cancelTurn`, `rewind`, `compact`,
   `closeSession`) is the host-side contract, with fenced leases and a
   per-turn cancel that never interrupts the whole
   session[^src-main-native-chat-agent-session-wire-structured-agent-session-adapter-ts-l154-l230].
   Only two providers implement it: Claude Code through the Agent SDK, with
   Orca supplying the child process so it keeps the
   pid[^src-main-claude-claude-agent-sdk-process-spawn-ts-l29-l36], and Codex
   through a persistent `codex app-server` JSON-RPC child, because "the
   request-scoped app-server runner cannot carry approvals or streamed
   turns"[^src-main-codex-codex-app-server-connection-ts-l32-l56]. Feasibility
   is hard-coded to
   `['claude', 'codex']`[^src-shared-structured-native-chat-launch-route-test-ts-l54-l57].
   Every other agent, OpenCode and Pi included, is typed into a node-pty
   terminal; status is reconstructed from escape sequences plus, for 14
   CLIs, an installed hook script that POSTs status to a local
   server[^src-shared-agent-hook-types-ts-l6-l21]. High confidence for #29:
   a uniform host interface is achievable, but mid-turn approval
   interception exists only where the peer offers a bidirectional protocol.
2. **Peer permission request as a durable, addressable prompt.** For Claude,
   a decodable `can_use_tool` becomes a journal prompt whose `settle`
   resolves the SDK callback; a malformed request is denied without
   registering, and a cancelled turn settles the prompt with `null`, never
   authorizing[^src-main-claude-claude-structured-inbound-control-ts-l39-l54].
   High confidence as a shape for #778's pending-request lifecycle
   (deny-safe decode, cancel path, late-answer refusal). Orca applies no
   policy of its own on top; see Caution.
3. **Work identity split into three independently recoverable facts.**
   `AgentSessionRecord` pins an execution location (host, WSL distro,
   workspace id and kind), the account home pinned at launch "so a resume
   cannot drift to another login", and a PID-reuse-safe provider handle with
   a spawn token[^src-shared-agent-session-record-ts-l22-l64]. Resume after
   restart delegates to the peer's own flag per agent (`claude --resume`,
   `codex resume`, `opencode --session`, `pi --session <transcript>`,
   `omp --resume`)[^src-shared-agent-session-resume-ts-l246-l292], so for
   PTY agents Orca holds no transcript of its own. Worktree creation is
   guarded by a `.orca-preparing/<pid>-<uuid>` staging directory whose Git
   lock reason, not its path shape, is the ownership
   proof[^src-shared-worktree-create-preparation-ts-l1-l40]. High confidence
   for #756/#758: identity, execution location, and checkout are separate
   records, and the crash-safety argument is explicit.
4. **Paired-device remote control.** The phone scans an `orca://pair` offer
   (endpoint, device token, desktop public key), connects over WebSocket
   direct-first with relay fallback, and every frame is end-to-end encrypted
   with an ECDH-derived key; server-side auth is a device-token lookup
   reconfirmed by equality[^src-main-runtime-rpc-mobile-e2ee-auth-validation-ts-l28-l52].
   Moderate confidence for #758's phone-visible control as a transport
   shape; the authorization model does not transfer (see Caution).
5. **Skills as filesystem placement, not prompt injection.** `SKILL.md`
   files are scanned from `~/.agents/skills` and `<repo>/.agents/skills`
   and aliased into each CLI's own native skill directory, so each peer
   discovers them through its own mechanism and Orca never concatenates
   skill text into a context window. Moderate confidence for #770: the same
   catalog-plus-placement split keeps llame's prompt surface unchanged.

**Caution**

- **Bypass is the shipped default.** `DEFAULT_TUI_AGENT_ARGS` is the yolo
  table[^src-shared-tui-agent-launch-defaults-ts-l10-l14], which maps nearly
  every agent to its own permission-bypass flag
  (`--dangerously-skip-permissions`,
  `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, `--allow "*"`,
  `--trust-all-tools`)[^src-shared-tui-agent-permissions-ts-l6-l32], and the
  code says so: "bypass is the posture a user gets until they choose
  otherwise"[^src-shared-tui-agent-launch-defaults-ts-l111-l123]. There is
  no Orca-side allow/reject policy; even the Claude and Codex control
  channels forward the peer's own allow/deny/allow-for-session choices
  verbatim. Nothing here is a template for #763.
- **Remote authorization is a single bearer token per device.** Once the
  device token validates, the phone reaches the same RPC surface as the
  desktop with no per-workspace or per-owner scope. Single-user by
  construction.
- **Provenance stops at the peer boundary.** For PTY agents Orca keeps a
  one-line hook summary (`prompt`, `lastAssistantMessage`, tool name) and
  terminal scrollback[^src-main-runtime-runtime-worktree-pty-agent-sources-ts-l29-l47];
  for the structured pair it journals what the client dispatched and what
  the provider emitted, never the system prompt or tool list the peer
  assembled. An ACP adapter for llame (#29) inherits the same ceiling: a
  receipt can only cover what the peer protocol surfaces.
- Account homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) travel as plain
  environment on spawned children under a single-OS-user trust assumption.
- The README's "Codex, Claude Code, OpenCode or Pi" framing implies equal
  depth; OpenCode gets a status plugin but no structured adapter, and Pi is
  not even a hook target.

[^src-main-native-chat-agent-session-wire-structured-agent-session-adapter-ts-l154-l230]: [`StructuredAgentSessionAdapter` interface](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts#L154-L230)

[^src-main-claude-claude-agent-sdk-process-spawn-ts-l29-l36]: [Orca-owned Claude Code spawn](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/claude/claude-agent-sdk-process-spawn.ts#L29-L36)

[^src-main-codex-codex-app-server-connection-ts-l32-l56]: [persistent `codex app-server` connection](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/codex/codex-app-server-connection.ts#L32-L56)

[^src-shared-structured-native-chat-launch-route-test-ts-l54-l57]: [structured support limited to claude and codex](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/structured-native-chat-launch-route.test.ts#L54-L57)

[^src-shared-agent-hook-types-ts-l6-l21]: [`AGENT_HOOK_TARGETS`](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/agent-hook-types.ts#L6-L21)

[^src-main-claude-claude-structured-inbound-control-ts-l39-l54]: [`canUseTool` as a durable prompt](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/claude/claude-structured-inbound-control.ts#L39-L54)

[^src-shared-agent-session-record-ts-l22-l64]: [`AgentSessionRecord` location, account home, and handle](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/agent-session-record.ts#L22-L64)

[^src-shared-agent-session-resume-ts-l246-l292]: [`getAgentResumeArgv`](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/agent-session-resume.ts#L246-L292)

[^src-shared-worktree-create-preparation-ts-l1-l40]: [worktree preparation lock reason](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/worktree/create-preparation.ts#L1-L40)

[^src-main-runtime-rpc-mobile-e2ee-auth-validation-ts-l28-l52]: [`authenticateMobileE2EE`](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/runtime/rpc/mobile-e2ee-auth-validation.ts#L28-L52)

[^src-shared-tui-agent-permissions-ts-l6-l32]: [`YOLO_TUI_AGENT_ARGS`](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/tui-agent-permissions.ts#L6-L32)

[^src-shared-tui-agent-launch-defaults-ts-l10-l14]: [`DEFAULT_TUI_AGENT_ARGS = YOLO_TUI_AGENT_ARGS`](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/tui-agent-launch-defaults.ts#L10-L14)

[^src-shared-tui-agent-launch-defaults-ts-l111-l123]: [bypass is the posture until changed](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/shared/tui-agent-launch-defaults.ts#L111-L123)

[^src-main-runtime-runtime-worktree-pty-agent-sources-ts-l29-l47]: [hook-derived status row for PTY agents](https://github.com/stablyai/orca/blob/85d1ffc0726d8403f9494436c421c5e3d7932c47/src/main/runtime/runtime-worktree-pty-agent-sources.ts#L29-L47)
