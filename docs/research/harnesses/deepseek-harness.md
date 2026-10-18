---
type: Reference
title: "DeepSeek Harness"
description: "Local Cordis harness with browser and stdio clients, append-only session projection, and fail-closed approvals"
resource: "https://github.com/deepseek-ai/deepseek-harness"
tags: [harness, session, approvals, workspace, transport]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-18"
observed:
  date: "2026-10-18"
  revision: "687f282e8625c6b8d11ff58211a90524be2e4317"
sources:
  - id: readme-l5-l15
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md#L5-L15"
    title: "Plugin kernel, docs site, and developer-preview notice"
  - id: readme-l75
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md#L75"
    title: "MIT license link"
  - id: vision-l134-l139
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L134-L139"
    title: "Meta-harness ownership; ACP and peers stay north-star adapters"
  - id: spec-l108-l110
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L108-L110"
    title: "Execution is pg-boss plus RunExecutionService; no Node protocol ships"
  - id: roadmap-l171-l191
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/ROADMAP.md#L171-L191"
    title: "Standalone personal Node and CLI remain unselected backlog"
  - id: profile-ts-l178-l235
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/profile.ts#L178-L235"
    title: "Shipped profile templates and switched-off optional bundles"
  - id: profile-ts-l212-l213
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/profile.ts#L212-L213"
    title: "dsh plugin init uses dsh-base when no template exists"
  - id: profile-ts-l794-l799
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/profile.ts#L794-L799"
    title: "Booting a missing untemplated profile throws"
  - id: cli-readme-l9-l28
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/README.md#L9-L28"
    title: "CLI profiles, invoking directory, reserved desktop name, and tui example"
  - id: cli-reference-l100-l102
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/reference/README.md#L100-L102"
    title: "Example install of turtle-ui into a tui profile"
  - id: turtle-ui-repo
    resource: "https://github.com/deepseek-harness/turtle-ui"
    title: "Public repository lookup returned HTTP 404 (unpinned)"
  - id: web-patch-l173-l184
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/web-app/cordis.patch.yml#L173-L184"
    title: "Web bind defaults to 127.0.0.1:3080 and rejects wildcard binds"
  - id: connection-readme-l34
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/README.md#L34"
    title: "Browser unary HTTP POST; Gateway owns the mux WebSocket"
  - id: connection-readme-l47-l51
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/README.md#L47-L51"
    title: "Wildcard bind is unsupported; API GET /connect exchanges a launch token"
  - id: browser-auth-l269-l286
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/browser-auth.ts#L269-L286"
    title: "GET / with a launch token sets a cookie and redirects to ./"
  - id: browser-auth-l330-l341
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/browser-auth.ts#L330-L341"
    title: "API GET /connect sets a cookie and redirects to the mux"
  - id: session-transport-l161-l203
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/transport.ts#L161-L203"
    title: "Session follow opens on a snapshot and requires adjacent cursors"
  - id: desktop-readme-l35-l37
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L35-L37"
    title: "Electron shell, loopback port, and window-scoped WebSocket credentials"
  - id: sdk-protocol-l1-l6
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/src/index.ts#L1-L6"
    title: "SDK wire is newline-delimited JSON-RPC over stdio"
  - id: sdk-launch-l132-l143
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/client/src/launch.ts#L132-L143"
    title: "TypeScript client launches dsh --profile sdk by default"
  - id: sdk-client-l214-l217
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/client/src/client.ts#L214-L217"
    title: "TypeScript client spawns the runtime with piped stdio"
  - id: python-client-l25-l32
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/python/sdk/src/deepseek_harness/client.py#L25-L32"
    title: "Python HarnessConfig.profile defaults to sdk"
  - id: python-client-l497-l512
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/python/sdk/src/deepseek_harness/client.py#L497-L512"
    title: "Python requires an explicit DSH_HOME and appends --profile"
  - id: acp-index-l1-l7
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L1-L7"
    title: "ACP server is automation-only JSON-RPC stdio"
  - id: acp-readme-l55-l80
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#L55-L80"
    title: "ACP session/new, trusted controllers, and omitted surfaces"
  - id: headless-l225-l229
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/src/index.ts#L225-L229"
    title: "Headless resume rejects a header cwd that differs"
  - id: headless-l344-l353
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/src/index.ts#L344-L353"
    title: "Headless creates a session in the resolved process directory"
  - id: commands-l111-l149
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/commands.ts#L111-L149"
    title: "Web session create accepts workspaceId or cwd, then attaches"
  - id: controller-l163
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/index.ts#L163"
    title: "Session controller default cwd is process.cwd() at construction"
  - id: lease-l1-l19
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-persistence-jsonl/src/lease.ts#L1-L19"
    title: "One kernel write lease for the life of a write handle"
  - id: session-types-l90-l106
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts#L90-L106"
    title: "Session format writer is 4; header.cwd is the creation directory"
  - id: session-format-status-l31-l47
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/session-format-status.md#L31-L47"
    title: "Released session format 4, evidence tag dsh-v0.2.0-rc.2"
  - id: session-index-l966-l1004
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/index.ts#L966-L1004"
    title: "deriveMessages walks the surface and drops shadowed nodes"
  - id: session-doc-l5
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/session.md#L5"
    title: "Replay is re-derivation of the append-only log"
  - id: compaction-region-l491-l509
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts#L491-L509"
    title: "Compaction appends a summary and a surface replace"
  - id: compaction-doc-l9-l21
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/compaction.md#L9-L21"
    title: "Compaction markers stay log-only; the summary rides a user message"
  - id: spec-l43
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L43"
    title: "llame compaction is an RLS checkpoint; source messages stay unchanged"
  - id: agent-loop-l549-l554
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L549-L554"
    title: "The agent loop executes tool calls in process"
  - id: base-patch-l234-l276
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L234-L276"
    title: "Base sandbox, approval policy, and permission presets"
  - id: base-patch-l516-l529
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L516-L529"
    title: "Base mounts fs-sandbox and the DeepSeek adapters"
  - id: fs-sandbox-l1-l24
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/fs/fs-sandbox/src/index.ts#L1-L24"
    title: "File mutations are a trusted-code fence; reads pass through"
  - id: roots-ts-l43-l54
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox/src/roots.ts#L43-L54"
    title: "workspace-write allows the workspace root, /tmp, and os.tmpdir()"
  - id: sandbox-l1-l30
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox/src/index.ts#L1-L30"
    title: "Sandbox modes share the host kernel; remote execution replaces the seam"
  - id: sandbox-local-l11-l12
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox-local/README.md#L11-L12"
    title: "Local sandbox fails closed and reports full or partial enforcement"
  - id: sandbox-policy-l164-l169
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox-policy/src/index.ts#L164-L169"
    title: "The workspace-write root is the session header cwd"
  - id: session-cwd-l17-l24
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/fs/tool-fs/src/session-cwd.ts#L17-L24"
    title: "File tools resolve paths from the session working directory"
  - id: ssh-readme-l10-l12
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/ssh/README.md#L10-L12"
    title: "Optional POSIX SSH providers keep the harness local"
  - id: vision-l204-l206
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L204-L206"
    title: "Native execution is host-user authority, and sandbox failure stays failed"
  - id: workspace-readme-l12
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/workspace/workspace/README.md#L12"
    title: "Workspace registry groups directories and sessions, invisible to models"
  - id: working-directory-l33-l39
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L33-L39"
    title: "working-directory/change is the effective directory"
  - id: working-directory-l90-l96
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L90-L96"
    title: "Working directory is a required runtime-context contribution"
  - id: working-directory-l154-l205
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L154-L205"
    title: "set leaves processes and permissions; commit appends the event and a notice"
  - id: system-prompt-l314-l317
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/system-prompt/src/index.ts#L314-L317"
    title: "Runtime context is a snapshot joined apart from prompt sections"
  - id: conversation-l89-l96
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L89-L96"
    title: "Hero chip title falls back to a choose-workspace placeholder"
  - id: conversation-l123-l128
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L123-L128"
    title: "Picking a workspace calls selectWorkspace"
  - id: conversation-l137-l154
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L137-L154"
    title: "Hero composer stays disabled until a workspace title exists"
  - id: apply-l358
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/apply.ts#L358"
    title: "selectWorkspace calls workspaceNavigation.openWorkspace"
  - id: spec-l35
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L35"
    title: "No Workspace registry, remote routing, or Sandbox object ships"
  - id: spec-l292-l299
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L292-L299"
    title: "Shipped bash is host-user authority"
  - id: vision-l186-l199
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L186-L199"
    title: "A CLI start directory is a placement grant, not a model-chosen Workspace"
  - id: mcp-memory-l3-l31
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/guide/mcp-memory.md#L3-L31"
    title: "Memory is three default-off MCP overlays"
  - id: mcp-tools-l67-l86
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/src/tools.ts#L67-L86"
    title: "MCP public names hash when they break the function-name contract"
  - id: mcp-transport-l15-l22
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/src/transport.ts#L15-L22"
    title: "Stdio MCP env is the scrubbed parent plus explicit config.env"
  - id: subprocess-l47-l69
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/subprocess/subprocess/src/index.ts#L47-L69"
    title: "Child env drops credential-shaped names and DSH_*"
  - id: vision-l66-l76
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L66-L76"
    title: "Knowledge, episodic memory, and deferred semantic facts"
  - id: llm-index-l442-l443
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/index.ts#L442-L443"
    title: "A second adapter for the same provider throws"
  - id: llm-index-l1016-l1018
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/index.ts#L1016-L1018"
    title: "A missing provider adapter is NO_ADAPTER"
  - id: base-patch-l88-l94
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L88-L94"
    title: "Base default model is deepseek-official / deepseek-flash"
  - id: base-patch-l128-l136
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L128-L136"
    title: "pi-ai stays dormant until settings supply profiles"
  - id: providers-l7-l41
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/guide/providers.md#L7-L41"
    title: "Models page, write-only keys, one protocol per provider, session retention"
  - id: agent-ts-l289-l341
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/agent.ts#L289-L341"
    title: "Pending selection, then the last request header, then the configured default"
  - id: agent-default-model-l67-l72
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-default-model/src/index.ts#L67-L72"
    title: "currentSelection reads the configured provider and model"
  - id: model-selection-l47-l124
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/model-selection.ts#L47-L124"
    title: "agent/request overwrites the route; a provider change adds a user notice"
  - id: model-projection-l35-l66
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/model-selection-projection.ts#L35-L66"
    title: "model/selection is pending; a matching request header becomes lastUsed"
  - id: agent-loop-l63-l69
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L63-L69"
    title: "A logged header seed drops adapter-defaulted effort and max tokens"
  - id: agent-loop-l571-l596
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L571-L596"
    title: "prepareRequest seeds the instance route, then the logged header"
  - id: approval-types-l28-l32
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-approval/src/types.ts#L28-L32"
    title: "Closed approval outcomes"
  - id: approval-index-l215-l291
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-approval/src/index.ts#L215-L291"
    title: "Open-turn audit, never-before-answerers, and fail-closed unavailable"
  - id: approval-doc-l21-l47
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/approval.md#L21-L47"
    title: "Ask and never; replay reconstructs the last policy event"
  - id: permission-presets-l160-l217
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/permission-presets/src/index.ts#L160-L217"
    title: "custom and auto are reserved preset names"
  - id: spec-l77
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L77"
    title: "Operator permissions ship; interactive approval does not"
  - id: vision-l78-l88
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L78-L88"
    title: "The harness owns execution; approvals do not live in prompts"
