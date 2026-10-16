---
type: Reference
title: "Hermes Agent"
description: "Recall framing, memory-provider lifecycle, and TUI gateway transport and workspace cwd"
resource: "https://github.com/NousResearch/hermes-agent"
observed:
  date: "2026-09-21"
  revision: "ea0c2b820bd30bace020a3791d8aef0b44002e0d"
sources:
  - id: agent-memory-manager-py-l167-l285
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285"
    title: "sanitize_context() and StreamingContextScrubber"
  - id: agent-memory-provider-py-l58-l145
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145"
    title: "MemoryProvider"
  - id: agent-memory-manager-py-l480-l500
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500"
    title: "ordering"
  - id: hermes-cli-auth-py-l225-l232
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L225-L232"
    title: "Zen and Go as separate built-in provider tuples"
  - id: hermes-cli-models-py-l2268-l2290
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2268-L2290"
    title: "opencode provider family and model-id normalization"
  - id: hermes-cli-models-py-l2305-l2322
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2305-L2322"
    title: "per-model API mode prefix table"
  - id: hermes-cli-models-py-l2329-l2352
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2329-L2352"
    title: "symmetric base-URL healing per family and wire"
  - id: hermes-cli-model-switch-py-l1653-l1661
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/model_switch.py#L1653-L1661"
    title: "model_derived_api_mode for the final model"
  - id: tui-gateway-server-py-l2321-l2333
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/tui_gateway/server.py#L2321-L2333"
    title: "resumed-session route re-derivation"
  - id: agent-opencode-affinity-py-l30-l55
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L30-L55"
    title: "session header constant and per-model transport re-derivation"
  - id: agent-opencode-affinity-py-l92-l150
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L92-L150"
    title: "session headers, ephemeral fallback, custom header, and merge point"
  - id: agent-chat-completion-helpers-py-l1475-l1490
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/chat_completion_helpers.py#L1475-L1490"
    title: "affinity headers on every transport"
  - id: agent-auxiliary-client-py-l6622-l6624
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/auxiliary_client.py#L6622-L6624"
    title: "auxiliary calls reuse the conversation affinity"
  - id: hermes-cli-config-providers-py-l110-l122
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L110-L122"
    title: "sessionAffinityHeader config key"
  - id: hermes-cli-config-providers-py-l512-l524
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L512-L524"
    title: "get_custom_provider_session_affinity_header"
  - id: agent-prompt-caching-py-l91-l100
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/prompt_caching.py#L91-L100"
    title: "Qwen cache-marker families and the measured 1h allow-list"
  - id: agent-agent-runtime-helpers-py-l1611-l1616
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1611-L1616"
    title: "cache markers required for Go Qwen routes"
  - id: agent-agent-runtime-helpers-py-l1704-l1710
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1704-L1710"
    title: "Zen rejects Anthropic-style content blocks"
  - id: agent-reasoning-effort-py-l216-l224
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/reasoning_effort.py#L216-L224"
    title: "x-preview-f-free effort translation"
  - id: agent-error-classifier-py-l217-l224
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/error_classifier.py#L217-L224"
    title: "tool-content string coercion for the Go relay"
  - id: agent-vision-message-prep-py-l298-l311
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/vision_message_prep.py#L298-L311"
    title: "dots preserved in non-Claude model ids"
  - id: agent-transports-codex-py-l88-l103
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/transports/codex.py#L88-L103"
    title: "OpenCode responses-backend detection and reserved tool names"
  - id: agent-models-dev-py-l115-l120
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/models_dev.py#L115-L120"
    title: "Zen and Go mapped to separate models.dev providers"
  - id: hermes-cli-models-catalog-static-py-l223-l247
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models_catalog_static.py#L223-L247"
    title: "curated discovery floors for both relays"
  - id: hermes-cli-models-py-l1520-l1532
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1520-L1532"
    title: "free slugs the relay still lists but no longer serves"
  - id: hermes-cli-models-py-l1590-l1597
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1590-L1597"
    title: "delisted-id filter applied to the final rows"
  - id: hermes-cli-providers-py-l524-l544
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L524-L544"
    title: "live-first picker providers and models.dev preference"
  - id: hermes-cli-providers-py-l266-l272
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L266-L272"
    title: "flat-namespace resellers are not routing aggregators"
  - id: hermes-cli-doctor-connectivity-py-l80-l84
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/doctor_connectivity.py#L80-L84"
    title: "no shared models endpoint probed for Go"
  - id: hermes-cli-auth-py-l1149-l1154
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L1149-L1154"
    title: "removal note for the keyless free tier"
  - id: plugins-model-providers-opencode-zen-init-py-l16-l20
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L16-L20"
    title: "attribution headers for both relays"
  - id: plugins-model-providers-opencode-zen-init-py-l56-l76
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L56-L76"
    title: "Go subscription usage read from the literal usage endpoint"
  - id: plugins-model-providers-opencode-zen-init-py-l58-l67
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L58-L67"
    title: "per-model output cap for the Go relay"
  - id: plugins-model-providers-opencode-zen-init-py-l120-l127
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L120-L127"
    title: "Go profile registration with attribution defaults and the vision-tool-message gate"
  - id: tui-gateway-agents-md-l7-l16
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L7-L16"
    title: "TypeScript owns the screen; Python owns sessions, tools, and model calls"
  - id: tui-gateway-agents-md-l21-l34
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L21-L34"
    title: "newline-delimited JSON-RPC, blocking server-to-client requests, and replay"
  - id: tui-gateway-agents-md-l36-l40
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L36-L40"
    title: "Pydantic wire, generated TypeScript, unknown parameter keys rejected"
  - id: tui-gateway-entry-py-l36-l54
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/entry.py#L36-L54"
    title: "stdio RPC stdin marked close-on-exec"
  - id: tui-gateway-server-py-l110-l114
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server.py#L110-L114"
    title: "session.create idempotency registry"
  - id: tui-gateway-server-py-l691-l694
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server.py#L691-L694"
    title: "_default_session_cwd fallback chain"
  - id: tui-gateway-server-py-l697-l704
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server.py#L697-L704"
    title: "write_json seq stamping for replay"
  - id: tui-gateway-methods-session-py-l340-l376
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L340-L376"
    title: "idempotency_key returns the open session, or creates again after close"
  - id: tui-gateway-methods-session-py-l396-l399
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L396-L399"
    title: "session.create resolves cwd and explicit_cwd"
  - id: tui-gateway-methods-session-py-l420-l423
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L420-L423"
    title: "session stores explicit_cwd and cwd"
  - id: tui-gateway-methods-session-py-l1064-l1065
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L1064-L1065"
    title: "session.resume adopts the stored cwd"
  - id: tui-gateway-methods-session-py-l894-l910
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L894-L910"
    title: "session.resume payload builder omits open_requests"
  - id: tui-gateway-methods-session-py-l2327-l2341
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L2327-L2341"
    title: "session.events.since replays events and open requests"
  - id: tui-gateway-server-requests-py-l15-l18
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L15-L18"
    title: "transport note that resume returns open requests"
  - id: tui-gateway-contracts-sessions-py-l73-l93
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/contracts/sessions.py#L73-L93"
    title: "live-session result leaves open_requests optional"
  - id: tui-gateway-ws-py-l1-l4
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L1-L4"
    title: "WebSocket transport reusing dispatch"
  - id: tui-gateway-ws-py-l125-l128
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L125-L128"
    title: "auth_identity is unset for stdio and cannot be set from RPC params"
  - id: tui-gateway-ws-py-l376-l380
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L376-L380"
    title: "handle_ws is wire-compatible with the stdio entry"
  - id: hermes-cli-web-server-py-l230-l349
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/web_server.py#L230-L349"
    title: "process session token resolution and per-request validation"
  - id: tui-gateway-session-workdir-py-l25-l45
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L25-L45"
    title: "cwd_explicit beats a named profile's configured workspace"
  - id: tui-gateway-session-workdir-py-l221-l227
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L221-L227"
    title: "Desktop launch directory is a start artifact"
  - id: tui-gateway-prompt-turn-py-l701-l716
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/prompt_turn.py#L701-L716"
    title: "context-reference preprocessing passes the session cwd as allowed_root"
  - id: hermes-cli-main-tui-launch-py-l340-l349
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L340-L349"
    title: "launch directory from getcwd, else PWD"
  - id: hermes-cli-main-tui-launch-py-l447-l451
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L447-L451"
    title: "HERMES_CWD is the directory the launch was invoked from"
  - id: hermes-cli-main-tui-launch-py-l484-l490
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L484-L490"
    title: "local TUI copies the launch directory to HERMES_TUI_CWD and TERMINAL_CWD"
  - id: ui-tui-scripts-gateway-bootstrap-py-l1-l8
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/scripts/gateway_bootstrap.py#L1-L8"
    title: "bootstrap child is a client, never the agent owner"
  - id: ui-tui-scripts-gateway-bootstrap-py-l38-l46
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/scripts/gateway_bootstrap.py#L38-L46"
    title: "bootstrap strips launch-cwd env before ensuring the gateway"
  - id: ui-tui-src-config-env-ts-l31-l33
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/config/env.ts#L31-L33"
    title: "HERMES_TUI_CWD is the startup workspace sent as session.create cwd"
  - id: ui-tui-src-app-useSessionLifecycle-ts-l371-l379
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useSessionLifecycle.ts#L371-L379"
    title: "session.create sends the startup workspace cwd"
  - id: ui-tui-src-gatewayClient-ts-l132-l137
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L132-L137"
    title: "bootstrap script cwd is the Hermes source tree"
  - id: ui-tui-src-gatewayClient-ts-l586-l599
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L586-L599"
    title: "local start attaches to the ensured gateway over WebSocket"
  - id: ui-tui-src-app-useMainApp-ts-l1598
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useMainApp.ts#L1598"
    title: "status-line cwd falls back through info.cwd, HERMES_CWD, and process.cwd"
  - id: tui-gateway-server-requests-py-l9-l13
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L9-L13"
    title: "server-request ids are srq- plus 12 hex digits"
  - id: tui-gateway-event-replay-py-l131-l147
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/event_replay.py#L131-L147"
    title: "events after last_seen, truncated when the ring evicted frames"
  - id: tui-gateway-ws-py-l331-l355
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L331-L355"
    title: "legacy fallback needs unknown-method, a registered handler, and the allow-list"
  - id: tui-gateway-ws-py-l449-l453
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L449-L453"
    title: "ready frame sets session_authority when an authority is attached"
  - id: tui-gateway-session-workdir-py-l60-l63
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L60-L63"
    title: "client cwd resolved with abspath"
  - id: tui-gateway-session-workdir-py-l243-l256
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L243-L256"
    title: "stored explicit_cwd is a host directory, an ssh remote path, or a desktop vouch"
  - id: tui-gateway-session-workdir-py-l313-l322
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L313-L322"
    title: "resume drops a Hermes-owned ssh cwd or another profile's cwd"
  - id: hermes-cli-web-server-py-l451-l471
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/web_server.py#L451-L471"
    title: "dashboard token check skipped for native, token, and gated auth"
  - id: ui-tui-scripts-gateway-bootstrap-py-l56-l75
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/scripts/gateway_bootstrap.py#L56-L75"
    title: "TUI attach uses a private session-ticket"
  - id: ui-tui-src-gatewayClient-ts-l667-l669
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L667-L669"
    title: "canonical client readiness is the grant plus runtime.describe"
  - id: ui-tui-src-gatewayClient-ts-l906-l929
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L906-L929"
    title: "local bootstrap requests go through the canonical adapter"
  - id: ui-tui-src-gatewayClient-ts-l946-l961
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L946-L961"
    title: "lost session.create retries the same request_id"
  - id: ui-tui-src-canonicalGateway-ts-l10-l37
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/canonicalGateway.ts#L10-L37"
    title: "canonical session.create rewrite and session.activate sent as session.resume"
  - id: ui-tui-src-canonicalGateway-ts-l100-l105
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/canonicalGateway.ts#L100-L105"
    title: "canonical create cwd comes from HERMES_CWD"
  - id: ui-tui-src-app-useSessionLifecycle-ts-l500-l509
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useSessionLifecycle.ts#L500-L509"
    title: "session switch calls session.activate"
  - id: tui-gateway-agents-md-l3-l5
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L3-L5"
    title: "TUI, Desktop, and dashboard /chat are three gateway consumers"
  - id: tui-gateway-server-requests-py-l1-l7
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L1-L7"
    title: "clarify blocks in send; approval is queue-backed send_async"
  - id: tui-gateway-session-registry-py-l793-l798
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_registry.py#L793-L798"
    title: "live reattach payload includes open_requests when any are open"
  - id: tui-gateway-ws-legacy-fallback-py-l33-l36
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws_legacy_fallback.py#L33-L36"
    title: "session read methods allowed to fall back from the authority"
  - id: tui-gateway-ws-legacy-fallback-py-l57-l65
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws_legacy_fallback.py#L57-L65"
    title: "legacy fallback requires the interactive grant and skips session writers"
  - id: gateway-session-policy-py-l290-l297
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_policy.py#L290-L297"
    title: "canonical cwd must exist; cwd_explicit false asks the named-profile workspace"
  - id: gateway-session-policy-py-l316-l317
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_policy.py#L316-L317"
    title: "cwd_explicit true or a host terminal stores TERMINAL_CWD"
  - id: gateway-session-controls-py-l510-l520
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_controls.py#L510-L520"
    title: "canonical resume returns prompts and sequence cursors"
  - id: hermes-cli-main-tui-launch-py-l479-l482
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L479-L482"
    title: "--worktree replaces HERMES_CWD before the local copy"
  - id: ui-tui-src-gatewayClient-ts-l542-l549
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L542-L549"
    title: "canonical client republishes resume prompts as local request events"
  - id: ui-tui-src-app-useSessionLifecycle-ts-l548-l550
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useSessionLifecycle.ts#L548-L550"
    title: "session switch rehydrates prompts from the resume snapshot"
  - id: tui-gateway-server-requests-py-l189-l196
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L189-L196"
    title: "send blocks; a batch returns locked answers, otherwise no result"
  - id: tui-gateway-event-replay-py-l108-l110
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/event_replay.py#L108-L110"
    title: "an oversized frame sets the truncation watermark without entering the ring"
  - id: ui-tui-src-canonicalGateway-ts-l100-l138
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/canonicalGateway.ts#L100-L138"
    title: "local session.create options omit cwd_explicit"
  - id: gateway-session-policy-py-l338-l349
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_policy.py#L338-L349"
    title: "named-profile workspace is unset for the launch and default profiles"
  - id: tui-gateway-session-workdir-py-l160-l168
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L160-L168"
    title: "profile default cwd is the configured workspace, else a named local home"
  - id: tui-gateway-methods-session-py-l631-l636
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L631-L636"
    title: "resume mint uses the profile cwd, else the launch fallback"
  - id: tui-gateway-methods-session-py-l988-l1014
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L988-L1014"
    title: "eager resume stores the profile cwd and ignores the minted cwd"
  - id: tui-gateway-session-registry-py-l341
    resource: "https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_registry.py#L341"
    title: "an empty session cwd is stored as _completion_cwd()"
