---
type: Reference
title: "AgentOne"
description: "Desktop webview agent with no session workspace, transcript snapshots, and per-chat approval overlays"
resource: "https://github.com/The-Best-Codes/agent-one"
tags: [harness, desktop, tauri, approvals, workspace]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-16"
observed:
  date: "2026-10-16"
  revision: "bf36c259e448073c929fc03cbd9a499b758cfdf7"
sources:
  - id: readme-l38-l40
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/README.md#L38-L40"
    title: "Closed-source smart router, desktop app, no CLI"
  - id: readme-l72-l87
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/README.md#L72-L87"
    title: "Local tools, settings sync, per-chat YOLO, and the Tauri stack"
  - id: license-l1-l2
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/LICENSE#L1-L2"
    title: "GNU Affero General Public License heading"
  - id: website-home
    resource: "https://www.agent-one.dev"
    title: "Marketing claims for sync, local tools, and cloud runs"
  - id: docs-intro
    resource: "https://docs.agent-one.dev/docs"
    title: "Docs intro: settings sync now, chat and key sync later"
  - id: vision-md-l196-l199
    resource: "https://github.com/leon0399/llame/blob/a128882d0ecac5086ae0543200676c2535cc9ac3/VISION.md#L196-L199"
    title: "CLI start directory is a placement grant, not a model-chosen Workspace"
  - id: spec-md-l110
    resource: "https://github.com/leon0399/llame/blob/a128882d0ecac5086ae0543200676c2535cc9ac3/SPEC.md#L110"
    title: "No Node protocol or remote executor API ships"
  - id: roadmap-md-l171-l175
    resource: "https://github.com/leon0399/llame/blob/a128882d0ecac5086ae0543200676c2535cc9ac3/ROADMAP.md#L171-L175"
    title: "Standalone CLI remains unselected backlog"
  - id: custom-chat-transport-ts-l146-l193
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L146-L193"
    title: "sendMessages loads keys, tools, and the subagent context"
  - id: custom-chat-transport-ts-l309-l323
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L309-L323"
    title: "streamText call with local tools"
  - id: custom-chat-transport-ts-l221-l291
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L221-L291"
    title: "compact helper throws unless fallbackOnError is set"
  - id: get-url-content-ts-l90-l98
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/getUrlContent.ts#L90-L98"
    title: "getUrlContent invokes the Rust get_url_content command"
  - id: custom-chat-transport-ts-l325-l372
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L325-L372"
    title: "prepareStep compacts and replaces the model messages"
  - id: custom-chat-transport-ts-l410-l422
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L410-L422"
    title: "reconnectToStream returns null"
  - id: chat-instance-tsx-l66-l75
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-instance.tsx#L66-L75"
    title: "auto-send when approval responses complete the message"
  - id: chat-instance-tsx-l161-l170
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-instance.tsx#L161-L170"
    title: "persist messages only while the chat is not streaming"
  - id: chat-context-tsx-l293-l324
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L293-L324"
    title: "busy chats stay mounted across route changes"
  - id: chat-context-tsx-l471-l480
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L471-L480"
    title: "pending programmatic message is sent when the chat is ready"
  - id: chat-context-tsx-l371-l405
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L371-L405"
    title: "scheduled run creates a new chat and a pending message"
  - id: chat-context-tsx-l535-l560
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L535-L560"
    title: "stop or error rewrites unfinished tool parts"
  - id: chat-context-tsx-l563-l568
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L563-L568"
    title: "stop or error drops a compaction part that is not done"
  - id: constants-ts-l2-l4
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/constants.ts#L2-L4"
    title: "cancel sentinel and interruption string"
  - id: chat-context-tsx-l643-l646
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L643-L646"
    title: "approval handler calls addToolApprovalResponse"
  - id: persistence-context-tsx-l223-l241
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-persistence/persistence-context.tsx#L223-L241"
    title: "createChat stores metadata and an empty message array"
  - id: persistence-context-tsx-l289-l298
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-persistence/persistence-context.tsx#L289-L298"
    title: "saveChat writes the full message array"
  - id: persistence-context-tsx-l452-l486
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-persistence/persistence-context.tsx#L452-L486"
    title: "branch copies the message prefix into a new chat"
  - id: chat-storage-ts-l263-l268
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/storage/chat-storage.ts#L263-L268"
    title: "messages stored as one JSON blob"
  - id: migrations-0001-l15-l18
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/migrations/0001_create_tables.sql#L15-L18"
    title: "chat_messages table"
  - id: deep-link-handler-tsx-l137-l158
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/deep-link-handler.tsx#L137-L158"
    title: "cron deep link starts a new chat"
  - id: cron-rs-l217-l241
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/utils/cron.rs#L217-L241"
    title: "get_cron_invocation returns none when the cron is missing or the firing is late"
  - id: cron-rs-l500-l502
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/utils/cron.rs#L500-L502"
    title: "scheduled agent URL is an agent-one deep link"
  - id: path-ts-l1-l12
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/utils/path.ts#L1-L12"
    title: "resolvePath expands a leading tilde only"
  - id: view-file-ts-l12-l37
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/viewFile.ts#L12-L37"
    title: "viewFile reads the resolved path with the fs plugin"
  - id: edit-file-ts-l12-l42
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/editFile.ts#L12-L42"
    title: "editFile writes the resolved path with the fs plugin"
  - id: execute-command-ts-l125-l137
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/executeCommand.ts#L125-L137"
    title: "executeCommand schema has no working directory"
  - id: execute-command-ts-l241-l249
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/executeCommand.ts#L241-L249"
    title: "spawnCommand is called without cwd"
  - id: run-command-ts-l31-l48
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/run-command.ts#L31-L48"
    title: "platform shell and optional cwd"
  - id: lib-rs-l29-l41
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/lib.rs#L29-L41"
    title: "PATH repair and ignored second-instance cwd"
  - id: lib-rs-l222-l251
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/lib.rs#L222-L251"
    title: "desktop invoke handler, including web search, URL fetch, and the keyring"
  - id: lib-rs-l88-l94
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/lib.rs#L88-L94"
    title: "HTTP, WebSocket, dialog, fs, and shell plugins"
  - id: vite-config-ts-l94-l110
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/vite.config.ts#L94-L110"
    title: "Vite names the WebSocket plugin only in a manual chunk list"
  - id: capabilities-default-json-l16-l65
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/capabilities/default.json#L16-L65"
    title: "shell allow-list and filesystem scope"
  - id: capabilities-default-json-l86
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/capabilities/default.json#L86"
    title: "websocket capability granted to the main window"
  - id: tools-context-tsx-l85-l101
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-tools/tools-context.tsx#L85-L101"
    title: "approval overlay, with describeNextTool exempt"
  - id: tools-context-tsx-l286-l295
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-tools/tools-context.tsx#L286-L295"
    title: "MCP tools take the server approval config, then a name prefix"
  - id: tools-context-tsx-l629-l639
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-tools/tools-context.tsx#L629-L639"
    title: "ask and yolo rewrite the merged tool set"
  - id: definitions-ts-l80-l106
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/settings/definitions.ts#L80-L106"
    title: "default per-tool requiresApproval flags"
  - id: update-setting-ts-l30-l33
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/updateSetting.ts#L30-L33"
    title: "updateSetting rejects a key that is not ai write"
  - id: settings-atoms-ts-l25-l32
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/jotai/settings-atoms.ts#L25-L32"
    title: "setting atom write marks the key dirty for sync"
  - id: definitions-ts-l14-l18
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/settings/definitions.ts#L14-L18"
    title: "optional ai read or write flag on a setting"
  - id: definitions-ts-l466-l493
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/settings/definitions.ts#L466-L493"
    title: "MEMORY setting and the YOLO confirmation toggle"
  - id: atoms-ts-l79-l108
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/jotai/atoms.ts#L79-L108"
    title: "system prompt includes memory and the YOLO instruction"
  - id: memory-ts-l1-l34
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/memory.ts#L1-L34"
    title: "memory entry caps and sanitizing"
  - id: memory-tool-ts-l30-l86
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/memory.ts#L30-L86"
    title: "memory tool writes the MEMORY setting on add, remove, and replace"
  - id: settings-sync-manager-ts-l89-l100
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/sync/settings-sync-manager.ts#L89-L100"
    title: "markDirty records a timestamp and skips the dirty set when sync is off"
  - id: settings-sync-manager-ts-l152-l184
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/sync/settings-sync-manager.ts#L152-L184"
    title: "signed-in settings push"
  - id: settings-sync-manager-ts-l244-l268
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/sync/settings-sync-manager.ts#L244-L268"
    title: "pull applies the newer timestamp"
  - id: registry-ts-l19-l26
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/registry.ts#L19-L26"
    title: "AgentOne OpenAI-compatible endpoint"
  - id: openai-ts-l5-l10
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/openai.ts#L5-L10"
    title: "OpenAI factory calls createOpenAI and sets no base URL"
  - id: anthropic-ts-l17-l22
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/anthropic.ts#L17-L22"
    title: "Anthropic factory calls createAnthropic and sets no base URL"
  - id: google-ts-l5-l10
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/google.ts#L5-L10"
    title: "Google factory calls createGoogle and sets no base URL"
  - id: openai-compatible-ts-l5-l24
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/openai-compatible.ts#L5-L24"
    title: "shared OpenAI-compatible factory"
  - id: provider-fetch-ts-l1-l15
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/provider-fetch.ts#L1-L15"
    title: "provider fetch clears Origin"
  - id: model-directory-ts-l97-l100
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/models/model-directory.ts#L97-L100"
    title: "built-in directory replaces downloaded keys"
  - id: model-directory-ts-l149-l160
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/models/model-directory.ts#L149-L160"
    title: "directory download uses the GitHub raw URL"
  - id: model-directory-startup-sync-tsx-l23-l66
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/components/a1/model-directory-startup-sync.tsx#L23-L66"
    title: "hourly check downloads a missing or stale directory"
  - id: model-directory-ts-l11-l93
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/models/model-directory.ts#L11-L93"
    title: "directory URL and the built-in auto model"
  - id: use-model-catalog-ts-l105-l110
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L105-L110"
    title: "Groq preferred id, also exported as DEFAULT_CHAT_MODEL_ID"
  - id: use-model-catalog-ts-l345-l372
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L345-L372"
    title: "smart default walks enabled providers in registry order"
  - id: use-model-catalog-ts-l377-l387
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L377-L387"
    title: "catalog hook returns DEFAULT_CHAT_MODEL_ID"
  - id: model-context-tsx-l25-l36
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-model/model-context.tsx#L25-L36"
    title: "new chat uses the saved id, then the smart default"
  - id: provider-atoms-ts-l23-l27
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/jotai/provider-atoms.ts#L23-L27"
    title: "stored provider config defaults to disabled"
  - id: use-model-catalog-ts-l97-l98
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L97-L98"
    title: "tool behavior defaults to default"
  - id: use-model-catalog-ts-l184-l194
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L184-L194"
    title: "only agent-one-auto is listed for the AgentOne provider"
  - id: local-provider-factory-ts-l6-l13
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/local-provider-factory.ts#L6-L13"
    title: "local providers are OpenAI-compatible base URLs"
  - id: auth-client-ts-l9-l48
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/auth/auth-client.ts#L9-L48"
    title: "better-auth client and device-authorization plugin"
  - id: web-auth-context-tsx-l106-l122
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-web-auth/web-auth-context.tsx#L106-L122"
    title: "signed-in client loads billing through authClient.customer.state"
  - id: web-auth-context-tsx-l40-l53
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-web-auth/web-auth-context.tsx#L40-L53"
    title: "a valid access token becomes the AgentOne API key"
  - id: web-auth-context-tsx-l160-l183
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-web-auth/web-auth-context.tsx#L160-L183"
    title: "device-code poll stores the access token"
  - id: keyring-rs-l402-l426
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/keyring.rs#L402-L426"
    title: "keyring write, with a length-limit ciphertext fallback"
  - id: mcp-index-ts-l47-l117
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L47-L117"
    title: "stdio MCP is newline JSON-RPC on a shell child"
  - id: mcp-index-ts-l212-l237
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L212-L237"
    title: "HTTP MCP posts JSON-RPC and stores mcp-session-id"
  - id: mcp-index-ts-l242-l256
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L242-L256"
    title: "an event-stream HTTP MCP response can carry more than one message"
  - id: mcp-index-ts-l329-l345
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L329-L345"
    title: "HTTP MCP close sends DELETE with the session id"
  - id: mcp-index-ts-l685-l697
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L685-L697"
    title: "prefixMcpToolNames template"
  - id: sub-agent-ts-l81-l83
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L81-L83"
    title: "subagent prompt forbids nested subagents"
  - id: sub-agent-ts-l293-l310
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L293-L310"
    title: "subagent tool set drops subAgent"
  - id: sub-agent-ts-l177-l197
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L177-L197"
    title: "waitForApprovalResponse stores an in-memory waiter"
  - id: sub-agent-ts-l333-l349
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L333-L349"
    title: "subagent streamText has no compaction step"
  - id: sub-agent-ts-l382-l416
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L382-L416"
    title: "nested approvals wait on an in-memory map"
  - id: compaction-ts-l40-l54
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/compaction.ts#L40-L54"
    title: "summary instructions and request"
  - id: compaction-ts-l123-l169
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/compaction.ts#L123-L169"
    title: "later turns send the tail after the latest summary"
  - id: compaction-ts-l235-l246
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/compaction.ts#L235-L246"
    title: "failed compaction points the model at readChat"
  - id: web-search-ts-l76-l83
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/webSearch.ts#L76-L83"
    title: "webSearch invokes the Rust web_search command"
  - id: web-search-rs-l50-l65
    resource: "https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/tools/web_search.rs#L50-L65"
    title: "Rust web_search command"
