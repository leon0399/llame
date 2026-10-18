---
type: Reference
title: "CodeBuddy Code"
description: "Tencent peer coding CLI and Agent SDK: stream-json child process, cwd-keyed JSONL sessions, and a WorkBuddy sidecar host."
resource: "https://www.npmjs.com/package/@tencent-ai/codebuddy-code"
tags: [harness, peer-coding-agent, acp, sdk, permissions, workspace]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-10-18"
observed:
  date: "2026-10-18"
  revision: "2.168.2"
sources:
  - id: sdk-package-json
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/package.json#L2-L15"
    title: "Published SDK name, version 0.3.282, and MIT license"
  - id: sdk-readme-permission
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/README.md#L45"
    title: "README permissionMode union is narrower than the type"
  - id: sdk-readme-correlation
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/README.md#L66-L73"
    title: "Transcript uuid, request id, and ACP turn id"
  - id: sdk-index-dts
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/index.d.ts#L1-L6"
    title: "Typings header names Genie and a different package"
  - id: sdk-version
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/version.js#L7"
    title: "SDK_VERSION constant is the string 0.3.28"
  - id: cli-package-json
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/package.json#L2-L49"
    title: "CLI 2.168.2 bins, license field, and Genie export paths"
  - id: cli-license
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/LICENSE.txt#L1-L5"
    title: "LICENSE.txt MIT grant, copyright line 2023 Tencent Cloud"
  - id: cli-readme
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/README.md#L1-L3"
    title: "README calls CodeBuddy Code the Tencent Cloud coding tool"
  - id: process-transport-header
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L1-L5"
    title: "ProcessTransport spawns the CLI on stdin and stdout"
  - id: process-transport-args
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L293-L353"
    title: "stream-json args, permission mode, session flags"
  - id: process-transport-settings
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L367-L384"
    title: "SDK defaults setting sources to none and forwards add-dir"
  - id: process-transport-spawn
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L434-L502"
    title: "Spawn cwd, inherited env, and auto-memory default off"
  - id: process-transport-stdout
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L518-L524"
    title: "Stdout is read with readline, one line per message"
  - id: process-transport-write
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L879-L883"
    title: "Stdin writes are JSON plus a newline"
  - id: query-controller-permission
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/_internal/query-controller.js#L56-L126"
    title: "can_use_tool denies when no handler is set"
  - id: types-permission-mode
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L18-L48"
    title: "PermissionMode union and permission updates"
  - id: types-setting-source
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L883"
    title: "SettingSource is user, project, or local"
  - id: types-agent
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L302-L308"
    title: "AgentDefinition is description, tools, prompt, and model"
  - id: types-options-agents
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L893-L894"
    title: "Options.agents forwards custom subagent definitions"
  - id: types-mcp-config
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L243-L268"
    title: "MCP configs are stdio, SSE, HTTP, or an in-SDK server"
  - id: types-mcp-option
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L965-L966"
    title: "mcpServers is a map or a file path"
  - id: types-system-init
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L492-L513"
    title: "Init message shapes for MCP servers, skills, and plugins"
  - id: sdk-mcp-server
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/mcp/create-sdk-mcp-server.js#L111-L138"
    title: "createSdkMcpServer registers tool handlers in this process"
  - id: plugin-header
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/plugin.js#L1-L11"
    title: "Plugin helper header names settings.json and a Genie import"
  - id: plugin-home
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/plugin.js#L68-L73"
    title: "Plugin settings path is the home directory .codebuddy"
  - id: plugin-install
    resource: "https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/plugin.js#L253-L271"
    title: "installPlugin sets enabledPlugins in settings.json"
  - id: session-store-paths
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/vendor/cbc-core/node/session/session-store.d.ts#L223-L232"
    title: "JSONL paths under ~/.codebuddy/projects"
  - id: session-controller
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/session/session-controller.d.ts#L1-L52"
    title: "HTTP session list is scoped by cwd"
  - id: memory-types
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/memory/memory-types.d.ts#L1-L49"
    title: "Four memory types, MEMORY.md caps, and a drift caveat"
  - id: memory-protocol
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/memory/memory-protocol.d.ts#L8-L39"
    title: "Instruction filenames and memory scopes"
  - id: memory-extraction
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/memory/memory-extraction-service.d.ts#L1-L7"
    title: "Stop-hook memory extraction"
  - id: sandbox-gateway
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/permission/sandbox-permission-gateway.d.ts#L7-L18"
    title: "Sandbox path skips the rule chain"
  - id: shell-snapshot-home
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/shell/shell-snapshot-protocol.d.ts#L1-L6"
    title: "Shell snapshot captures the user shell at CLI start"
  - id: shell-snapshot-dir
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/shell/shell-snapshot-protocol.d.ts#L66-L70"
    title: "Home is CODEBUDDY_CONFIG_DIR or ~/.codebuddy"
  - id: mcp-output-paths
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/mcp/mcp-output-storage.d.ts#L39-L40"
    title: "MCP tool results stored under the project session directory"
  - id: sidecar-ready
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/cli/runtime-ready-reporter.d.ts#L58-L67"
    title: "WorkBuddy sidecar ready report is a no-op otherwise"
  - id: acp-web-ui-client
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/acp-web-ui-client.d.ts#L1-L9"
    title: "Web UI ACP name is distinct from WorkBuddy and Zed"
  - id: usage-replay
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/usage-update-builder.d.ts#L1-L8"
    title: "WorkBuddy history uses CLI HTTP replay"
  - id: cnb-listing
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/tree/62d939f8840e436500a18ebe7382810ef0b79e8d"
    title: "CNB tree at 62d939f shows docs, samples, changelog, license, README, and an image"
  - id: sdk-isolation
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/sdk.md#L6-L9"
    title: "SDK doc: filesystem config stays unloaded unless settingSources is set"
  - id: sdk-editions
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/sdk.md#L109-L122"
    title: "SDK doc: edition API-key pages and CODEBUDDY_INTERNET_ENVIRONMENT"
  - id: sdk-homes
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/sdk.md#L537-L538"
    title: "SDK doc: MCP and subagent filesystem homes"
  - id: cli-reference
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/cli-reference.md#L121-L142"
    title: "CLI reference: permission modes, sandbox, worktree, serve, and ACP"
  - id: daemon-worker
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L13"
    title: "Daemon doc: a worker is a PID file under ~/.codebuddy/sessions"
  - id: daemon-bind
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L29-L40"
    title: "Daemon doc: default mode and password on a non-local bind"
  - id: daemon-bg
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L66-L72"
    title: "Daemon doc: --bg runs as --print -y"
  - id: daemon-transcript
    resource: "https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L134-L141"
    title: "Daemon doc: transcript JSONL and the PID registry"
  - id: vision-workspace
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L188-L199"
    title: "CLI start directory is a placement grant"
  - id: vision-deferrals
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L331-L345"
    title: "Automatic memory, a first-party CLI, and harness dispatch are deferred"
  - id: spec-execution
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L110"
    title: "No Node protocol or remote executor API ships"
  - id: roadmap-cli
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/ROADMAP.md#L171-L191"
    title: "Standalone CLI remains unselected backlog"