---

# DeepSeek Harness

- **Stack:** TypeScript on the Cordis plugin kernel, Electron desktop shell, Python SDK client; MIT[^readme-l75]

**Status:** Source inspection of `687f282e8625c6b8d11ff58211a90524be2e4317` (tag `dsh-v0.2.1-rc.2`). The program was not run. Sandbox `full` versus `partial` enforcement was not measured on a host. Desktop IPC and the WebSocket credential filter were read from the desktop README. The Python launch arguments were read; the runtime wheel was not executed. A public lookup of `deepseek-harness/turtle-ui` returned HTTP 404.[^turtle-ui-repo] The optional auto-review bundle was not traced past its switched-off listing. The published docs site named in the README was not used as evidence.[^readme-l5-l15]

`dsh` is an everything-is-a-plugin harness. Profiles are named compositions under `$DSH_HOME/profiles`. The README marks the product a developer preview and says compatibility-breaking changes will happen.[^readme-l5-l15] llame keeps Chat and Run identity, lifecycle, provenance, cancellation, and published results. ACP, A2A, Codex App Server, and OpenCode remain north-star executor adapters.[^vision-l134-l139] Current execution is pg-boss plus `RunExecutionService`. No Node protocol or remote executor API ships.[^spec-l108-l110] A standalone personal CLI remains unselected backlog. Starting that CLI in a directory may grant native execution there. The same backlog excludes a daemon Workspace registry and model-directed entry into other directories.[^roadmap-l171-l191] The findings below describe `dsh`. They do not settle those llame designs.