---

# AgentOne

- **Stack:** Tauri 2 (Rust) desktop shell, React 19 webview, Vercel AI SDK, SQLite; AGPL-3.0[^license-l1-l2][^readme-l72-l87]

**Status:** Source inspection of `bf36c259e448073c929fc03cbd9a499b758cfdf7` (v1.1.2). The app was not run. The homepage and docs intro were read as live pages and are not commit-pinned.

AgentOne is a single-user desktop app. The README says there are no plans for a CLI. The model loop, `streamText`, runs in the webview.[^readme-l38-l40][^custom-chat-transport-ts-l309-l323] That is a useful contrast for a later personal CLI. A CLI Run advertises only the directory where it was started, and that advertisement is a placement grant, not a Workspace the model can choose.[^vision-md-l196-l199] No Node protocol or remote executor API ships, and the standalone CLI remains unselected backlog.[^spec-md-l110][^roadmap-md-l171-l175] AgentOne keeps the screen and the model loop in the desktop webview. File, shell, search, and fetch calls leave that webview through Tauri IPC. A chat is never bound to a workspace root. This note did not measure whether the webview and the Rust shell are separate OS processes.

**Study**

1. **The model loop stays in the webview, and built-in tools cross Tauri IPC.** `CustomChatTransport.sendMessages` awaits API keys, builds the tool set, and passes `toolBehavior` into the subagent context.[^custom-chat-transport-ts-l146-l193] It then calls `streamText` in the webview.[^custom-chat-transport-ts-l309-l323] Rust registers the commands the webview invokes, including web search, URL fetch, and the keyring.[^lib-rs-l222-l251][^web-search-ts-l76-l83][^get-url-content-ts-l90-l98] `reconnectToStream` returns null. The comment says resume is unimplemented because the implementation is frontend-only.[^custom-chat-transport-ts-l410-l422] `tauri_plugin_websocket` is initialized and the main window is granted `websocket:default`.[^lib-rs-l88-l94][^capabilities-default-json-l86] No module under `src/` or `src-tauri/` imports it. Vite only names the package in `vendorManualChunks`.[^vite-config-ts-l94-l110] The JSON-RPC in this tree is MCP. Stdio MCP is a shell child of the desktop app. HTTP MCP is a remote session to the configured URL. Neither is the chat session. HTTP MCP does keep `mcp-session-id` with its own server.[^mcp-index-ts-l47-l117][^mcp-index-ts-l212-l237] High confidence as a negative example: do not look here for a CLI attach or a session WebSocket. Built-in tool side effects are Tauri IPC. HTTP MCP tools run at the server URL, and that URL is not the chat session.
2. **A chat is a SQLite document, and a live stream is not replayed.** `createChat` mints an id and stores metadata plus an empty message array.[^persistence-context-tsx-l223-l241][^migrations-0001-l15-l18] `saveChat` writes the whole `UIMessage` array as one JSON blob.[^persistence-context-tsx-l289-l298][^chat-storage-ts-l263-l268] The chat instance calls that save only when status is not `streaming`, and it skips the write when the id is no longer in the chat list.[^chat-instance-tsx-l161-l170] A chat stays mounted while it is the open route, while a programmatic message is pending, or while its status is streaming, submitted, or error.[^chat-context-tsx-l293-l324] Branching copies the message prefix into a new id. It does not fork a run.[^persistence-context-tsx-l452-l486] A scheduled agent is a deep link, `agent-one://cron`. The handler creates another chat only when `get_cron_invocation` returns an invocation. A missing or disabled cron, and a firing later than the delay cutoff, return none, and the handler stops. A `cron-test` invocation only shows a toast. A scheduled-agent invocation stores the prompt. An effect sends that prompt once the new chat's status is ready. It does not resume the chat that created the schedule.[^cron-rs-l500-l502][^cron-rs-l217-l241][^deep-link-handler-tsx-l137-l158][^chat-context-tsx-l371-l405][^chat-context-tsx-l471-l480] Reload constructs `useChat` from the stored messages. There is no event sequence and no since-cursor. A turn still streaming is not in that snapshot. The AI SDK status while an approval is pending was not confirmed, so this note does not claim the pending approval is on disk, and the approval buttons after a restart were not exercised. Moderate confidence as a lesson: persist the open question with the run. A snapshot skipped while status is streaming drops the live tail. A status of `submitted` can still be written.
3. **There is no session workspace.** File tools expand a leading `~` and otherwise pass the model path through.[^path-ts-l1-l12] `viewFile` and `editFile` then call the Tauri fs plugin on that string.[^view-file-ts-l12-l37][^edit-file-ts-l12-l42] `executeCommand` has no working-directory argument and calls `spawnCommand` without `cwd`.[^execute-command-ts-l125-l137][^execute-command-ts-l241-l249] The shell is `cmd`, `zsh`, or `sh` by platform, and `cwd` is set only when the caller passes one.[^run-command-ts-l31-l48] The main-window capability allows those three binaries with arbitrary arguments, and the filesystem scope is `**`, including dotfiles.[^capabilities-default-json-l16-l65] The single-instance handler receives the second process's cwd and ignores it. Startup calls `fix_path_env::fix()` and logs if that call fails. That is a `PATH` repair, not a workspace.[^lib-rs-l29-l41] Unverified: the directory plugin-shell uses when `cwd` is omitted, and how plugin-fs resolves a relative path, were not read from plugin source. High confidence as a lesson: do not invent a Workspace from an absent path. A CLI start directory is an advertised placement grant, separate from a Workspace the model can choose.[^vision-md-l196-l199]
4. **Built-in tool wrappers run next to the model, and their side effects leave the webview.** File and shell tools call Tauri plugins. `webSearch` and `getUrlContent` invoke Rust commands.[^web-search-ts-l76-l83][^web-search-rs-l50-l65][^get-url-content-ts-l90-l98] Stdio MCP spawns a shell child and exchanges newline-delimited JSON-RPC on its stdin and stdout, with no `cwd`.[^mcp-index-ts-l47-l117][^run-command-ts-l31-l48] Each HTTP MCP request body is one JSON-RPC message. A later request sends `mcp-session-id` and a bearer token when those exist, and the response session id is stored. A `text/event-stream` body can carry more than one JSON-RPC message. Close sends `DELETE` with the session id.[^mcp-index-ts-l212-l237][^mcp-index-ts-l242-l256][^mcp-index-ts-l329-l345] Loaded MCP tools are renamed with the `mcp__` prefix, the server slug, and `__` after their approval flags are applied.[^mcp-index-ts-l685-l697][^tools-context-tsx-l286-l295] Calls this client makes to `www.agent-one.dev` include auth, billing, settings sync, and one OpenAI-compatible model endpoint.[^auth-client-ts-l9-l48][^web-auth-context-tsx-l106-l122][^registry-ts-l19-l26][^settings-sync-manager-ts-l152-l184] High confidence as a negative example: these MCP transports are extension channels, not a chat session between a UI and an API. Where tools run, and which channel reaches them, is not settled here.[^spec-md-l110] Stdio MCP is a local extension channel. HTTP MCP is remote JSON-RPC to the configured server URL.
5. **Approval is a per-chat overlay on stored per-tool flags.** Defaults require approval for file create, edit, and delete, the shell, subagents, scheduled-agent create, update, and delete, setting writes, and chat search and read. `viewFile`, `memory`, `webSearch`, `getUrlContent`, `dateTime`, `waitNumberMilliseconds`, `wikipedia`, `listSettings`, `getSetting`, and `listScheduledAgents` do not.[^definitions-ts-l80-l106] `toolBehavior` defaults to `default`, which leaves those flags.[^use-model-catalog-ts-l97-l98] `ask` rewrites every merged tool to `needsApproval: true`, and `yolo` rewrites them to false, except `describeNextTool`, which stays false.[^tools-context-tsx-l85-l101][^tools-context-tsx-l629-l639] MCP servers apply `requiresApproval` and per-tool overrides first. A later ask or yolo pass overwrites that result.[^tools-context-tsx-l286-l295][^tools-context-tsx-l629-l639] The UI records the answer with `addToolApprovalResponse`. The chat sends again when the last assistant message is complete with those responses.[^chat-context-tsx-l643-l646][^chat-instance-tsx-l66-l75] When status returns to `ready` or `error` after `streaming` or `submitted`, parts in `approval-responded`, `input-streaming`, `input-available`, or preliminary `output-available` are rewritten to `output-error`. On `ready` the error text is the sentinel `agent-one::cancelled-by-user`. On `error` it is an interruption string. The same path drops a compaction part whose status is not `done`. `approval-requested` is left as it is.[^chat-context-tsx-l535-l560][^chat-context-tsx-l563-l568][^constants-ts-l2-l4] The parent transport passes `toolBehavior` into the subagent's `getTools`. The subagent then drops `subAgent`. Nested approvals wait on an in-memory map keyed by approval id.[^custom-chat-transport-ts-l146-l193][^sub-agent-ts-l81-l83][^sub-agent-ts-l293-l310][^sub-agent-ts-l177-l197][^sub-agent-ts-l382-l416] The system prompt tells the model it cannot switch the chat to YOLO. `CONFIRM_YOLO_MODE` defaults on.[^atoms-ts-l79-l108][^definitions-ts-l466-l493] The shell gate is the capability allow-list of three shells, not a command policy.[^capabilities-default-json-l16-l65] Moderate confidence for llame: a chat-scoped mode that overlays stored policy at call time is the piece to study. The in-memory subagent waiter does not survive the process, and YOLO is a bypass the model must not be able to set on a remote API.
6. **Memory is a settings list rendered into the system prompt.** Entries are capped at 100, trimmed to 500 characters, whitespace-collapsed, and deduped case-insensitively.[^memory-ts-l1-l34] The memory tool writes the `MEMORY` setting directly on add, remove, and replace.[^memory-tool-ts-l30-l86] The system prompt renders the list as `## User memory` bullets and tells the model to store stable facts without mentioning the write.[^atoms-ts-l79-l108] `MEMORY` has no `ai` access flag. `updateSetting` throws unless the key is marked `ai: "write"`.[^definitions-ts-l14-l18][^definitions-ts-l466-l493][^update-setting-ts-l30-l33] When sync is enabled and a token is present, dirty settings are `PUT` to `/api/sync/settings`. A pull applies a server value when its timestamp is greater than the local one, or when the local key has no timestamp.[^settings-sync-manager-ts-l152-l184][^settings-sync-manager-ts-l244-l268] Every setting write, including `MEMORY`, calls `markDirty`, which records a timestamp. The key joins the dirty set only while sync is enabled, so a memory-tool update is in the next payload only then.[^settings-atoms-ts-l25-l32][^settings-sync-manager-ts-l89-l100] Chat transcripts are not in that payload. The homepage says chats, settings, and encrypted API keys sync, and it lists chat sync, encrypted API-key sync, and cloud agent runs as paid betas.[^website-home] The docs intro says settings sync exists and that chat and encrypted API-key sync are coming soon.[^docs-intro] This revision implements settings sync only. The device-flow access token is stored in the OS keyring and copied into the AgentOne provider key. A secret that exceeds the keyring length limit is stored as SQLite ciphertext, with the encryption key in a second keyring entry.[^web-auth-context-tsx-l40-l53][^web-auth-context-tsx-l160-l183][^keyring-rs-l402-l426] Unverified: whether the hosted settings store encrypts values. High confidence that this memory is prompt text, not a tenant store. A short list is a reasonable shape. Wrap it as untrusted reference, and do not sync it as a last-write-wins blob without an owner.
7. **AgentOne `auto` is not a client-side route, and the other catalog entries are.** Stored provider configs default to enabled false. A valid sign-in enables the AgentOne provider.[^provider-atoms-ts-l23-l27][^web-auth-context-tsx-l40-l53] A new chat uses the saved model id when that id is still an enabled chat model. Otherwise `getSmartDefaultChatModel` walks `PROVIDER_REGISTRY` and returns the first enabled provider's preferred model, then that provider's first enabled chat model.[^model-context-tsx-l25-l36][^use-model-catalog-ts-l345-l372] `DEFAULT_CHAT_MODEL_ID` is `groq-moonshotai/kimi-k2-instruct-0905`, the same string as the Groq preferred id. The catalog hook returns it. No other file in this tree names it.[^use-model-catalog-ts-l105-l110][^use-model-catalog-ts-l377-l387] A startup check runs every hour. It downloads a directory file from a GitHub raw URL when no directory is loaded or the saved copy is older than 24 hours.[^model-directory-ts-l11-l93][^model-directory-ts-l149-l160][^model-directory-startup-sync-tsx-l23-l66] The downloaded object is spread first and the built-in directory second, so the built-in `agent-one` entry replaces a downloaded provider with that id. That entry exposes one model, `auto` (`agent-one-auto`), with a 256000-token context window. The catalog keeps that provider's model only when the directory id is `agent-one-auto`. The id stored on the catalog entry is `agent-one-agent-one-auto`.[^model-directory-ts-l97-l100][^model-directory-ts-l11-l93][^use-model-catalog-ts-l184-l194] The provider is an OpenAI-compatible client of `https://www.agent-one.dev/api/openai-compat/v1`. An empty key is sent as `not-authenticated`.[^registry-ts-l19-l26][^openai-compatible-ts-l5-l24] That factory also builds the other OpenAI-compatible catalog entries, each with its own base URL. It is not every built-in. OpenAI calls `createOpenAI` and sets no base URL. Anthropic and Google do the same with their SDKs.[^openai-ts-l5-l10][^anthropic-ts-l17-l22][^google-ts-l5-l10] `providerFetch` sets `Origin` to an empty string when the request does not already have one, because the Tauri HTTP plugin would otherwise attach the webview origin.[^provider-fetch-ts-l1-l15] Local models are another OpenAI-compatible base URL with api key `not-required`.[^local-provider-factory-ts-l6-l13] Sign-in is the OAuth device-code grant against better-auth on `https://www.agent-one.dev`.[^auth-client-ts-l9-l48][^web-auth-context-tsx-l160-l183] The README calls the smart router closed-source.[^readme-l38-l40] This tree has no policy that maps `auto` to a vendor model. Choosing Groq, OpenAI, Anthropic, Google, or another catalog entry selects that provider and model on the client. Moderate confidence for llame: a live catalog over a small floor is familiar. An `auto` id is not evidence of client-side routing, and a stored wire format cannot be inferred from it.
8. **Compaction in the main transport is a transcript part, and that model sees only the tail.** The summary instructions tell the model to record goals, decisions, and unfinished work, and that it cannot see the system prompt or tools.[^compaction-ts-l40-l54] `prepareStep` summarizes with the same model, writes a `data-compaction` part, and continues from the summary alone.[^custom-chat-transport-ts-l325-l372] Later sends keep the stored transcript. The model receives a new leading user message that contains only the summary, followed by the messages after the compaction part. The summary is prepended to an existing user message only when that tail already starts with one.[^compaction-ts-l123-l169] A failed automatic compaction still writes a compaction part. Its text says no summary is available, names `readChat` with this chat id, and warns that the latest messages may not be saved yet.[^compaction-ts-l235-l246] A manual compact that fails throws instead of writing that fallback. `fallbackOnError` defaults to false, and the explicit compact request does not set it.[^custom-chat-transport-ts-l221-l291] A subagent calls `streamText` on its own messages and does not run this compaction step.[^sub-agent-ts-l333-l349] High confidence as a shape for the main transport: an explicit marker, a prefix the model no longer sees, and a failure that names a reader for the stored transcript. llame's compaction spec still wins. The summary is model-written, and it is not a checkpoint of files.