---

# CodeBuddy Code

- **Stack:** Published npm CLI `@tencent-ai/codebuddy-code` `2.168.2` (bins `codebuddy`, `cbc`, `codebuddy-code`, `cbc-prewarm`, `codebuddy-lowmem`) and Agent SDK `@tencent-ai/agent-sdk` `0.3.282`.[^cli-package-json][^sdk-package-json] The SDK is readable JavaScript. The CLI ships bundled JavaScript plus `.d.ts` comments. The public CNB tree at `62d939f8840e436500a18ebe7382810ef0b79e8d` shows docs, samples, changelog, license, README, and an image.[^cnb-listing] `npm view` returned no `gitHead`. The published CLI tarball has no `package/src/` tree, while `package.json` exports still name `@genie/monorepo` source paths.[^cli-package-json]
- **License:** SDK `package.json` says MIT.[^sdk-package-json] CLI `LICENSE.txt` is an MIT grant whose copyright line reads `Copyright Copyright 2023 Tencent Cloud`.[^cli-license] CLI `package.json` says `SEE LICENSE IN README.md`, and that README does not restate the grant.[^cli-package-json][^cli-readme]

**Status:** Package inspection of those two versions, plus the CNB docs commit `62d939f8840e436500a18ebe7382810ef0b79e8d` (the published sync of the 2.168.2 docs). The CLI was not run. [WorkBuddy](./workbuddy.md) is the desktop host that starts this CLI. llame still has no Node protocol or remote executor API, and the standalone CLI remains unselected backlog.[^spec-execution][^roadmap-cli]