**Study**

1. **Shipped profiles are web, ACP, headless, SDK, and SDK-minimal.** `PROFILE_TEMPLATES` names `acp` (`dsh-base` plus `dsh-acp-app`), `web` (`dsh-base` plus `dsh-web-app`), `headless` (`dsh-base` plus `dsh-headless`), `sdk` (`dsh-base` plus `dsh-sdk-app`), and `sdk-minimal` (`dsh-sdk-minimal` only). `OPTIONAL_BUNDLES` lists packages the installation ships switched off, including experimental session search, ralph, terminal, agent team, voice, and auto-review. `dsh plugin` init uses `dsh-base` for a name with no shipped template. Booting a missing name that has no template throws and names `dsh plugin` as the way to create it.[^profile-ts-l178-l235][^profile-ts-l212-l213][^profile-ts-l794-l799] The CLI treats the invoking directory as the default workspace root and auto-initializes those five profiles. The name `desktop` is reserved for the Electron-owned profile, and the CLI rejects boot and config-dump requests for it. `dsh --profile tui` is an example that assumes a profile of that name is already installed.[^cli-readme-l9-l28] The plugin reference shows `dsh plugin --profile tui add github:deepseek-harness/turtle-ui`.[^cli-reference-l100-l102] The public repository at that slug returned HTTP 404, so this note does not describe a TUI implementation.[^turtle-ui-repo] High confidence that the shipped templates contain no TUI profile. Whether a private package exists under that slug was not established.
2. **Browser, desktop, SDK, ACP, and headless are the shipped session carriers.** The web bundle binds `127.0.0.1` and port `3080` unless startup overrides them, and that row rejects wildcard binds.[^web-patch-l173-l184] The browser sends unary Remote calls as HTTP POST. API Gateway owns the `/api/remote.mux` WebSocket.[^connection-readme-l34] `dsh web --host 0.0.0.0` is unsupported. API callers exchange a launch token at `GET /connect`.[^connection-readme-l47-l51] A browser `GET /` with one matching launch token sets an authority-bound cookie and redirects to `./`.[^browser-auth-l269-l286] A matching API `GET /connect` sets its cookie and redirects to `./api/remote.mux`.[^browser-auth-l330-l341] Session follow treats the first `snapshot` frame as an opened journal page. A later cursor follows only when `right === left + 1`.[^session-transport-l161-l203] Desktop is an Electron shell around the same Web application. A RunAsNode child starts the profile runner, the page loads `dsh-app://app/`, and Node IPC carries boot, readiness, and shutdown. It binds `127.0.0.1` on an OS-assigned port. Electron forwards HTTP to the authenticated Host, and WebSocket credentials attach only for the owned window.[^desktop-readme-l35-l37] The SDK wire is newline-delimited JSON-RPC over stdio.[^sdk-protocol-l1-l6] The TypeScript client spawns Node with piped stdin, stdout, and stderr. The default profile argument is `--profile sdk`, placed after the Node arguments that launch the dsh entry.[^sdk-client-l214-l217][^sdk-launch-l132-l143] `HarnessConfig.profile` defaults to `"sdk"`. The Python client appends `--profile` and requires an explicit `dsh_home` or a non-empty `DSH_HOME`. It refuses an implicit `~/.dsh`.[^python-client-l25-l32][^python-client-l497-l512] ACP is an automation-only JSON-RPC stdio server for trusted programmatic clients.[^acp-index-l1-l7] `session/new` validates an absolute workspace before publication. Unsupported surfaces, including `session/load`, deletion, fork, additional directories, and client filesystem operations, are omitted or rejected.[^acp-readme-l55-l80] Headless is one in-process shot. With a filesystem service mounted, its creation directory is `fs.processPath(await fs.resolve('.'))`; otherwise it is `process.cwd()`. Resume rejects a stored header cwd that differs from that directory.[^headless-l344-l353][^headless-l225-l229] Web `session.create` accepts `workspaceId` or `cwd`, and rejects both together. The directory is the workspace path, then the request cwd, then the controller default, which is `process.cwd()` captured at construction. A named workspace then receives `attachSession`.[^commands-l111-l149][^controller-l163] JSONL persistence holds one kernel write lease for the life of a write handle. Contention is `SessionAlreadyOwnedError`. A wedged holder keeps the lock until its process exits. Readers never take the lock.[^lease-l1-l19] High confidence for the carriers whose source was read. Desktop forwarding and the Python wheel were not executed.
3. **Model history is a projection of an append-only session log.** `SESSION_FORMAT_VERSION` is `4`. `header.cwd` is the absolute directory recorded when the session was created.[^session-types-l90-l106] The format status record lists latest finalized version 4 and latest released version 4, with evidence tag `dsh-v0.2.0-rc.2`.[^session-format-status-l31-l47] `deriveMessages()` walks surface nodes. A compaction `replace` deletes the shadowed nodes from that derivation. The events remain in the log. An empty assistant message derives to null and stays out of the transcript.[^session-index-l966-l1004] Replay reconstructs model history by re-deriving the same events.[^session-doc-l5] Summary compaction appends `compaction/summary`, then a `user/message` whose `surfaceOp` is `{ op: 'replace', startSeq, endSeq }`. The `compaction/*` markers stay off the surface. The original events stay in the log.[^compaction-region-l491-l509][^compaction-doc-l9-l21] llame compaction stores an RLS-scoped checkpoint row. Source messages remain unchanged, and no tool records cross a checkpoint. That contract wins any disagreement with this note.[^spec-l43] High confidence for the `dsh` projection. It is evidence about `dsh`, and it leaves llame's checkpoint shape unchanged.
4. **Tools run in the harness process. The write fence is the creation directory.** The agent loop calls `executeToolCalls` in the same process.[^agent-loop-l549-l554] The base bundle, which the `acp`, `web`, `headless`, and `sdk` templates include, mounts `dsh-subprocess-local` and `dsh-sandbox-local`. Its sandbox policy mode is `DSH_PERMISSION_MODE`, or `workspace-write` when that variable is absent, and its configured root is `process.cwd()`. Approval policy is `never` when that mode is `danger-full-access`, and `ask` otherwise. The permission preset table pairs `read-only` with `ask`, `workspace-write` with `ask`, and `danger-full-access` with `never`.[^base-patch-l234-l276][^profile-ts-l178-l235] `dsh-fs-sandbox` extends the local filesystem. Reads pass through in every mode. `read-only` denies every mutation. `workspace-write` allows a mutation only when the target canonicalizes under `writableRoots`: the policy workspace root, the host path `/tmp`, and `os.tmpdir()`.[^roots-ts-l43-l54] `danger-full-access` is unfenced. The check is trusted code over a model-supplied path. The file-sandbox comment assigns kernel isolation of untrusted code to `ctx.shell`. The base bundle mounts `dsh-bash-sandbox` for that seat and disables it on Windows, where it mounts `dsh-pwsh-sandbox` instead. A residual symlink TOCTOU is accepted.[^fs-sandbox-l1-l24][^base-patch-l234-l276][^base-patch-l516-l529] The sandbox service shares the host kernel and filesystem. Containers, microVMs, and remote execution replace that seam. Modes are `read-only`, `workspace-write`, and `danger-full-access`.[^sandbox-l1-l30] `dsh-sandbox-local` fails with `SANDBOX_UNAVAILABLE` when no platform runner is usable, and each execution reports `full` or `partial` enforcement. This note did not measure which report a host produces.[^sandbox-local-l11-l12] Policy resolution uses `session.header.cwd`, then the configured root. A later working-directory change leaves that root in place.[^sandbox-policy-l164-l169][^working-directory-l154-l205] File tools resolve a relative path through `workingDirectory.ensure`.[^session-cwd-l17-l24] The optional SSH family runs files, processes, terminals, and sandbox enforcement on one POSIX host while the harness process stays local. Its README points that family at headless or custom profiles.[^ssh-readme-l10-l12] The shipped templates and the optional-bundle list do not name those packages.[^profile-ts-l178-l235] VISION says native execution is disclosed as host-user authority, and that a sandbox failure does not silently become native execution.[^vision-l204-l206] Sandbox is not a current llame runtime object. Shipped bash runs the model's shell text as the host OS user.[^spec-l35][^spec-l292-l299] No remote executor API ships.[^spec-l108-l110] Moderate confidence: the fence and the SSH seam were read, and neither was executed. `sdk-minimal` is outside this base-bundle description.
5. **A workspace groups sessions for the GUI. The working directory is a session event.** The workspace registry is an ordered persistent list of project directories and the sessions run in each. It is invisible to models: no tools, no prompt, and no request-context cost. Removing a project leaves folders, files, and session logs in place. The package requires session persistence and storage.[^workspace-readme-l12] `working-directory/change` records the effective directory. The header keeps the original project.[^working-directory-l33-l39] `set()` changes that directory and leaves existing processes and permissions unchanged. `commit()` appends the event, then queues a user-role notice through `agent.inject`. A notice failure is logged, and the event remains.[^working-directory-l154-l205] The service registers required runtime context. Its text is `Current working directory:`, a space, the JSON-encoded directory, and a period.[^working-directory-l90-l96][^working-directory-l154-l205] `joinContextSections` joins the rendered context sections into a snapshot beginning `Current runtime context.`[^system-prompt-l314-l317] On the web hero, the composer textarea is disabled when there is no session, and also when the hero chip has no title. The placeholder key is `placeholder.workspace`, and the chip comment names that empty state "Choose workspace".[^conversation-l89-l96][^conversation-l137-l154] Picking a workspace calls `selectWorkspace`, which calls `workspaceNavigation.openWorkspace`.[^conversation-l123-l128][^apply-l358] Session creation itself is the controller path in item 2. llame ships no Workspace registry and no remote Workspace routing. An entered Workspace is an owner-scoped binding on the configured native executor.[^spec-l35] Starting a future CLI in a directory may create a placement grant for that directory. The grant covers no later model-selected Workspace. That CLI remains unselected backlog.[^vision-l186-l199][^roadmap-l171-l191] High confidence for the registry, the directory service, and the composer gate that were read. The browser picker was not exercised.
6. **Memory is an optional MCP overlay.** The user guide ships three default-off reference overlays: Memorix, the MCP reference memory server, and Engram, each enabled with `--patch`. The guide says the shipped composition contains no memory server. `dsh` parses the overlay, starts the configured stdio command or connects to a Streamable HTTP URL, and exposes discovered tools. The clean public name is `mcp__<serverName>__<tool>`. A name that character replacement or the 64-character `[A-Za-z0-9_-]` contract changes receives a 12-hex SHA-256 suffix.[^mcp-memory-l3-l31][^mcp-tools-l67-l86] The guide says `dsh` does not download the server, initialize its database, or choose an embedding provider. A stdio child starts from the ambient environment with names containing `KEY`, `PASSWORD`, `SECRET`, or `TOKEN`, and names that start with `DSH_` ignoring case, removed. The row's explicit `config.env` is merged after that scrub.[^mcp-memory-l3-l31][^subprocess-l47-l69][^mcp-transport-l15-l22] llame's memory stores are curated Markdown Knowledge, the database record of Chats and Runs, and optional semantic facts whose extraction remains deferred.[^vision-l66-l76] High confidence that this guide is an interoperability example. It is not a llame memory store.
7. **One provider id selects one adapter. The session log selects the next route.** Registering a second adapter for the same provider throws `DUPLICATE_ADAPTER`. A call whose provider has no adapter throws `NO_ADAPTER`.[^llm-index-l442-l443][^llm-index-l1016-l1018] The base bundle mounts `dsh-llm-pi-ai` dormant until an `llm-pi-ai` settings section supplies profiles. It also mounts the DeepSeek API-key adapter and the DeepSeek account adapter. No key is inlined; credentials resolve per request.[^base-patch-l128-l136][^base-patch-l516-l529] The Models guide stores keys write-only in `$DSH_HOME/.credentials.yaml`. A custom provider speaks one of `openai-completions`, `openai-responses`, or `anthropic-messages`. Selecting a model also becomes the default for new sessions. A session that has already sent a request retains the model recorded in its log.[^providers-l7-l41] `selectForNextRequest` appends `model/selection` and stores that selection for the next assembly. `selectionFor` uses a pending projection when one exists, otherwise the last request header's provider and model, skipping a reasoning effort the adapter defaulted, otherwise `agentDefaultModel.currentSelection()`.[^agent-ts-l289-l341] `currentSelection()` reads the configured provider and model. The base bundle's composition default is provider `deepseek-official` and model `deepseek-flash`. Settings may replace that selection. This note did not execute a fresh profile.[^agent-default-model-l67-l72][^base-patch-l88-l94] `installModelSelection` overwrites the resolved call's provider, model, and optional reasoning effort from the assembled selection. A provider or model change adds a user-role notice to the next admitted request.[^model-selection-l47-l124] The projection stores `model/selection` as pending. Every `request/header` replaces `lastUsed` with that header's provider, model, and reasoning effort when the header carries one. It clears `pending` only when provider, model, and reasoning effort all match. The wire view is `next = pending ?? lastUsed`.[^model-projection-l35-l66] Before this loop instance has logged a header, `prepareRequest` seeds the instance route and copies a persisted reasoning effort only when the header names that same provider and model and the adapter did not default the effort. After the instance has logged a header, the seed is that header with adapter-defaulted effort and max tokens removed. The `agent/request` listener can still overwrite the seed.[^agent-loop-l63-l69][^agent-loop-l571-l596] High confidence for the overlay and the base composition default. A settings override and a fresh-profile boot were not executed.
8. **Approval outcomes stay closed. A preset pairs a sandbox mode with ask or never.** `ApprovalOutcome` is `allowed-once`, `rejected`, `cancelled`, or `unavailable`. Callers fail closed on `unavailable`.[^approval-types-l28-l32] `request()` requires an open turn, appends `approval/asked`, and always follows it with `approval/decided`. An aborted signal becomes `cancelled`. Policy `never` becomes `rejected` before any answerer runs, including a prepended listener. A missing, throwing, or non-vocabulary answerer becomes `unavailable`. `overrideOf` walks the log backward and returns the policy on the last `approval/policy` event.[^approval-index-l215-l291] `ask` delegates to the answerer chain. `never` rejects without dispatch. The effective policy is that last event, then the service config.[^approval-doc-l21-l47] Preset names `custom` and `auto` are reserved: `custom` is the derived state when the knobs match no table entry, and `auto` is the Auto review integration. A configured table cannot use either name.[^permission-presets-l160-l217] The base table is the three pairs in item 4. The experimental auto-review bundle is one of the switched-off optional bundles, and this note does not describe its enforcement.[^base-patch-l234-l276][^profile-ts-l178-l235] llame ships operator allow/reject permissions and a per-Run `default | bypass` mode. An interactive approval workflow does not ship.[^spec-l77] Identity, credentials, authorization, approvals, and audit stay out of prompts. A `dsh` outcome is a question result inside that process. It is not llame authorization.[^vision-l78-l88] High confidence for the closed outcome set and the preset reservation. Auto-review behavior is unverified.