---

# Hermes Agent

- **Stack:** Python; multi-platform gateway; FTS5 session search

Self-improving agent with agent-curated memory, isolated subagents, and a pluggable memory-provider boundary. The useful comparison is lifecycle and context handling: llame owns Chat/Run identity and isolation, and any future memory implementation would be an adapter behind those boundaries.

**Study**

1. **Recall-time framing and scrubbing.** `sanitize_context()` and `StreamingContextScrubber`[^agent-memory-manager-py-l167-l285] remove fake memory/system framing, handle split tags in streams, and wrap recalled data as reference material. High confidence applicability to llame's model-visible context items; a framing control, not a write-time content scan.
2. **Provider lifecycle and boundary ordering.** `MemoryProvider`[^agent-memory-provider-py-l58-l145] defines initialization, prefetch, turn sync, and session callbacks. The manager serializes background writes and queues end-of-session extraction before switching sessions (ordering[^agent-memory-manager-py-l480-l500]). Moderate confidence for future executor or memory adapters; Hermes' session lineage differs from llame's Chat/Run model.
3. **Zen and Go are two providers over one relay, and the wire is per model.**
   Both register as separate built-in tuples with their own base URLs, key env
   vars, and comments explaining that Go mixes API
   surfaces[^hermes-cli-auth-py-l225-l232]. Routing is a prefix table keyed by
   family: Go sends `gpt-`/`grok-`/`muse-spark` to Responses and
   `minimax-`/`qwen`/`union-alpha` to Messages, Zen adds `claude-`, and
   everything else falls through to Chat
   Completions[^hermes-cli-models-py-l2305-l2322]. A persisted wire format is
   wrong for every model but the one it was saved for, so the mode is re-derived
   from the final model on the switch
   path[^hermes-cli-model-switch-py-l1653-l1661] and again on session resume in
   the TUI gateway[^tui-gateway-server-py-l2321-l2333], and the base URL is
   healed symmetrically per family and wire[^hermes-cli-models-py-l2329-l2352].
   Family membership also matches custom entries named after a built-in family,
   and config ids are normalized to the bare slug used in requests before the
   table lookup[^hermes-cli-models-py-l2268-l2290]. High confidence for #809:
   never trust a stored wire for a gateway that serves several.