The README calls CodeBuddy Code Tencent Cloud's coding tool for the terminal, an IDE, and GitHub.[^cli-readme] The SDK embeds the CLI by spawning a child process. That is a peer executor, the same role as [Qwen Code](./qwen-code.md) or [Codex CLI](./codex-cli.md). Chat and Run identity stay in llame.

**Study**

1. **The SDK session is a CLI child on newline JSON.** `ProcessTransport` spawns the CLI and talks on stdin and stdout.[^process-transport-header] Stdout is consumed with `readline`, one line per callback, and each stdin write is `JSON.stringify` plus a newline.[^process-transport-stdout][^process-transport-write] Arguments force `--input-format=stream-json`, `--output-format=stream-json`, and `--verbose`.[^process-transport-args] Control requests (`can_use_tool`, hooks, elicitation) are routed beside the message stream.[^query-controller-permission] The published README separates a transcript `uuid` (JSONL entry), a model-request id, and a turn `_requestId` that stays stable across that turn's tool loop. ACP and stream-json hosts may preset the turn id in `_meta['codebuddy.ai/conversationRequestId']`.[^sdk-readme-correlation] High confidence as a peer wire. llame would keep Run correlation on its side. The typings header still says `Genie Agent SDK` and the example imports `@tencent-ai/genie-agent-sdk`, which is not the published package name.[^sdk-index-dts] `SDK_VERSION` in `version.js` is the string `0.3.28`, and the spawn path puts that string in the User-Agent, while the package version is `0.3.282`.[^sdk-version][^process-transport-spawn][^sdk-package-json]
2. **Sessions are files keyed by working directory.** The store comment gives main-session paths `~/.codebuddy/projects/{projectId}/{sessionId}.jsonl` and subagent paths under `subagents/`.[^session-store-paths] MCP tool-result spill files use the same project directory.[^mcp-output-paths] The HTTP session controller documents `GET /api/v1/sessions` with `cwd` omitted for the current workspace, a path for one workspace, or `*` for every workspace. The deprecated workspaces endpoint's comment says it scans `~/.codebuddy/projects/` and reads cwd values out of session files.[^session-controller] The SDK sends `--session-id`, `--resume`, and `--continue` when set, and sends `--no-session-persistence` only when persistence is explicitly false.[^process-transport-args] The daemon doc says each process also writes a PID file under `~/.codebuddy/sessions/`, and that the conversation transcript is `~/.codebuddy/projects/{id}/{sessionId}.jsonl`.[^daemon-worker][^daemon-transcript] Nothing here was executed. Moderate confidence for the path shape from the declarations. The daemon lifecycle is docs only.
3. **The spawn directory is the session workspace.** `start()` uses `options.cwd` or `process.cwd()` as the child `cwd`.[^process-transport-spawn] Extra roots go through repeated `--add-dir`.[^process-transport-settings] Shell snapshots are taken from the user shell at CLI start, and the home directory comment is `CODEBUDDY_CONFIG_DIR` or `~/.codebuddy`.[^shell-snapshot-home][^shell-snapshot-dir] A llame CLI start may create a native-placement grant for that directory, and that grant does not cover a later model-selected Workspace.[^vision-workspace] That CLI is still unselected backlog and excludes a daemon workspace registry.[^roadmap-cli] High confidence for this shape: extra directories are CLI flags on the same process, and the session list treats cwd as the workspace key.[^session-controller]
4. **Tools run in the CLI process.** The SDK does not implement file or shell tools. It starts the CLI, which owns them. The shell-snapshot comment says later commands source that snapshot so they see the user's functions and aliases.[^shell-snapshot-home] The sandbox permission gateway comment says a sandbox-enabled turn skips an "8-Phase" rule chain and leaves approval to the sandbox orchestrator.[^sandbox-gateway] That split was not executed, and the gateway implementation body is not in the `.d.ts`. The CLI reference documents `--sandbox`, `--worktree`, and `--acp` (stdio NDJSON by default; `--serve` uses HTTP ACP for the Web UI).[^cli-reference] `reportSidecarRuntimeReady` tells a WorkBuddy sidecar the HTTP port only when that sidecar injected a one-shot socket, and the comment says ordinary CLI runs are a no-op.[^sidecar-ready] The Web UI ACP client name is `codebuddy-web-ui`. The comment lists WorkBuddy and Zed as other `--acp` clients that do not use that name.[^acp-web-ui-client] WorkBuddy history switches go through CLI HTTP replay rather than ACP `loadSession()`.[^usage-replay] See [WorkBuddy](./workbuddy.md).
5. **A missing approval handler denies the call.** `PermissionMode` in the SDK types is `default`, `acceptEdits`, `bypassPermissions`, `plan`, `delegate`, `dontAsk`, or `fullAccess`. Updates can add, replace, or remove rules, set the mode, or add or remove directories. The destination is `userSettings`, `projectSettings`, `localSettings`, `session`, or `cliArg`.[^types-permission-mode] The same argument builder can pass `--dangerously-skip-permissions`.[^process-transport-args] The README sample only names `default`, `acceptEdits`, and `bypassPermissions`.[^sdk-readme-permission] The CLI reference says help lists `default`, `acceptEdits`, `auto`, `dontAsk`, `plan`, and `bypassPermissions`, and that the runtime also accepts `fullAccess`.[^cli-reference] Those three lists disagree. This note does not pick a winner. `handlePermissionRequest` answers `allowed: false` with reason `No permission handler provided` when `canUseTool` is absent, and forwards allow or deny from the callback.[^query-controller-permission] Unless the caller passes `settingSources`, the SDK sends `--setting-sources none`, so user, project, and local settings stay unloaded.[^process-transport-settings][^types-setting-source] The SDK doc says the same isolation for `settings.json`, `CODEBUDDY.md`, MCP, sub-agents, commands, rules, and skills, and it names `CODEBUDDY_INTERNET_ENVIRONMENT` for the China edition (`internal`), iOA (`ioa`), the dedicated edition (`cloudhosted`), and the self-hosted edition (`selfhosted`). The international edition is the unset default.[^sdk-isolation][^sdk-editions] That edition switch was not read out of the bundle. The daemon doc says `daemon start` defaults to `default` mode, that `--bg` runs in `--print -y`, and that a non-local address enables password authentication.[^daemon-bind][^daemon-bg] The CLI reference says `--serve --host` defaults to `127.0.0.1`, a non-loopback bind forces auth unless `--auth none`, and `CODEBUDDY_GATEWAY_AUTH` wins.[^cli-reference] Unverified in the bundle. A bypass flag and an auth-none override are ambient process policy. llame's current sequence still defers a full allow/ask/deny permission interface.[^vision-deferrals]
6. **Memory is instruction files plus an optional stop-hook extract.** The protocol comment says the filename family falls back to `CODEBUDDY`, `AGENTS.md` stays fixed, and scopes are `managed`, `user`, `project`, and `project-local`.[^memory-protocol] Semantic types are `user`, `feedback`, `project`, and `reference`. `MEMORY.md` is capped at 200 lines and 40000 bytes. The drift caveat tells the model to trust the current files when a memory conflicts.[^memory-types] Extraction is described as a fire-and-forget stop hook aligned with Claude Code's extractor.[^memory-extraction] The implementation was not run. The SDK sets `CODEBUDDY_DISABLE_AUTO_MEMORY=1` when that variable is absent or empty, because auto-memory issues a Write that needs a permission handler.[^process-transport-spawn] llame's current sequence defers semantic fact extraction and automatic memory injection.[^vision-deferrals] High confidence that this memory is local Markdown on the CLI machine. It is not a tenant store.
7. **Model choice is a string on the child.** The SDK forwards `--model` and an optional `--fallback-model`, and it refuses a fallback equal to the main model.[^process-transport-args] No router that maps an `auto` id onto a vendor model appears in `package/lib`. The international WorkBuddy task bar describes an Auto choice that selects a model from the task type. That claim is on the [WorkBuddy](./workbuddy.md) note. The SDK doc names edition-specific API-key pages.[^sdk-editions] Those pages were not confirmed in the published SDK sources.
8. **Subagent definitions are forwarded. One MCP mode runs in the SDK.** `Options.agents` takes `AgentDefinition` records: a description, optional tool allow and deny lists, a prompt, and an optional model.[^types-agent][^types-options-agents] `mcpServers` is a map or a file path. Stdio, SSE, and HTTP configs are data on that map.[^types-mcp-option][^types-mcp-config] `createSdkMcpServer` builds an `McpServer` in this process and registers the caller's tool handlers on it. How the CLI reaches those handlers was not traced.[^sdk-mcp-server] `installPlugin` does not download a package. It sets `enabledPlugins` in `settings.json` under `os.homedir()` plus `.codebuddy`. The file header's example imports `@genie/agent-sdk-js`.[^plugin-header][^plugin-home][^plugin-install] The init message reports `mcp_servers` as name and status, `skills` as strings, and `plugins` as name plus path.[^types-system-init] The SDK doc also names homes such as `~/.codebuddy/.mcp.json` and `.codebuddy/agents/`.[^sdk-homes] The SDK leaves those homes unloaded unless `settingSources` is set.[^process-transport-settings] The homes were not opened on disk. File and shell tools stay in the CLI.