**Caution:** The license is AGPL-3.0, so this note is a behavior study and not a source to copy.[^license-l1-l2] The local database has no tenant model and no row security. Shell and filesystem capabilities cover the host, not a workspace.[^capabilities-default-json-l16-l65] Memory enters the system prompt as bullets. The model is told to personalize from them and to write new facts without mentioning the write. A compaction summary is inserted as a user message that presents itself as the prior history. Neither instruction says to trust that text.[^atoms-ts-l79-l108][^compaction-ts-l40-l54][^compaction-ts-l123-l169] Homepage claims for cloud agent runs, chat sync, and encrypted API-key sync are absent from this revision. The docs intro disagrees with the homepage on chat and key sync.[^website-home][^docs-intro] Nothing in this note was executed.

[^readme-l38-l40]: [Desktop app, no CLI, closed-source smart router](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/README.md#L38-L40)

[^readme-l72-l87]: [Local tools, settings sync, per-chat YOLO, and the Tauri stack](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/README.md#L72-L87)

[^license-l1-l2]: [GNU Affero General Public License heading](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/LICENSE#L1-L2)

[^website-home]: [Marketing claims for sync, local tools, and cloud runs](https://www.agent-one.dev)

[^docs-intro]: [Docs intro: settings sync now, chat and key sync later](https://docs.agent-one.dev/docs)

[^vision-md-l196-l199]: [CLI start directory is a placement grant, not a model-chosen Workspace](https://github.com/leon0399/llame/blob/a128882d0ecac5086ae0543200676c2535cc9ac3/VISION.md#L196-L199)

[^spec-md-l110]: [No Node protocol or remote executor API ships](https://github.com/leon0399/llame/blob/a128882d0ecac5086ae0543200676c2535cc9ac3/SPEC.md#L110)

[^roadmap-md-l171-l175]: [Standalone CLI remains unselected backlog](https://github.com/leon0399/llame/blob/a128882d0ecac5086ae0543200676c2535cc9ac3/ROADMAP.md#L171-L175)

[^custom-chat-transport-ts-l146-l193]: [`sendMessages` loads keys, tools, and the subagent context](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L146-L193)

[^custom-chat-transport-ts-l309-l323]: [`streamText` call with local tools](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L309-L323)

[^custom-chat-transport-ts-l221-l291]: [`compact` helper throws unless `fallbackOnError` is set](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L221-L291)

[^get-url-content-ts-l90-l98]: [`getUrlContent` invokes the Rust `get_url_content` command](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/getUrlContent.ts#L90-L98)

[^custom-chat-transport-ts-l325-l372]: [`prepareStep` compacts and replaces the model messages](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L325-L372)

[^custom-chat-transport-ts-l410-l422]: [`reconnectToStream` returns null](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/custom-chat-transport.ts#L410-L422)

[^chat-instance-tsx-l66-l75]: [auto-send when approval responses complete the message](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-instance.tsx#L66-L75)

[^chat-instance-tsx-l161-l170]: [persist messages only while the chat is not streaming](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-instance.tsx#L161-L170)

[^chat-context-tsx-l293-l324]: [busy chats stay mounted across route changes](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L293-L324)

[^chat-context-tsx-l371-l405]: [scheduled run creates a new chat and a pending message](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L371-L405)

[^chat-context-tsx-l471-l480]: [pending programmatic message is sent when the chat is ready](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L471-L480)

[^chat-context-tsx-l535-l560]: [stop or error rewrites unfinished tool parts](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L535-L560)

[^chat-context-tsx-l563-l568]: [stop or error drops a compaction part that is not done](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L563-L568)

[^constants-ts-l2-l4]: [cancel sentinel and interruption string](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/constants.ts#L2-L4)

[^chat-context-tsx-l643-l646]: [approval handler calls `addToolApprovalResponse`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-chat/chat-context.tsx#L643-L646)

[^persistence-context-tsx-l223-l241]: [`createChat` stores metadata and an empty message array](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-persistence/persistence-context.tsx#L223-L241)

[^persistence-context-tsx-l289-l298]: [`saveChat` writes the full message array](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-persistence/persistence-context.tsx#L289-L298)

[^persistence-context-tsx-l452-l486]: [branch copies the message prefix into a new chat](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-persistence/persistence-context.tsx#L452-L486)

[^chat-storage-ts-l263-l268]: [messages stored as one JSON blob](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/storage/chat-storage.ts#L263-L268)

[^migrations-0001-l15-l18]: [`chat_messages` table](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/migrations/0001_create_tables.sql#L15-L18)

[^deep-link-handler-tsx-l137-l158]: [cron deep link starts a new chat](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/deep-link-handler.tsx#L137-L158)

[^cron-rs-l217-l241]: [`get_cron_invocation` returns none when the cron is missing or the firing is late](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/utils/cron.rs#L217-L241)

[^cron-rs-l500-l502]: [scheduled agent URL is an `agent-one` deep link](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/utils/cron.rs#L500-L502)

[^path-ts-l1-l12]: [`resolvePath` expands a leading tilde only](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/utils/path.ts#L1-L12)

[^view-file-ts-l12-l37]: [`viewFile` reads the resolved path with the fs plugin](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/viewFile.ts#L12-L37)

[^edit-file-ts-l12-l42]: [`editFile` writes the resolved path with the fs plugin](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/editFile.ts#L12-L42)

[^execute-command-ts-l125-l137]: [`executeCommand` schema has no working directory](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/executeCommand.ts#L125-L137)

[^execute-command-ts-l241-l249]: [`spawnCommand` is called without `cwd`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/executeCommand.ts#L241-L249)

[^run-command-ts-l31-l48]: [platform shell and optional `cwd`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/run-command.ts#L31-L48)

[^lib-rs-l29-l41]: [`PATH` repair and ignored second-instance cwd](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/lib.rs#L29-L41)

[^lib-rs-l222-l251]: [desktop invoke handler, including web search, URL fetch, and the keyring](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/lib.rs#L222-L251)

[^lib-rs-l88-l94]: [HTTP, WebSocket, dialog, fs, and shell plugins](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/lib.rs#L88-L94)

[^vite-config-ts-l94-l110]: [Vite names the WebSocket plugin only in a manual chunk list](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/vite.config.ts#L94-L110)

[^capabilities-default-json-l16-l65]: [shell allow-list and filesystem scope](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/capabilities/default.json#L16-L65)

[^capabilities-default-json-l86]: [`websocket` capability granted to the main window](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/capabilities/default.json#L86)

[^tools-context-tsx-l85-l101]: [approval overlay, with `describeNextTool` exempt](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-tools/tools-context.tsx#L85-L101)

[^tools-context-tsx-l286-l295]: [MCP tools take the server approval config, then a name prefix](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-tools/tools-context.tsx#L286-L295)

[^tools-context-tsx-l629-l639]: [`ask` and `yolo` rewrite the merged tool set](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-tools/tools-context.tsx#L629-L639)

[^definitions-ts-l80-l106]: [default per-tool `requiresApproval` flags](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/settings/definitions.ts#L80-L106)

[^update-setting-ts-l30-l33]: [`updateSetting` rejects a key that is not `ai` write](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/updateSetting.ts#L30-L33)

[^settings-atoms-ts-l25-l32]: [setting atom write marks the key dirty for sync](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/jotai/settings-atoms.ts#L25-L32)

[^definitions-ts-l14-l18]: [optional `ai` read or write flag on a setting](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/settings/definitions.ts#L14-L18)

[^definitions-ts-l466-l493]: [`MEMORY` setting and the YOLO confirmation toggle](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/settings/definitions.ts#L466-L493)

[^atoms-ts-l79-l108]: [system prompt includes memory and the YOLO instruction](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/jotai/atoms.ts#L79-L108)

[^memory-ts-l1-l34]: [memory entry caps and sanitizing](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/memory.ts#L1-L34)

[^memory-tool-ts-l30-l86]: [memory tool writes the `MEMORY` setting on add, remove, and replace](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/memory.ts#L30-L86)

[^settings-sync-manager-ts-l89-l100]: [`markDirty` records a timestamp and skips the dirty set when sync is off](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/sync/settings-sync-manager.ts#L89-L100)

[^settings-sync-manager-ts-l152-l184]: [signed-in settings push](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/sync/settings-sync-manager.ts#L152-L184)

[^settings-sync-manager-ts-l244-l268]: [pull applies the newer timestamp](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/sync/settings-sync-manager.ts#L244-L268)

[^registry-ts-l19-l26]: [AgentOne OpenAI-compatible endpoint](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/registry.ts#L19-L26)

[^openai-ts-l5-l10]: [OpenAI factory calls `createOpenAI` and sets no base URL](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/openai.ts#L5-L10)

[^anthropic-ts-l17-l22]: [Anthropic factory calls `createAnthropic` and sets no base URL](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/anthropic.ts#L17-L22)

[^google-ts-l5-l10]: [Google factory calls `createGoogle` and sets no base URL](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/google.ts#L5-L10)

[^openai-compatible-ts-l5-l24]: [shared OpenAI-compatible factory](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/factories/openai-compatible.ts#L5-L24)

[^provider-fetch-ts-l1-l15]: [provider fetch clears `Origin`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/provider-fetch.ts#L1-L15)

[^model-directory-ts-l97-l100]: [built-in directory replaces downloaded keys](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/models/model-directory.ts#L97-L100)

[^model-directory-ts-l149-l160]: [directory download uses the GitHub raw URL](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/models/model-directory.ts#L149-L160)

[^model-directory-startup-sync-tsx-l23-l66]: [hourly check downloads a missing or stale directory](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/components/a1/model-directory-startup-sync.tsx#L23-L66)

[^model-directory-ts-l11-l93]: [directory URL and the built-in `auto` model](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/models/model-directory.ts#L11-L93)

[^use-model-catalog-ts-l105-l110]: [Groq preferred id, also exported as `DEFAULT_CHAT_MODEL_ID`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L105-L110)

[^use-model-catalog-ts-l345-l372]: [smart default walks enabled providers in registry order](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L345-L372)

[^use-model-catalog-ts-l377-l387]: [catalog hook returns `DEFAULT_CHAT_MODEL_ID`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L377-L387)

[^model-context-tsx-l25-l36]: [new chat uses the saved id, then the smart default](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-model/model-context.tsx#L25-L36)

[^provider-atoms-ts-l23-l27]: [stored provider config defaults to disabled](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/jotai/provider-atoms.ts#L23-L27)

[^use-model-catalog-ts-l97-l98]: [tool behavior defaults to `default`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L97-L98)

[^use-model-catalog-ts-l184-l194]: [only `agent-one-auto` is listed for the AgentOne provider](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/hooks/ai/use-model-catalog.ts#L184-L194)

[^local-provider-factory-ts-l6-l13]: [local providers are OpenAI-compatible base URLs](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/providers/local-provider-factory.ts#L6-L13)

[^auth-client-ts-l9-l48]: [better-auth client and device-authorization plugin](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/auth/auth-client.ts#L9-L48)

[^web-auth-context-tsx-l106-l122]: [signed-in client loads billing through `authClient.customer.state`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-web-auth/web-auth-context.tsx#L106-L122)

[^web-auth-context-tsx-l40-l53]: [a valid access token becomes the AgentOne API key](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-web-auth/web-auth-context.tsx#L40-L53)

[^web-auth-context-tsx-l160-l183]: [device-code poll stores the access token](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/contexts/use-web-auth/web-auth-context.tsx#L160-L183)

[^keyring-rs-l402-l426]: [keyring write, with a length-limit ciphertext fallback](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/keyring.rs#L402-L426)

[^mcp-index-ts-l47-l117]: [stdio MCP is newline JSON-RPC on a shell child](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L47-L117)

[^mcp-index-ts-l212-l237]: [HTTP MCP posts JSON-RPC and stores `mcp-session-id`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L212-L237)

[^mcp-index-ts-l242-l256]: [an event-stream HTTP MCP response can carry more than one message](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L242-L256)

[^mcp-index-ts-l329-l345]: [HTTP MCP close sends `DELETE` with the session id](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L329-L345)

[^mcp-index-ts-l685-l697]: [`prefixMcpToolNames` template](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/mcp/index.ts#L685-L697)

[^sub-agent-ts-l81-l83]: [subagent prompt forbids nested subagents](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L81-L83)

[^sub-agent-ts-l293-l310]: [subagent tool set drops `subAgent`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L293-L310)

[^sub-agent-ts-l177-l197]: [`waitForApprovalResponse` stores an in-memory waiter](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L177-L197)

[^sub-agent-ts-l333-l349]: [subagent `streamText` has no compaction step](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L333-L349)

[^sub-agent-ts-l382-l416]: [nested approvals wait on an in-memory map](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/subAgent.ts#L382-L416)

[^compaction-ts-l40-l54]: [summary instructions and request](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/compaction.ts#L40-L54)

[^compaction-ts-l123-l169]: [later turns send the tail after the latest summary](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/compaction.ts#L123-L169)

[^compaction-ts-l235-l246]: [failed compaction points the model at `readChat`](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/compaction.ts#L235-L246)

[^web-search-ts-l76-l83]: [`webSearch` invokes the Rust `web_search` command](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src/lib/ai/tools/webSearch.ts#L76-L83)

[^web-search-rs-l50-l65]: [Rust `web_search` command](https://github.com/The-Best-Codes/agent-one/blob/bf36c259e448073c929fc03cbd9a499b758cfdf7/src-tauri/src/tools/web_search.rs#L50-L65)