4. **One merge point stamps the session header on every request.** The header
   name lives in one constant; the value is a normalized conversation scope
   (host-declared affinity scope, then the ambient conversation root, then the
   session id) and, when nothing resolves, an ephemeral
   `oneshot-<hex>`[^agent-opencode-affinity-py-l92-l150]. The docstring gives
   the reason: Go rejects requests without the header, HTTP 400
   `MissingSessionID`[^agent-opencode-affinity-py-l92-l150]. The same module
   returns the re-derived wire and healed base URL for relay targets, deferring to a
   custom entry with its own `api_mode`[^agent-opencode-affinity-py-l30-l55]. Exactly two
   call sites use the merge helper, the main builder for all three
   transports[^agent-chat-completion-helpers-py-l1475-l1490] and the auxiliary
   client used by compression, titles, vision, and
   MoA[^agent-auxiliary-client-py-l6622-l6624], and per-call headers win, so a
   caller-pinned value is never
   overwritten[^agent-opencode-affinity-py-l92-l150]. High confidence for #809:
   the value is ambient session state, not a call-site argument, and the
   fallback keeps stateless calls from failing the gateway.
5. **An operator-named affinity header for arbitrary gateways.** A custom
   provider entry may declare `session_affinity_header` (camelCase alias
   `sessionAffinityHeader`)[^hermes-cli-config-providers-py-l110-l122], the name
   is read back per route[^hermes-cli-config-providers-py-l512-l524], and the
   same merge point sends the conversation key under that name
   instead[^agent-opencode-affinity-py-l92-l150]. The identifier is never
   shipped to an endpoint that did not ask for it; the motivating case is a
   session-aware proxy re-classifying an agent-loop request as a new
   conversation. High confidence for #881: a working prior art for a generic
   per-provider header channel, with the value still owned by the harness.