**Caution**

- `bypassPermissions`, `fullAccess`, `--dangerously-skip-permissions`, `-y`, and daemon `--bg` are approval bypasses on a single-user CLI. They are not an isolation boundary for a multi-user server.[^types-permission-mode][^process-transport-args][^daemon-bg]
- The child inherits `process.env`, then overlays SDK flags. Credentials can ride along. The SDK does force `CODEBUDDY_CREDENTIALS_IN_MEMORY=0` and `DISABLE_AUTOUPDATER=1`.[^process-transport-spawn]
- Declaration comments describe WorkBuddy, the sandbox split, and memory extraction. The bundled CLI JavaScript was not line-audited, and nothing was executed.
- `docs.work-buddy.ai` is a different product. Tencent's desktop host is [WorkBuddy](./workbuddy.md).

[^sdk-package-json]: [Published SDK name, version 0.3.282, and MIT license](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/package.json#L2-L15)

[^sdk-readme-permission]: [README permissionMode union is narrower than the type](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/README.md#L45)

[^sdk-readme-correlation]: [Transcript uuid, request id, and ACP turn id](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/README.md#L66-L73)

[^sdk-index-dts]: [Typings header names Genie and a different package](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/index.d.ts#L1-L6)

[^sdk-version]: [SDK_VERSION constant is the string 0.3.28](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/version.js#L7)

[^cli-package-json]: [CLI 2.168.2 bins, license field, and Genie export paths](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/package.json#L2-L49)

[^cli-license]: [LICENSE.txt MIT grant, copyright line 2023 Tencent Cloud](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/LICENSE.txt#L1-L5)

[^cli-readme]: [README calls CodeBuddy Code the Tencent Cloud coding tool](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/README.md#L1-L3)

[^process-transport-header]: [ProcessTransport spawns the CLI on stdin and stdout](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L1-L5)

[^process-transport-args]: [stream-json args, permission mode, session flags](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L293-L353)

[^process-transport-settings]: [SDK defaults setting sources to none and forwards add-dir](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L367-L384)

[^process-transport-spawn]: [Spawn cwd, inherited env, and auto-memory default off](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L434-L502)

[^process-transport-stdout]: [Stdout is read with readline, one line per message](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L518-L524)

[^process-transport-write]: [Stdin writes are JSON plus a newline](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/transport/process-transport.js#L879-L883)

[^query-controller-permission]: [can_use_tool denies when no handler is set](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/_internal/query-controller.js#L56-L126)

[^types-permission-mode]: [PermissionMode union and permission updates](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L18-L48)

[^types-setting-source]: [SettingSource is user, project, or local](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L883)

[^types-agent]: [AgentDefinition is description, tools, prompt, and model](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L302-L308)

[^types-options-agents]: [Options.agents forwards custom subagent definitions](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L893-L894)

[^types-mcp-config]: [MCP configs are stdio, SSE, HTTP, or an in-SDK server](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L243-L268)

[^types-mcp-option]: [mcpServers is a map or a file path](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L965-L966)

[^types-system-init]: [Init message shapes for MCP servers, skills, and plugins](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/types.d.ts#L492-L513)

[^sdk-mcp-server]: [createSdkMcpServer registers tool handlers in this process](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/mcp/create-sdk-mcp-server.js#L111-L138)

[^plugin-header]: [Plugin helper header names settings.json and a Genie import](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/plugin.js#L1-L11)

[^plugin-home]: [Plugin settings path is the home directory .codebuddy](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/plugin.js#L68-L73)

[^plugin-install]: [installPlugin sets enabledPlugins in settings.json](https://unpkg.com/@tencent-ai/agent-sdk@0.3.282/lib/plugin.js#L253-L271)

[^session-store-paths]: [JSONL paths under ~/.codebuddy/projects](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/vendor/cbc-core/node/session/session-store.d.ts#L223-L232)

[^session-controller]: [HTTP session list is scoped by cwd](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/session/session-controller.d.ts#L1-L52)

[^memory-types]: [Four memory types, MEMORY.md caps, and a drift caveat](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/memory/memory-types.d.ts#L1-L49)

[^memory-protocol]: [Instruction filenames and memory scopes](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/memory/memory-protocol.d.ts#L8-L39)

[^memory-extraction]: [Stop-hook memory extraction](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/memory/memory-extraction-service.d.ts#L1-L7)

[^sandbox-gateway]: [Sandbox path skips the rule chain](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/permission/sandbox-permission-gateway.d.ts#L7-L18)

[^shell-snapshot-home]: [Shell snapshot captures the user shell at CLI start](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/shell/shell-snapshot-protocol.d.ts#L1-L6)

[^shell-snapshot-dir]: [Home is CODEBUDDY_CONFIG_DIR or ~/.codebuddy](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/shell/shell-snapshot-protocol.d.ts#L66-L70)

[^mcp-output-paths]: [MCP tool results stored under the project session directory](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/mcp/mcp-output-storage.d.ts#L39-L40)

[^sidecar-ready]: [WorkBuddy sidecar ready report is a no-op otherwise](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/cli/runtime-ready-reporter.d.ts#L58-L67)

[^acp-web-ui-client]: [Web UI ACP name is distinct from WorkBuddy and Zed](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/acp-web-ui-client.d.ts#L1-L9)

[^usage-replay]: [WorkBuddy history uses CLI HTTP replay](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/usage-update-builder.d.ts#L1-L8)

[^cnb-listing]: [CNB tree at 62d939f shows docs, samples, changelog, license, README, and an image](https://cnb.cool/codebuddy/codebuddy-code/-/tree/62d939f8840e436500a18ebe7382810ef0b79e8d)

[^sdk-isolation]: [SDK doc: filesystem config stays unloaded unless settingSources is set](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/sdk.md#L6-L9)

[^sdk-editions]: [SDK doc: edition API-key pages and CODEBUDDY_INTERNET_ENVIRONMENT](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/sdk.md#L109-L122)

[^sdk-homes]: [SDK doc: MCP and subagent filesystem homes](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/sdk.md#L537-L538)

[^cli-reference]: [CLI reference: permission modes, sandbox, worktree, serve, and ACP](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/cli-reference.md#L121-L142)

[^daemon-worker]: [Daemon doc: a worker is a PID file under ~/.codebuddy/sessions](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L13)

[^daemon-bind]: [Daemon doc: default mode and password on a non-local bind](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L29-L40)

[^daemon-bg]: [Daemon doc: --bg runs as --print -y](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L66-L72)

[^daemon-transcript]: [Daemon doc: transcript JSONL and the PID registry](https://cnb.cool/codebuddy/codebuddy-code/-/git/raw/62d939f8840e436500a18ebe7382810ef0b79e8d/docs/daemon.md#L134-L141)

[^vision-workspace]: [CLI start directory is a placement grant](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L188-L199)

[^vision-deferrals]: [Automatic memory, a first-party CLI, and harness dispatch are deferred](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L331-L345)

[^spec-execution]: [No Node protocol or remote executor API ships](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L110)

[^roadmap-cli]: [Standalone CLI remains unselected backlog](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/ROADMAP.md#L171-L191)