**Caution**

The developer-preview notice expects compatibility-breaking changes.[^readme-l5-l15] The inspected carriers are a single-owner local process, plus an optional SSH placement that shipped profiles leave unmounted.[^ssh-readme-l10-l12][^profile-ts-l178-l235] An approval outcome does not establish owner isolation. The file fence is trusted-code containment, and the local sandbox shares the host kernel.[^fs-sandbox-l1-l24][^sandbox-local-l11-l12] llame's compaction, approval, and Workspace contracts remain the ones in SPEC, VISION, and ROADMAP.[^spec-l43][^spec-l77][^spec-l35] Nothing in this note was executed.

[^readme-l5-l15]: [Plugin kernel, docs site, and developer-preview notice](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md#L5-L15)

[^readme-l75]: [MIT license link](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md#L75)

[^vision-l134-l139]: [Meta-harness ownership; ACP and peers stay north-star adapters](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L134-L139)

[^spec-l108-l110]: [Execution is pg-boss plus RunExecutionService; no Node protocol ships](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L108-L110)

[^roadmap-l171-l191]: [Standalone personal Node and CLI remain unselected backlog](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/ROADMAP.md#L171-L191)

[^profile-ts-l178-l235]: [Shipped profile templates and switched-off optional bundles](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/profile.ts#L178-L235)

[^profile-ts-l212-l213]: [dsh plugin init uses dsh-base when no template exists](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/profile.ts#L212-L213)

[^profile-ts-l794-l799]: [Booting a missing untemplated profile throws](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/profile.ts#L794-L799)

[^cli-readme-l9-l28]: [CLI profiles, invoking directory, reserved desktop name, and tui example](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/README.md#L9-L28)

[^cli-reference-l100-l102]: [Example install of turtle-ui into a tui profile](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/reference/README.md#L100-L102)

[^turtle-ui-repo]: [Public repository lookup returned HTTP 404 (unpinned)](https://github.com/deepseek-harness/turtle-ui)

[^web-patch-l173-l184]: [Web bind defaults to 127.0.0.1:3080 and rejects wildcard binds](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/web-app/cordis.patch.yml#L173-L184)

[^connection-readme-l34]: [Browser unary HTTP POST; Gateway owns the mux WebSocket](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/README.md#L34)

[^connection-readme-l47-l51]: [Wildcard bind is unsupported; API GET /connect exchanges a launch token](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/README.md#L47-L51)

[^browser-auth-l269-l286]: [GET / with a launch token sets a cookie and redirects to ./](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/browser-auth.ts#L269-L286)

[^browser-auth-l330-l341]: [API GET /connect sets a cookie and redirects to the mux](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/browser-auth.ts#L330-L341)

[^session-transport-l161-l203]: [Session follow opens on a snapshot and requires adjacent cursors](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/client/transport.ts#L161-L203)

[^desktop-readme-l35-l37]: [Electron shell, loopback port, and window-scoped WebSocket credentials](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L35-L37)

[^sdk-protocol-l1-l6]: [SDK wire is newline-delimited JSON-RPC over stdio](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/src/index.ts#L1-L6)

[^sdk-launch-l132-l143]: [TypeScript client launches dsh --profile sdk by default](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/client/src/launch.ts#L132-L143)

[^sdk-client-l214-l217]: [TypeScript client spawns the runtime with piped stdio](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/client/src/client.ts#L214-L217)

[^python-client-l25-l32]: [Python HarnessConfig.profile defaults to sdk](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/python/sdk/src/deepseek_harness/client.py#L25-L32)

[^python-client-l497-l512]: [Python requires an explicit DSH_HOME and appends --profile](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/python/sdk/src/deepseek_harness/client.py#L497-L512)

[^acp-index-l1-l7]: [ACP server is automation-only JSON-RPC stdio](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L1-L7)

[^acp-readme-l55-l80]: [ACP session/new, trusted controllers, and omitted surfaces](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#L55-L80)

[^headless-l225-l229]: [Headless resume rejects a header cwd that differs](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/src/index.ts#L225-L229)

[^headless-l344-l353]: [Headless creates a session in the resolved process directory](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/src/index.ts#L344-L353)

[^commands-l111-l149]: [Web session create accepts workspaceId or cwd, then attaches](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/commands.ts#L111-L149)

[^controller-l163]: [Session controller default cwd is process.cwd() at construction](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/index.ts#L163)

[^lease-l1-l19]: [One kernel write lease for the life of a write handle](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-persistence-jsonl/src/lease.ts#L1-L19)

[^session-types-l90-l106]: [Session format writer is 4; header.cwd is the creation directory](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts#L90-L106)

[^session-format-status-l31-l47]: [Released session format 4, evidence tag dsh-v0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/session-format-status.md#L31-L47)

[^session-index-l966-l1004]: [deriveMessages walks the surface and drops shadowed nodes](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/index.ts#L966-L1004)

[^session-doc-l5]: [Replay is re-derivation of the append-only log](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/session.md#L5)

[^compaction-region-l491-l509]: [Compaction appends a summary and a surface replace](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts#L491-L509)

[^compaction-doc-l9-l21]: [Compaction markers stay log-only; the summary rides a user message](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/compaction.md#L9-L21)

[^spec-l43]: [llame compaction is an RLS checkpoint; source messages stay unchanged](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L43)

[^agent-loop-l549-l554]: [The agent loop executes tool calls in process](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L549-L554)

[^base-patch-l234-l276]: [Base sandbox, approval policy, and permission presets](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L234-L276)

[^base-patch-l516-l529]: [Base mounts fs-sandbox and the DeepSeek adapters](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L516-L529)

[^fs-sandbox-l1-l24]: [File mutations are a trusted-code fence; reads pass through](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/fs/fs-sandbox/src/index.ts#L1-L24)

[^roots-ts-l43-l54]: [workspace-write allows the workspace root, /tmp, and os.tmpdir()](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox/src/roots.ts#L43-L54)

[^sandbox-l1-l30]: [Sandbox modes share the host kernel; remote execution replaces the seam](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox/src/index.ts#L1-L30)

[^sandbox-local-l11-l12]: [Local sandbox fails closed and reports full or partial enforcement](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox-local/README.md#L11-L12)

[^sandbox-policy-l164-l169]: [The workspace-write root is the session header cwd](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sandbox/sandbox-policy/src/index.ts#L164-L169)

[^session-cwd-l17-l24]: [File tools resolve paths from the session working directory](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/fs/tool-fs/src/session-cwd.ts#L17-L24)

[^ssh-readme-l10-l12]: [Optional POSIX SSH providers keep the harness local](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/ssh/README.md#L10-L12)

[^vision-l204-l206]: [Native execution is host-user authority, and sandbox failure stays failed](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L204-L206)

[^workspace-readme-l12]: [Workspace registry groups directories and sessions, invisible to models](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/workspace/workspace/README.md#L12)

[^working-directory-l33-l39]: [working-directory/change is the effective directory](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L33-L39)

[^working-directory-l90-l96]: [Working directory is a required runtime-context contribution](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L90-L96)

[^working-directory-l154-l205]: [set leaves processes and permissions; commit appends the event and a notice](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L154-L205)

[^system-prompt-l314-l317]: [Runtime context is a snapshot joined apart from prompt sections](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/system-prompt/src/index.ts#L314-L317)

[^conversation-l89-l96]: [Hero chip title falls back to a choose-workspace placeholder](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L89-L96)

[^conversation-l123-l128]: [Picking a workspace calls selectWorkspace](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L123-L128)

[^conversation-l137-l154]: [Hero composer stays disabled until a workspace title exists](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L137-L154)

[^apply-l358]: [selectWorkspace calls workspaceNavigation.openWorkspace](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/apply.ts#L358)

[^spec-l35]: [No Workspace registry, remote routing, or Sandbox object ships](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L35)

[^spec-l292-l299]: [Shipped bash is host-user authority](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L292-L299)

[^vision-l186-l199]: [A CLI start directory is a placement grant, not a model-chosen Workspace](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L186-L199)

[^mcp-memory-l3-l31]: [Memory is three default-off MCP overlays](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/guide/mcp-memory.md#L3-L31)

[^mcp-tools-l67-l86]: [MCP public names hash when they break the function-name contract](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/src/tools.ts#L67-L86)

[^mcp-transport-l15-l22]: [Stdio MCP env is the scrubbed parent plus explicit config.env](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/src/transport.ts#L15-L22)

[^subprocess-l47-l69]: [Child env drops credential-shaped names and DSH\_\*](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/subprocess/subprocess/src/index.ts#L47-L69)

[^vision-l66-l76]: [Knowledge, episodic memory, and deferred semantic facts](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L66-L76)

[^llm-index-l442-l443]: [A second adapter for the same provider throws](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/index.ts#L442-L443)

[^llm-index-l1016-l1018]: [A missing provider adapter is NO_ADAPTER](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/index.ts#L1016-L1018)

[^base-patch-l88-l94]: [Base default model is deepseek-official / deepseek-flash](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L88-L94)

[^base-patch-l128-l136]: [pi-ai stays dormant until settings supply profiles](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L128-L136)

[^providers-l7-l41]: [Models page, write-only keys, one protocol per provider, session retention](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/guide/providers.md#L7-L41)

[^agent-ts-l289-l341]: [Pending selection, then the last request header, then the configured default](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/agent.ts#L289-L341)

[^agent-default-model-l67-l72]: [currentSelection reads the configured provider and model](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-default-model/src/index.ts#L67-L72)

[^model-selection-l47-l124]: [agent/request overwrites the route; a provider change adds a user notice](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/model-selection.ts#L47-L124)

[^model-projection-l35-l66]: [model/selection is pending; a matching request header becomes lastUsed](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/model-selection-projection.ts#L35-L66)

[^agent-loop-l63-l69]: [A logged header seed drops adapter-defaulted effort and max tokens](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L63-L69)

[^agent-loop-l571-l596]: [prepareRequest seeds the instance route, then the logged header](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L571-L596)

[^approval-types-l28-l32]: [Closed approval outcomes](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-approval/src/types.ts#L28-L32)

[^approval-index-l215-l291]: [Open-turn audit, never-before-answerers, and fail-closed unavailable](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-approval/src/index.ts#L215-L291)

[^approval-doc-l21-l47]: [Ask and never; replay reconstructs the last policy event](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/approval.md#L21-L47)

[^permission-presets-l160-l217]: [custom and auto are reserved preset names](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/permission-presets/src/index.ts#L160-L217)

[^spec-l77]: [Operator permissions ship; interactive approval does not](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L77)

[^vision-l78-l88]: [The harness owns execution; approvals do not live in prompts](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L78-L88)