6. **Go-aware caching and format repairs.** Alibaba-family routing clamps
   `cache_control` TTLs to the five-minute tier by default, with Go the only
   wire-measured exception allowed a one-hour
   marker[^agent-prompt-caching-py-l91-l100]. Without Anthropic-style markers
   the Go Qwen route reports zero cache hits and re-bills the prompt every
   turn[^agent-agent-runtime-helpers-py-l1611-l1616], while Zen's relay rejects
   the block-array content that markers produce, a 400 recorded against
   it[^agent-agent-runtime-helpers-py-l1704-l1710]. Smaller repairs: a
   translation for Zen's `x-preview-f-free` stealth model accepting only low, high,
   and max[^agent-reasoning-effort-py-l216-l224]; tool-content coercion
   patterns naming the Go relay's pydantic-style 422
   wording[^agent-error-classifier-py-l217-l224]; dot preservation in non-Claude
   model ids on the Anthropic wire[^agent-vision-message-prep-py-l298-l311]; and
   reserved tool names stripped on the Responses backend behind an OpenCode-host
   check[^agent-transports-codex-py-l88-l103]. The Go provider profile also caps
   `mimo-v2.5-pro` because the relay's default output budget exceeds what that
   vendor accepts[^plugins-model-providers-opencode-zen-init-py-l58-l67], and
   declares that tool messages cannot carry list-type content, since both the
   console relay and the vendor reject it and the rejected row stays in
   history[^plugins-model-providers-opencode-zen-init-py-l120-l127]. Moderate to high
   confidence llame needs equivalents: caching and reasoning-field behavior differ per
   model, not per provider.
7. **Attribution headers through provider defaults, and a usage endpoint.** Both
   relays get fixed `HTTP-Referer`, `X-Title`, and `User-Agent: HermesAgent/<version>` headers installed as provider default
   headers, so they survive model switches and credential
   rotation[^plugins-model-providers-opencode-zen-init-py-l16-l20][^plugins-model-providers-opencode-zen-init-py-l120-l127].
   The Go profile also reads subscription windows from `https://opencode.ai/zen/go/v1/usage` with the same bearer
   key, using the literal URL because the runtime base URL loses its `/v1` suffix
   in Messages mode[^plugins-model-providers-opencode-zen-init-py-l56-l76]. High
   confidence for #809 and #765: the client-identification and quota pair a Go
   adapter needs, both provider-profile properties rather than call-site
   decisions.
8. **Catalogue: live-first with a curated floor, delisting filters, and no Go
   probe.** Go and Zen map to distinct models.dev
   providers[^agent-models-dev-py-l115-l120]; both sit in the live-first picker
   set[^hermes-cli-providers-py-l524-l544] over curated floors whose ranges
   carry their own sync
   comments[^hermes-cli-models-catalog-static-py-l223-l247]; retired ids the
   relay still lists are filtered from the final
   rows[^hermes-cli-models-py-l1590-l1597] together with free slugs it no longer
   serves[^hermes-cli-models-py-l1520-l1532]. The doctor check skips Go's models
   endpoint while keeping Zen's[^hermes-cli-doctor-connectivity-py-l80-l84], yet an earlier flat-namespace
   comment treats both as resellers whose live listing returns bare model ids[^hermes-cli-providers-py-l266-l272]. Moderate confidence: copy
   the live-first merge and the delisting filter; verify Go's model listing
   yourself before depending on it.
9. **One JSON-RPC catalog, and the current TUI attaches through a canonical adapter.**
   TypeScript owns the screen. Python owns sessions, tools, model calls, and
   slash-command logic[^tui-gateway-agents-md-l7-l16]. The same module is the
   backend for the Desktop app and the dashboard `/chat` as well as the TUI,
   three consumers[^tui-gateway-agents-md-l3-l5]. The documented wire is
   newline-delimited JSON-RPC and is peer to peer. Client-to-server calls are
   methods. Server-to-client `clarify`, `sudo`, `secret`, and similar
   questions block in `send()`. Without a question batch, timeout, cancel, or
   an error response returns no result. A batch returns the answers locked so
   far, with an outcome of `submitted`, `cancelled`, or
   `timed_out`[^tui-gateway-server-requests-py-l189-l196].
   `approval` is queue-backed
   `send_async`[^tui-gateway-server-requests-py-l1-l7]. Request ids are `srq-` plus 12 hex
   digits[^tui-gateway-agents-md-l21-l34][^tui-gateway-server-requests-py-l9-l13].
   Events carry a per-session `seq`[^tui-gateway-server-py-l697-l704].
   `session.events.since` returns events with `seq` greater than `last_seen`
   and the still-open server requests. The ring is bounded. `truncated` means
   a gap: frames were evicted, or an oversized frame was never retained, so
   the client
   refetches[^tui-gateway-methods-session-py-l2327-l2341][^tui-gateway-event-replay-py-l131-l147][^tui-gateway-event-replay-py-l108-l110].
   Transport notes also name `session.resume` as a carrier for those open
   requests[^tui-gateway-agents-md-l21-l34][^tui-gateway-server-requests-py-l15-l18],
   and the live-session result leaves `open_requests`
   optional[^tui-gateway-contracts-sessions-py-l73-l93]. The cold resume
   builder `_resume_response` does not set
   `open_requests`[^tui-gateway-methods-session-py-l894-l910].
   `_live_session_payload` includes `open_requests` when a request is still
   open[^tui-gateway-session-registry-py-l793-l798]. A client announces
   `client.capabilities {server_requests: true}` once per connection; a
   WebSocket client that never did has those requests failed
   immediately[^tui-gateway-agents-md-l21-l34]. The wire is Pydantic in Python,
   generated into TypeScript, and unknown parameter keys are
   rejected[^tui-gateway-agents-md-l36-l40]. On the legacy dispatcher,
   `session.create` accepts an `idempotency_key`. The registry comment says
   entries expire with the session. Lookup drops keys older than 300 seconds
   first, so an open session is not returned after that TTL, and a closed
   session is created again under the same
   key[^tui-gateway-server-py-l110-l114][^tui-gateway-methods-session-py-l340-l376].
   Stdio remains a documented peer transport. On POSIX its stdin is marked
   close-on-exec so a process the gateway launches cannot consume RPC frames,
   and the mark is skipped when the descriptor cannot be
   changed[^tui-gateway-entry-py-l36-l54]. `hermes --tui` ensures a gateway
   owner and attaches over WebSocket with the client in canonical
   mode[^ui-tui-scripts-gateway-bootstrap-py-l1-l8][^ui-tui-src-gatewayClient-ts-l586-l599].
   Session methods then go through
   `canonicalRequest`[^ui-tui-src-gatewayClient-ts-l906-l929]. `session.create`
   is rewritten to `source: "tui"`, a `request_id`, and no `cols`, and keys
   outside the creation contract are
   rejected[^ui-tui-src-canonicalGateway-ts-l10-l37]. The client calls
   `session.activate`, which the adapter sends as
   `session.resume`. The adapter sets `display_projection` when that call will
   render[^ui-tui-src-canonicalGateway-ts-l10-l37][^ui-tui-src-app-useSessionLifecycle-ts-l500-l509].
   That resume result carries `prompts`, `replay_epoch`, and `last_sequence`,
   and does not include
   `open_requests`[^gateway-session-controls-py-l510-l520]. The client
   republishes those prompts as local request
   events[^ui-tui-src-gatewayClient-ts-l542-l549][^ui-tui-src-app-useSessionLifecycle-ts-l548-l550].
   A lost create is retried with the same `request_id`, not
   `idempotency_key`[^ui-tui-src-gatewayClient-ts-l946-l961]. `handle_ws` is documented as
   wire-compatible with the stdio
   entry[^tui-gateway-ws-py-l376-l380]. With a session authority attached, the
   request goes to `AuthorityConnection`. Fallback to the legacy dispatcher
   runs only when the authority answers unknown-method, the method is still
   registered on that dispatcher, and `legacy_fallback_allowed` is true. A
   method neither side knows stays on that `-32601`. Session writers stay on the authority's
   `-32601`, except `session.most_recent`, `session.active_list`,
   `session.events.stats`, `session.foreign.list`, `session.foreign.preview`,
   and `session.foreign.import`. Process-global methods do
   not fall
   back[^tui-gateway-ws-py-l331-l355][^tui-gateway-ws-legacy-fallback-py-l33-l36][^tui-gateway-ws-legacy-fallback-py-l57-l65].
   The ready frame then includes
   `session_authority`[^tui-gateway-ws-py-l449-l453]. With no session
   authority, the socket uses `dispatch`[^tui-gateway-ws-py-l331-l355].
   The WebSocket module header still describes that `dispatch` path as the
   stdio wire[^tui-gateway-ws-py-l1-l4]. The canonical client treats readiness
   as the discovery grant plus
   `runtime.describe`[^ui-tui-src-gatewayClient-ts-l667-l669]. Dashboard HTTP checks a process
   session token on `/api/` routes. The middleware skips that check for a
   native principal, for `token_authenticated`, when `auth_required` is set,
   and on public paths, the MCP OAuth callback prefix, and a valid query token
   on the download route[^hermes-cli-web-server-py-l451-l471]. The resolver reads
   `HERMES_DASHBOARD_SESSION_TOKEN` or mints a token that dies with the
   process, and `_apply_ssh_session_token` replaces that process
   token[^hermes-cli-web-server-py-l230-l349]. Unverified: the desktop mint
   that sets `HERMES_DASHBOARD_SESSION_TOKEN`, token rotation, and hosted-room
   peer authentication were not traced. The TUI bootstrap authenticates the
   attach with a private `session-ticket`, separate from that dashboard
   token[^ui-tui-scripts-gateway-bootstrap-py-l56-l75]. `auth_identity` is
   stamped from the WebSocket upgrade and stays unset for stdio and for a
   legacy-token peer; RPC params cannot set
   it[^tui-gateway-ws-py-l125-l128]. `compute_host` and `hosted_room` remote
   execution were not traced, so this note does not place tools when the
   gateway host is remote. High confidence for a llame CLI: a bidirectional
   channel where the run blocks on a client answer, with replay of still-open
   requests on reconnect and a truncated flag when that replay is incomplete,
   is the shape a local tool executor needs. The current Ink client restores
   still-open questions from the canonical resume `prompts` list, through the
   adapter above[^ui-tui-src-gatewayClient-ts-l542-l549].
10. **`hermes --tui` sends the launch directory as the session cwd.**
    The launcher records the directory it was invoked from with `os.getcwd()`.
    When that call raises `FileNotFoundError` it uses the `PWD` environment
    variable if that path is a directory, and otherwise the Hermes
    `PROJECT_ROOT`[^hermes-cli-main-tui-launch-py-l340-l349]. That value is
    `HERMES_CWD`[^hermes-cli-main-tui-launch-py-l447-l451]. `--worktree`
    replaces it with the worktree path before the local
    copy[^hermes-cli-main-tui-launch-py-l479-l482]. A local terminal also
    copies it to `HERMES_TUI_CWD` and `TERMINAL_CWD`. A non-local
    `TERMINAL_ENV` removes
    `HERMES_TUI_CWD`[^hermes-cli-main-tui-launch-py-l484-l490]. Canonical
    `session.create` sends `cwd` from `HERMES_CWD`, then overlays a non-empty
    `HERMES_TUI_CWD`[^ui-tui-src-canonicalGateway-ts-l100-l105][^ui-tui-src-config-env-ts-l31-l33][^ui-tui-src-app-useSessionLifecycle-ts-l371-l379].
    The create path does not send
    `cwd_explicit`[^ui-tui-src-canonicalGateway-ts-l100-l138][^ui-tui-src-app-useSessionLifecycle-ts-l371-l379].
    On the canonical create
    policy, `cwd` must be an absolute path to an existing directory, or the
    create is refused. An omitted `cwd` uses `resolve_agent_cwd()`.
    `cwd_explicit: false` replaces a provided cwd with a named profile's
    configured workspace when that directory exists. The launch profile and
    the `default` profile do not yield. An omitted flag does not yield.
    `cwd_explicit: true`, or a terminal that uses the host cwd, stores that
    directory as
    `TERMINAL_CWD`[^gateway-session-policy-py-l290-l297][^gateway-session-policy-py-l316-l317][^gateway-session-policy-py-l338-l349].
    The legacy dispatcher is a separate path. There,
    `_default_session_cwd` falls back to the launch profile's configured
    `terminal.cwd`, then `TERMINAL_CWD`, then
    `os.getcwd()`[^tui-gateway-server-py-l691-l694]. A client `cwd` without
    `cwd_explicit` loses to a named profile's configured workspace, because
    path equality cannot tell an inherited default from a deliberate
    pick[^tui-gateway-session-workdir-py-l25-l45]. Create stores the resolved
    cwd[^tui-gateway-methods-session-py-l396-l399][^tui-gateway-methods-session-py-l420-l423].
    The stored `explicit_cwd` bit starts true when the client path is a
    directory on the host, or a remote-shaped path on an ssh profile. A
    desktop source whose host probe failed still sets the bit when
    `cwd_explicit` is true, or when completion already adopted that absolute
    path[^tui-gateway-session-workdir-py-l243-l256]. When legacy resume mints a
    runtime record, `mint()` starts from the stored cwd. It drops that path
    when an ssh
    profile's row holds a
    directory inside Hermes's own host tree, or when a named local profile's
    row holds the Hermes root, its subprocess home, a sibling profile, or the
    install tree[^tui-gateway-session-workdir-py-l313-l322]. The replacement
    is that profile's configured workspace, else a named local profile's own
    home. `mint()` returns `_default_session_cwd` when that value is
    empty[^tui-gateway-methods-session-py-l1064-l1065][^tui-gateway-session-workdir-py-l160-l168][^tui-gateway-methods-session-py-l631-l636].
    Eager resume ignores that return and stores the profile cwd, or
    `_completion_cwd()` when the profile cwd is
    empty[^tui-gateway-methods-session-py-l988-l1014][^tui-gateway-session-registry-py-l341].
    The gateway bootstrap removes `HERMES_CWD` and `TERMINAL_CWD` before
    ensuring the shared owner, so those variables stay out of the daemon-wide
    environment[^ui-tui-scripts-gateway-bootstrap-py-l38-l46]. The bootstrap
    script's own cwd is the Hermes source tree, separate from the session
    workspace[^ui-tui-src-gatewayClient-ts-l132-l137]. Desktop's launch
    directory counts as a workspace only when the session cwd is
    explicit[^tui-gateway-session-workdir-py-l221-l227]. On the legacy prompt
    path, a prompt that contains `@` passes the session cwd as
    `allowed_root`[^tui-gateway-prompt-turn-py-l701-l716]. The status line
    shows `info.cwd`, then `HERMES_CWD`, then
    `process.cwd()`[^ui-tui-src-app-useMainApp-ts-l1598]. Tools and file access
    run in the Python gateway[^tui-gateway-agents-md-l7-l16]. Where that
    process runs for `compute_host` or `hosted_room` was not traced. The
    legacy resolver uses `abspath`, which leaves symlinks
    unresolved[^tui-gateway-session-workdir-py-l60-l63]. Moderate confidence:
    llame should run tools in the CLI against `realpath` of the process launch
    directory, keep an explicit workspace distinct from an inherited one, and
    treat paths the server supplies as untrusted.

**Caution:** recalled data is described as authoritative reference data inside a known wrapper. That framing does not provide tenant authorization, provenance enforcement, or isolation between users.

Three things here are specific to Hermes and should not be copied blindly for a
Go adapter. Attribution headers are the only client identification, inherited
from the OpenRouter-style profile convention rather than chosen for the relay; a
gateway that validates a specific product token should be given one explicitly.
The `MissingSessionID` failure has no reactive path, so any new call path that
bypasses the single merge helper fails closed at the gateway rather than at the
harness. And the keyless `opencode-free` provider was removed after the relay
began answering it with a 403, so a free tier is not a stable design
assumption[^hermes-cli-auth-py-l1149-l1154].

[^agent-memory-manager-py-l167-l285]: [`sanitize_context()` and `StreamingContextScrubber`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285)

[^agent-memory-provider-py-l58-l145]: [`MemoryProvider`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145)

[^agent-memory-manager-py-l480-l500]: [ordering](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500)

[^hermes-cli-auth-py-l225-l232]: [Zen and Go as separate built-in provider tuples](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L225-L232)

[^hermes-cli-models-py-l2268-l2290]: [opencode provider family and model-id normalization](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2268-L2290)

[^hermes-cli-models-py-l2305-l2322]: [per-model API mode prefix table](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2305-L2322)

[^hermes-cli-models-py-l2329-l2352]: [symmetric base-URL healing per family and wire](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2329-L2352)

[^hermes-cli-model-switch-py-l1653-l1661]: [`model_derived_api_mode` for the final model](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/model_switch.py#L1653-L1661)

[^tui-gateway-server-py-l2321-l2333]: [resumed-session route re-derivation](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/tui_gateway/server.py#L2321-L2333)

[^agent-opencode-affinity-py-l30-l55]: [session header constant and per-model transport re-derivation](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L30-L55)

[^agent-opencode-affinity-py-l92-l150]: [session headers, ephemeral fallback, custom header, and merge point](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L92-L150)

[^agent-chat-completion-helpers-py-l1475-l1490]: [affinity headers on every transport](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/chat_completion_helpers.py#L1475-L1490)

[^agent-auxiliary-client-py-l6622-l6624]: [auxiliary calls reuse the conversation affinity](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/auxiliary_client.py#L6622-L6624)

[^hermes-cli-config-providers-py-l110-l122]: [`sessionAffinityHeader` config key](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L110-L122)

[^hermes-cli-config-providers-py-l512-l524]: [`get_custom_provider_session_affinity_header`](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L512-L524)

[^agent-prompt-caching-py-l91-l100]: [Qwen cache-marker families and the measured 1h allow-list](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/prompt_caching.py#L91-L100)

[^agent-agent-runtime-helpers-py-l1611-l1616]: [cache markers required for Go Qwen routes](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1611-L1616)

[^agent-agent-runtime-helpers-py-l1704-l1710]: [Zen rejects Anthropic-style content blocks](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1704-L1710)

[^agent-reasoning-effort-py-l216-l224]: [`x-preview-f-free` effort translation](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/reasoning_effort.py#L216-L224)

[^agent-error-classifier-py-l217-l224]: [tool-content string coercion for the Go relay](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/error_classifier.py#L217-L224)

[^agent-vision-message-prep-py-l298-l311]: [dots preserved in non-Claude model ids](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/vision_message_prep.py#L298-L311)

[^agent-transports-codex-py-l88-l103]: [OpenCode responses-backend detection and reserved tool names](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/transports/codex.py#L88-L103)

[^agent-models-dev-py-l115-l120]: [Zen and Go mapped to separate models.dev providers](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/models_dev.py#L115-L120)

[^hermes-cli-models-catalog-static-py-l223-l247]: [curated discovery floors for both relays](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models_catalog_static.py#L223-L247)

[^hermes-cli-models-py-l1520-l1532]: [free slugs the relay still lists but no longer serves](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1520-L1532)

[^hermes-cli-models-py-l1590-l1597]: [delisted-id filter applied to the final rows](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1590-L1597)

[^hermes-cli-providers-py-l524-l544]: [live-first picker providers and models.dev preference](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L524-L544)

[^hermes-cli-providers-py-l266-l272]: [flat-namespace resellers are not routing aggregators](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L266-L272)

[^hermes-cli-doctor-connectivity-py-l80-l84]: [no shared models endpoint probed for Go](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/doctor_connectivity.py#L80-L84)

[^hermes-cli-auth-py-l1149-l1154]: [removal note for the keyless free tier](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L1149-L1154)

[^plugins-model-providers-opencode-zen-init-py-l16-l20]: [attribution headers for both relays](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L16-L20)

[^plugins-model-providers-opencode-zen-init-py-l56-l76]: [Go subscription usage read from the literal usage endpoint](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L56-L76)

[^plugins-model-providers-opencode-zen-init-py-l58-l67]: [per-model output cap for the Go relay](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L58-L67)

[^plugins-model-providers-opencode-zen-init-py-l120-l127]: [Go profile registration with attribution defaults and the vision-tool-message gate](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L120-L127)

[^tui-gateway-agents-md-l7-l16]: [TypeScript owns the screen; Python owns sessions, tools, and model calls](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L7-L16)

[^tui-gateway-agents-md-l21-l34]: [newline-delimited JSON-RPC, blocking server-to-client requests, and replay](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L21-L34)

[^tui-gateway-agents-md-l36-l40]: [Pydantic wire, generated TypeScript, unknown parameter keys rejected](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L36-L40)

[^tui-gateway-entry-py-l36-l54]: [stdio RPC stdin marked close-on-exec](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/entry.py#L36-L54)

[^tui-gateway-server-py-l110-l114]: [session.create idempotency registry](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server.py#L110-L114)

[^tui-gateway-server-py-l691-l694]: [`_default_session_cwd` fallback chain](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server.py#L691-L694)

[^tui-gateway-server-py-l697-l704]: [`write_json` seq stamping for replay](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server.py#L697-L704)

[^tui-gateway-methods-session-py-l340-l376]: [`idempotency_key` returns the open session, or creates again after close](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L340-L376)

[^tui-gateway-methods-session-py-l396-l399]: [session.create resolves cwd and explicit_cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L396-L399)

[^tui-gateway-methods-session-py-l420-l423]: [session stores explicit_cwd and cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L420-L423)

[^tui-gateway-methods-session-py-l1064-l1065]: [`session.resume` adopts the stored cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L1064-L1065)

[^tui-gateway-methods-session-py-l894-l910]: [`session.resume` payload builder omits `open_requests`](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L894-L910)

[^tui-gateway-methods-session-py-l2327-l2341]: [`session.events.since` replays events and open requests](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L2327-L2341)

[^tui-gateway-server-requests-py-l15-l18]: [transport note that resume returns open requests](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L15-L18)

[^tui-gateway-contracts-sessions-py-l73-l93]: [live-session result leaves `open_requests` optional](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/contracts/sessions.py#L73-L93)

[^tui-gateway-ws-py-l1-l4]: [WebSocket transport reusing `dispatch`](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L1-L4)

[^tui-gateway-ws-py-l125-l128]: [auth_identity is unset for stdio and cannot be set from RPC params](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L125-L128)

[^tui-gateway-ws-py-l376-l380]: [handle_ws is wire-compatible with the stdio entry](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L376-L380)

[^hermes-cli-web-server-py-l230-l349]: [process session token resolution and per-request validation](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/web_server.py#L230-L349)

[^tui-gateway-session-workdir-py-l25-l45]: [cwd_explicit beats a named profile's configured workspace](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L25-L45)

[^tui-gateway-session-workdir-py-l221-l227]: [Desktop launch directory is a start artifact](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L221-L227)

[^tui-gateway-prompt-turn-py-l701-l716]: [context-reference preprocessing passes the session cwd as allowed_root](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/prompt_turn.py#L701-L716)

[^hermes-cli-main-tui-launch-py-l340-l349]: [launch directory from getcwd, else PWD](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L340-L349)

[^hermes-cli-main-tui-launch-py-l447-l451]: [HERMES_CWD is the directory the launch was invoked from](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L447-L451)

[^hermes-cli-main-tui-launch-py-l484-l490]: [local TUI copies the launch directory to HERMES_TUI_CWD and TERMINAL_CWD](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L484-L490)

[^ui-tui-scripts-gateway-bootstrap-py-l1-l8]: [bootstrap child is a client, never the agent owner](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/scripts/gateway_bootstrap.py#L1-L8)

[^ui-tui-scripts-gateway-bootstrap-py-l38-l46]: [bootstrap strips launch-cwd env before ensuring the gateway](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/scripts/gateway_bootstrap.py#L38-L46)

[^ui-tui-src-config-env-ts-l31-l33]: [HERMES_TUI_CWD is the startup workspace sent as session.create cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/config/env.ts#L31-L33)

[^ui-tui-src-app-useSessionLifecycle-ts-l371-l379]: [session.create sends the startup workspace cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useSessionLifecycle.ts#L371-L379)

[^ui-tui-src-gatewayClient-ts-l132-l137]: [bootstrap script cwd is the Hermes source tree](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L132-L137)

[^ui-tui-src-gatewayClient-ts-l586-l599]: [local start attaches to the ensured gateway over WebSocket](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L586-L599)

[^ui-tui-src-app-useMainApp-ts-l1598]: [status-line cwd falls back through info.cwd, HERMES_CWD, and process.cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useMainApp.ts#L1598)

[^tui-gateway-server-requests-py-l9-l13]: [server-request ids are srq- plus 12 hex digits](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L9-L13)

[^tui-gateway-event-replay-py-l131-l147]: [events after last_seen, truncated when the ring evicted frames](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/event_replay.py#L131-L147)

[^tui-gateway-ws-py-l331-l355]: [legacy fallback needs unknown-method, a registered handler, and the allow-list](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L331-L355)

[^tui-gateway-ws-py-l449-l453]: [ready frame sets session_authority when an authority is attached](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws.py#L449-L453)

[^tui-gateway-session-workdir-py-l60-l63]: [client cwd resolved with abspath](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L60-L63)

[^tui-gateway-session-workdir-py-l243-l256]: [stored explicit_cwd is a host directory, an ssh remote path, or a desktop vouch](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L243-L256)

[^tui-gateway-session-workdir-py-l313-l322]: [resume drops a Hermes-owned ssh cwd or another profile's cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L313-L322)

[^hermes-cli-web-server-py-l451-l471]: [dashboard token check skipped for native, token, and gated auth](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/web_server.py#L451-L471)

[^ui-tui-scripts-gateway-bootstrap-py-l56-l75]: [TUI attach uses a private session-ticket](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/scripts/gateway_bootstrap.py#L56-L75)

[^ui-tui-src-gatewayClient-ts-l667-l669]: [canonical client readiness is the grant plus runtime.describe](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L667-L669)

[^ui-tui-src-gatewayClient-ts-l906-l929]: [local bootstrap requests go through the canonical adapter](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L906-L929)

[^ui-tui-src-gatewayClient-ts-l946-l961]: [lost session.create retries the same request_id](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L946-L961)

[^ui-tui-src-canonicalGateway-ts-l10-l37]: [canonical session.create rewrite and session.activate sent as session.resume](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/canonicalGateway.ts#L10-L37)

[^ui-tui-src-canonicalGateway-ts-l100-l105]: [canonical create cwd comes from HERMES_CWD](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/canonicalGateway.ts#L100-L105)

[^ui-tui-src-app-useSessionLifecycle-ts-l500-l509]: [session switch calls session.activate](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useSessionLifecycle.ts#L500-L509)

[^tui-gateway-agents-md-l3-l5]: [TUI, Desktop, and dashboard /chat are three gateway consumers](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/AGENTS.md#L3-L5)

[^tui-gateway-server-requests-py-l1-l7]: [clarify blocks in send; approval is queue-backed send_async](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L1-L7)

[^tui-gateway-session-registry-py-l793-l798]: [live reattach payload includes open_requests when any are open](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_registry.py#L793-L798)

[^tui-gateway-ws-legacy-fallback-py-l33-l36]: [session read methods allowed to fall back from the authority](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws_legacy_fallback.py#L33-L36)

[^tui-gateway-ws-legacy-fallback-py-l57-l65]: [legacy fallback requires the interactive grant and skips session writers](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/ws_legacy_fallback.py#L57-L65)

[^gateway-session-policy-py-l290-l297]: [canonical cwd must exist; cwd_explicit false asks the named-profile workspace](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_policy.py#L290-L297)

[^gateway-session-policy-py-l316-l317]: [cwd_explicit true or a host terminal stores TERMINAL_CWD](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_policy.py#L316-L317)

[^gateway-session-controls-py-l510-l520]: [canonical resume returns prompts and sequence cursors](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_controls.py#L510-L520)

[^hermes-cli-main-tui-launch-py-l479-l482]: [--worktree replaces HERMES_CWD before the local copy](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/hermes_cli/main_tui_launch.py#L479-L482)

[^ui-tui-src-gatewayClient-ts-l542-l549]: [canonical client republishes resume prompts as local request events](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/gatewayClient.ts#L542-L549)

[^ui-tui-src-app-useSessionLifecycle-ts-l548-l550]: [session switch rehydrates prompts from the resume snapshot](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/app/useSessionLifecycle.ts#L548-L550)

[^tui-gateway-server-requests-py-l189-l196]: [send blocks; a batch returns locked answers, otherwise no result](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/server_requests.py#L189-L196)

[^tui-gateway-event-replay-py-l108-l110]: [an oversized frame sets the truncation watermark without entering the ring](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/event_replay.py#L108-L110)

[^ui-tui-src-canonicalGateway-ts-l100-l138]: [local session.create options omit cwd_explicit](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/ui-tui/src/canonicalGateway.ts#L100-L138)

[^gateway-session-policy-py-l338-l349]: [named-profile workspace is unset for the launch and default profiles](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/gateway/session_policy.py#L338-L349)

[^tui-gateway-session-workdir-py-l160-l168]: [profile default cwd is the configured workspace, else a named local home](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_workdir.py#L160-L168)

[^tui-gateway-methods-session-py-l631-l636]: [resume mint uses the profile cwd, else the launch fallback](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L631-L636)

[^tui-gateway-methods-session-py-l988-l1014]: [eager resume stores the profile cwd and ignores the minted cwd](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/methods_session.py#L988-L1014)

[^tui-gateway-session-registry-py-l341]: [an empty session cwd is stored as `_completion_cwd()`](https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/tui_gateway/session_registry.py#L341)
