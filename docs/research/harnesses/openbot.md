---
type: Reference
title: "OpenBot"
description: "Electron desktop meta-harness: peer CLIs run in per-agent workspaces, and the host owns the queue, approvals, and local MCP tools."
resource: "https://github.com/nightly-labs/openbot"
tags: [harness, desktop, electron, peer-executor, acp, permissions, workspace]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-24"
observed:
  date: "2026-10-24"
  revision: "9f2f38c22c77919b5d0ec728730365165a5d6485"
sources:
  - id: readme-intro
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L4-L16"
    title: "Local-first desktop for persistent teammates, and the preview access warning"
  - id: readme-queue
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L25"
    title: "FIFO queues with pause, resume, cancellation, and persistence"
  - id: readme-site
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L92-L93"
    title: "A self-hosted server is used from the desktop, the iPhone app, or openbot.run/app"
  - id: readme-apparmor
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L58-L68"
    title: "AppImage launch refuses to drop the Electron sandbox"
  - id: readme-docker
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L96-L104"
    title: "Container seccomp keeps the Electron sandbox on"
  - id: readme-security
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L573-L581"
    title: "Full local access is an explicit product decision"
  - id: readme-license
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L601-L609"
    title: "PolyForm Noncommercial, with Apache-2.0 named for versions through 0.1.11"
  - id: license-heading
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/LICENSE#L1-L3"
    title: "PolyForm Noncommercial License 1.0.0 heading"
  - id: license-purpose
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/LICENSE#L32-L37"
    title: "Permitted purposes are noncommercial, including personal research"
  - id: license-notice
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/LICENSE#L75-L77"
    title: "Copyright notice and commercial-license contact"
  - id: package-json
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/package.json#L2-L11"
    title: "Package version 0.48.2 and PolyForm-Noncommercial-1.0.0"
  - id: package-keywords
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/package.json#L20-L28"
    title: "Package keywords name Electron, Bun, and SolidJS"
  - id: agents-boundary
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/AGENTS.md#L31-L33"
    title: "Renderer sandbox stays mandatory because coding agents already have full access"
  - id: agents-local
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/AGENTS.md#L41-L48"
    title: "Chats stay on the host; agents keep workspace and identity across provider switches"
  - id: structure-homes
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/docs/architecture/structure.md#L88-L90"
    title: "Provider home directories are login and resume state, not conversation storage"
  - id: access-default
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-agents.ts#L31-L37"
    title: "Access is workspace or full, and the default is full"
  - id: access-enforced
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-agents.ts#L60-L68"
    title: "Workspace access is enforced per provider"
  - id: permission-levels
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-agent-admin.ts#L39-L73"
    title: "Workspace, Ask first, and Full access from access plus auto-approve"
  - id: provider-ids
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-providers.ts#L22-L34"
    title: "Provider ids include Pi, Muse, Inception, and a custom ACP command"
  - id: claude-ask
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-providers.ts#L153-L206"
    title: "Claude has no Ask first level in full reach"
  - id: confined-rows
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-providers.ts#L221-L394"
    title: "Grok through custom ACP set workspace enforcement to confined-process"
  - id: approval-default
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-approvals.ts#L70-L84"
    title: "Auto-approve defaults on and stays off the Team API"
  - id: sandbox-mode
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/workspace-sandbox.ts#L6-L18"
    title: "Codex sandbox mode is workspace-write or danger-full-access"
  - id: sandbox-policy
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/workspace-sandbox.ts#L43-L54"
    title: "Workspace-write keeps network access and the temporary directories"
  - id: thread-start
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L522-L534"
    title: "thread/start sends the workspace cwd, on-request approval, and the sandbox mode"
  - id: thread-params
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L953-L980"
    title: "Resume params repeat cwd, approval policy, and sandbox"
  - id: thread-resume
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L993-L1011"
    title: "Resume unarchives a Codex thread and resumes again"
  - id: session-computer
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L858-L889"
    title: "A task thread drops Computer Use; Claude receives workspaceOnly"
  - id: turn-start
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/drain-scheduler.ts#L716-L733"
    title: "turn/start repeats cwd, on-request approval, and the sandbox policy"
  - id: profile-never
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/profile-generation.ts#L114-L129"
    title: "Profile generation uses a read-only sandbox and approvalPolicy never"
  - id: confine-header
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/process-confinement.ts#L7-L16"
    title: "Process confinement exists on macOS; other platforms refuse to start"
  - id: confine-spawn
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/process-confinement.ts#L260-L290"
    title: "sandbox-exec wraps the spawn; Linux throws instead of starting"
  - id: seatbelt
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/process-confinement.ts#L297-L327"
    title: "Seatbelt allows by default, then denies writes outside the roots"
  - id: own-process
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/provider-runtime.ts#L2028-L2041"
    title: "A confined-process provider gets its own process and writable roots"
  - id: claude-sandbox
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/claude-workspace-sandbox.ts#L13-L38"
    title: "Claude Workspace only sandboxes Bash and asks on outside writes"
  - id: claude-can-use
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/claude-client.ts#L744-L767"
    title: "Claude allows tools in full reach and asks only for outside writes"
  - id: claude-query
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/claude-client.ts#L791-L838"
    title: "Claude query options: cwd, strict MCP, permissionMode default, workspace sandbox"
  - id: agent-root
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-store.ts#L187-L193"
    title: "Agents, shared files, and downloads live under ~/OpenBot"
  - id: agent-create
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-store.ts#L1577-L1591"
    title: "A new agent gets full access and a workspace directory named by its id"
  - id: codex-spawn
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/app-server-client.ts#L82-L100"
    title: "Codex app-server is a stdio child"
  - id: acp-owner
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/acp-connection.ts#L47-L80"
    title: "ACP connection owns the child process and can wrap it with confinement"
  - id: acp-stream
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/acp-connection.ts#L103-L119"
    title: "ACP uses newline-delimited JSON on the child stdin and stdout"
  - id: grok-acp
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/grok-client.ts#L14-L35"
    title: "Grok is an ACP client and confines its spawn when required"
  - id: cline-local
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/provider-drivers.ts#L220-L227"
    title: "Cline sessions stay in the spawned process"
  - id: window-sandbox
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/main-window.ts#L173-L180"
    title: "The main window enables context isolation and the Electron sandbox"
  - id: trusted-ipc
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/trusted-ipc.ts#L135-L148"
    title: "IPC rejects an untrusted renderer before decoding"
  - id: trusted-url
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/trusted-renderer.ts#L1-L9"
    title: "A trusted renderer is the dev origin or the openbot-app origin"
  - id: team-ws
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/team-api-server.ts#L351-L400"
    title: "Team API events are a token-authenticated WebSocket upgrade"
  - id: attention-grant
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/attention-registry.ts#L597-L605"
    title: "Full access auto-accepts; Workspace only and Ask first do not"
  - id: memory-turns
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/developer-instructions.ts#L25-L29"
    title: "Claude memories travel with user turns so the instruction prefix stays stable"
  - id: memory-label
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/developer-instructions.ts#L69-L72"
    title: "Saved memories are labeled untrusted data"
  - id: memory-budget
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-memory-context.ts#L3-L9"
    title: "Essential-memory prompt budget is 8192 bytes"
  - id: memory-store
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/memory-store.ts#L10-L18"
    title: "One memory table shape for agents, channels, and messaging connections"
  - id: agent-tables
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-data/agent-tables.ts#L47-L74"
    title: "Shared agent database under the shared root; the class does not open SQLite"
  - id: agent-db-host
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-data/agent-database-host.ts#L1-L9"
    title: "The shared database runs in a killable child process"
  - id: agent-auth
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-data/agent-database-host.ts#L69-L118"
    title: "SQLite authorizer denies attach and foreign schema changes"
  - id: browser-partition
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/browser-host.ts#L383"
    title: "Embedded browser uses the persist:openbot-browser session"
  - id: browser-permission
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/browser-host.ts#L2223-L2225"
    title: "Browser permission prompts use an allow-list"
  - id: cua-header
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/cua-driver-runtime.ts#L1-L2"
    title: "Computer Use is a long-lived child and an MCP entry providers spawn"
  - id: mcp-store
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mcp-server-store.ts#L17-L26"
    title: "MCP configs are stored directly so secrets stay out of the event log"
  - id: developer-mcp
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/developer-instructions.ts#L176"
    title: "Developer instructions say MCP servers apply to every agent"
  - id: mcp-computer
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mcp-provider-shapes.ts#L161-L176"
    title: "Computer Use is omitted from the MCP set when the agent has it off"
  - id: mcp-bridge
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/local-mcp-bridge.ts#L90-L110"
    title: "OpenBot tools are a loopback MCP server with a bearer token"
  - id: mcp-listen
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/local-mcp-bridge.ts#L175-L184"
    title: "The bridge listens on 127.0.0.1 with an ephemeral port"
  - id: channel-owner
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/channel-service.ts#L577-L595"
    title: "A channel task keeps one owner at a time"
  - id: messaging-platforms
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-messaging.ts#L15-L16"
    title: "Messaging platforms are Slack, Discord, and Telegram"
  - id: queue-next
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L1148-L1154"
    title: "The next delivery is the first queued item that may start"
  - id: queue-order
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L1199-L1203"
    title: "Queued deliveries are sorted by queue order"
  - id: queue-compare
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L2522-L2527"
    title: "Queue order, then createdAt, then id"
  - id: queue-controls
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/queue-controls.ts#L45-L49"
    title: "Queue controls own cancel, edit, update, reorder, and steer"
  - id: queue-pause-read
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/database/mailbox-projection.ts#L303-L305"
    title: "The mailbox projection reads agents whose queue row is paused"
  - id: queue-pause-write
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/database/mailbox-projection.ts#L237-L245"
    title: "Each mailbox write replaces queue state and marks the paused ids"
  - id: queue-pause-delete
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L1329"
    title: "Agent deletion removes that agent from the paused set"
  - id: mailbox-schema
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/openbot-database-schema.ts#L240-L266"
    title: "Mailbox messages, deliveries, and queue state are SQLite projections"
  - id: provider-session
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/database/provider-sessions.ts#L7-L44"
    title: "One active provider session per thread, hidden from the renderer"
  - id: backup-move
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-service.ts#L2564-L2608"
    title: "Automatic backup models apply when no turn has started"
  - id: opencode-overlay
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/opencode-config.ts#L1-L8"
    title: "Custom endpoints are an OpenCode config overlay"
  - id: opencode-entry
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/opencode-config.ts#L91-L109"
    title: "A custom endpoint uses OpenCode's OpenAI-compatible adapter"
  - id: opencode-live
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/provider-drivers.ts#L645-L649"
    title: "The live OpenCode client passes an empty config base"
  - id: opencode-profile
    resource: "https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/provider-drivers.ts#L664-L674"
    title: "The deny-by-default OpenCode permission layer is the profile-generation client"
  - id: vision-exec
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/VISION.md#L78-L88"
    title: "The harness owns execution; approvals stay out of prompts"
  - id: vision-place
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/VISION.md#L186-L206"
    title: "Surface, Node, executor, Workspace, and Sandbox stay separate"
  - id: spec-boundary
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L33-L37"
    title: "Distributed direction is not current architecture"
  - id: spec-approval
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L75-L77"
    title: "Operator permissions ship; interactive approval does not"
  - id: spec-exec
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L106-L110"
    title: "Runs execute through pg-boss; no Node protocol ships"
  - id: spec-bash
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L290-L301"
    title: "Shipped bash is host-user authority"
  - id: spec-provider
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L315-L317"
    title: "Operators configure providers; user BYOK does not ship"
  - id: spec-channel
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L394-L396"
    title: "No external messaging channel ships"
  - id: spec-memory
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L402-L412"
    title: "Authored personalization ships; inferred memory does not"
  - id: roadmap-cli
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/ROADMAP.md#L163-L183"
    title: "Standalone Node and CLI remain unselected backlog"
  - id: roadmap-sandbox
    resource: "https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/ROADMAP.md#L185-L210"
    title: "Local Sandbox execution remains capability design"
---

# OpenBot

- **Stack:** Electron, SolidJS, and Bun are package keywords; SQLite holds the mailbox projections and the shared agent database; peer CLIs use stdio JSON lines, the Agent Client Protocol, and the Claude Agent SDK; PolyForm Noncommercial 1.0.0.[^package-json][^package-keywords][^mailbox-schema][^agent-db-host][^codex-spawn][^acp-stream][^claude-query][^license-heading]

**Status:** Source inspection of `9f2f38c22c77919b5d0ec728730365165a5d6485` (package version 0.48.2). The app was not run. No provider CLI, Seatbelt profile, Claude sandbox, browser session, or Team API socket was started. The README names `openbot.run/app` as one client of a self-hosted server. That site was not fetched, so it is unpinned and unused as evidence.[^readme-site]

OpenBot is a local-first desktop workspace for persistent agents. The README says each agent has its own workspace and conversation, and that the app drives the Codex app server, Claude Code, Grok, and, through ACP, OpenCode, Gemini, Cursor, and Cline.[^readme-intro] The provider id list at this revision also includes Pi, Muse, Inception, and a custom ACP command.[^provider-ids] The Electron main process owns the window and trusted IPC. The backend owns the agent runtime, SQLite, and provider clients. Peer CLIs are separate children and run their own shell and file tools. This note sits under harnesses because that index is for software that hosts tool-enabled agent execution. A standalone tool or plugin would sit under tools.

llame's VISION keeps Surface, Node, executor, Workspace, and Sandbox as separate boundaries, and it keeps identity, credentials, authorization, and approvals out of prompts and out of model-controlled sandboxes.[^vision-exec][^vision-place] SPEC says an entered Workspace is an owner-scoped binding on the configured native executor or an experimental remote Machine, and that no Node protocol ships.[^spec-boundary][^spec-exec] ROADMAP leaves the standalone personal Node and CLI unselected, and it sequences local Sandbox execution after that Node runtime. The Nix, container, process-confinement, or VM realization remains capability design.[^roadmap-cli][^roadmap-sandbox] The findings below describe OpenBot. They leave those llame designs undecided.

The [OpenDots](./opendots.md) note uses the words "OpenBot computer services" for OpenDots' own computer tools. Those citations point at the CopilotKit OpenDots tree. This note is the nightly-labs/openbot repository and does not compare the two trees.

**Study**

1. **The desktop owns the conversation. The peer CLI is a child process. The renderer is a sandboxed client of the main process.** The main window sets `contextIsolation`, `sandbox`, and `webSecurity`, and leaves `nodeIntegration` off.[^window-sandbox] Trusted IPC rejects a sender whose frame is outside the dev origin or `openbot-app://app` before it decodes the payload.[^trusted-ipc][^trusted-url] The repository guidance says that boundary stays mandatory because coding agents already have `danger-full-access`.[^agents-boundary] The Team API HTTP server returns early for a remote-screen upgrade and a browser-view upgrade. The comment says the browser-view socket carries the WebRTC session this host opened rather than a member token. The events path then accepts the upgrade only when the subprotocol carries a member token that `authenticate` accepts.[^team-ws] Chats, files, and commands stay on the computer that runs OpenBot. Provider logins, visited pages, and plugins may use the network. Cloudflare holds accounts and memberships.[^agents-local] The README also names the desktop app, the iPhone app, and `openbot.run/app` as clients of a self-hosted server.[^readme-site] Those clients reach the host that stores the chats. This note does not add OpenBot to the [multi-machine placement](./index.md#multi-machine-and-container-placement) list, which reserves that list for execution on more than one machine. High confidence for the IPC check and the event-socket token check that were read. No window was opened.
2. **A session is a SQLite thread plus one active provider session. Start and resume both send the host workspace as `cwd`.** `openbot.db` stores mailbox messages, deliveries, and per-agent queue state as projections.[^mailbox-schema] Provider session rows record the CLI's external session id, model, and effort. Binding a session deactivates the thread's previous active row for that provider, and that table stays off the renderer.[^provider-session] `thread/start` sends `cwd: agent.workspacePath`, `approvalPolicy: "on-request"`, and `sandbox: codexSandboxMode(agent)`.[^thread-start] Resume builds the same cwd, approval policy, and sandbox, then calls `thread/resume`. A Codex archived-thread error unarchives and resumes again. Other providers return the failure.[^thread-params][^thread-resume] `turn/start` repeats the cwd, `approvalPolicy: "on-request"`, and the sandbox policy.[^turn-start] Codex is a child running `app-server --listen stdio://`, and stdout is fed to a `JsonLineDecoder`.[^codex-spawn] ACP, including Grok, spawns the CLI and speaks newline-delimited JSON on its stdin and stdout. A confinement callback may wrap that spawn first.[^acp-owner][^acp-stream][^grok-acp] Cline is started with `CLINE_SESSION_BACKEND_MODE=local` so its sessions stay in that process.[^cline-local] Claude is an in-process Agent SDK `query` whose options include `cwd`, `permissionMode: "default"`, and `strictMcpConfig: true`. The SDK's own process spawn was not read.[^claude-query] `nextQueued` takes the first delivery with status `queued` for that lane, after the list is sorted by `queueOrder`, then `createdAt`, then id. Queue controls cancel, edit, update, reorder, and steer. The class comment says channel work is refused there.[^queue-next][^queue-order][^queue-compare][^queue-controls] The README calls the queue FIFO and says it pauses and resumes.[^readme-queue] A search for `pausedAgentIds` found the projection reading rows with `paused = 1`, rewriting `paused = 1` for ids already in the set, and one removal of an id while deleting the agent. No assignment that adds an id was found, so the pause and resume controls stay unverified.[^queue-pause-read][^queue-pause-write][^queue-pause-delete] High confidence for the start, resume, and spawn calls that were read. Nothing was resumed.
3. **The host assigns the workspace. The model does not pick a project directory.** A new agent record sets `access` to the default `full`, `computerUse` to true, and `workspacePath` to `~/OpenBot/Agents/<agent id>`. The shared directory is `~/OpenBot/Shared`.[^access-default][^agent-root][^agent-create] Product guidance says an agent keeps that workspace, thread, and identity across a provider switch.[^agents-local] The architecture note names `~/.codex`, `~/.claude`, and the other provider homes as login and resume state, and says they are not OpenBot conversation storage. This pass confirmed the workspace path the agent record stores, and did not open those directories.[^structure-homes] llame's CLI start directory, when that backlog is selected, would advertise the directory where the CLI was started and would disclose that grant as host-user authority.[^roadmap-cli] OpenBot's directory is an app-created folder under the home directory. It is a useful contrast in shape: the host writes the cwd, and start and resume both send that string. It is a different placement rule from a user-selected project. SPEC's entered Workspace remains an owner-scoped executor binding.[^spec-boundary][^vision-place] High confidence for the path stored on the agent record. A directory was not created.
4. **Shell and file tools run in the peer. OpenBot tools, the browser, and the shared agent database run on the host.** Codex and ACP children execute their own tools inside the spawned process, with the confinement wrapper when one is applied.[^codex-spawn][^acp-owner][^own-process] OpenBot's own tools are a Streamable HTTP MCP server. The bridge binds `127.0.0.1` on an ephemeral port and returns `http://127.0.0.1:<port>/mcp` with a bearer token per namespace. The provider child receives that URL. The request handler is the bridge that bound the port.[^mcp-bridge][^mcp-listen] The embedded browser uses the persistent Electron session `persist:openbot-browser`, and permission prompts go through an allow-list helper.[^browser-partition][^browser-permission] Computer Use is a long-lived child this process owns. Providers receive it as an MCP server, and a task thread of an agent that has Computer Use on is given `computerUse: false` so the agent's own chat keeps the screen.[^cua-header][^mcp-computer][^session-computer] The driver binary, its socket, and the permission checks were not executed. Agent-created tables live in one SQLite file, `agent-data.db`, under the shared `Data` directory. `AgentTables` does not open that file. A separate child process does, because a blocked `sqlite3_step` cannot be interrupted in-process. The authorizer denies `ATTACH` and `DETACH`, denies most `PRAGMA`s, and denies `DROP` or `ALTER` of a table another agent created. Every agent may change rows in every table.[^agent-tables][^agent-db-host][^agent-auth] That is application containment inside one file. It is a different mechanism from llame's owner RLS. High confidence for the split that was read. No tool call was issued.
5. **The default agent is Full access. Workspace confinement is real, provider-specific, and fail-closed where the OS sandbox is missing. Reads and the network stay open.** Stored access is `workspace` or `full`, and the default is `full`.[^access-default] The user-facing level is derived: `workspace` when access is workspace; otherwise `full` when auto-approve is on, and `ask` when it is off. The missing preference file defaults `defaultAutoApprove` to true, so a new agent is Full access.[^permission-levels][^approval-default] Full access selects Codex `danger-full-access`. Workspace access selects `workspace-write`, with the agent workspace and the shared directory as writable roots, `networkAccess: true`, and the temporary directories left writable.[^sandbox-mode][^sandbox-policy] Claude's Workspace only path enables the SDK sandbox with `failIfUnavailable` and `allowUnsandboxedCommands: false` for Bash, and a `PreToolUse` hook returns `ask` for a write outside the roots. The comment says file tools are outside that Bash sandbox.[^claude-sandbox] In full reach, Claude's `canUseTool` allows every tool other than `AskUserQuestion`. The provider descriptor sets `approvalsInFullAccess` to false, so the Ask first level is omitted for Claude unless the stored level is already `ask`.[^claude-can-use][^claude-ask] The descriptor rows from Grok through custom ACP, including Antigravity (shown as Gemini), Cursor, Cline, Pi, Muse, and Inception, set `workspaceEnforcement` to `confined-process`. The provider runtime starts a process of its own for that value and passes writable roots.[^confined-rows][^own-process] That spawn uses `/usr/bin/sandbox-exec` on macOS. The Seatbelt profile allows by default, denies `file-write*`, allows the writable roots, and denies protected project-settings paths again, so the last matching rule wins. The comment says reads, the network, and process starts stay open. On Linux the function throws, with a comment that bubblewrap cannot deny a protected file that does not exist yet. Windows has no branch, so it throws the same error. The access comment says the process does not start on Linux and Windows.[^confine-header][^confine-spawn][^seatbelt][^access-enforced] A Workspace only agent on those providers does not start. The AppImage note and the Docker seccomp profile are about keeping the Electron sandbox. They are a different fence from this Seatbelt profile.[^readme-apparmor][^readme-docker] The README warning still says agents run with `danger-full-access` and `approvalPolicy: never`. The three live `thread/start`, `thread/resume`, and `turn/start` sites send `on-request`. The string `never` appears on the ephemeral profile-generation thread, which also sets `sandbox: "read-only"` and disables tools.[^readme-intro][^profile-never] The default stored level is still Full access, and the security section calls full local access an explicit product decision.[^readme-security] `AttentionRegistry` auto-accepts an approval when the agent is outside the workspace sandbox and the grant is on. A Workspace only agent and an Ask first agent keep the card.[^attention-grant] The grant file is host-local. The contract comment says released Team API adapters freeze an approval response to `accept` or `decline`, so a client cannot grant Full access on a remote host's behalf.[^approval-default] llame ships operator allow/reject permissions and a per-Run `default | bypass` mode. An interactive approval workflow does not ship. Shipped `bash` runs as the host OS user, or as the remote login user for a `machine://` or `ssh://` cwd.[^spec-approval][^spec-bash] The borrow for the unshipped Sandbox direction is the refusal to start when the OS sandbox cannot be built. ROADMAP says sandbox failure never falls back to native execution without a new authorization decision, and leaves the Nix, container, process-confinement, or VM realization as capability design.[^roadmap-sandbox] OpenBot's default level is the unrestricted mode, and its workspace modes still allow reads and the network. High confidence for the policy strings and the Seatbelt text that were read. No sandbox was applied.
6. **Memory is a bounded untrusted prompt block, plus a shared table file. It is a single-computer store.** Agent, channel, and messaging memories share one SQL shape with a different owner column.[^memory-store] Essential memories are serialized under an 8192-byte budget. The instruction text tells the model they are untrusted data and that a command inside a memory is data.[^memory-budget][^memory-label] For Claude, memories go out with the user turns. The comment says the developer instructions sit in the cached prefix, so a memory edit there would rewrite the conversation prefix.[^memory-turns] The shared `agent-data.db` is a second store: agents create tables, and every agent can read and write every table.[^agent-tables] llame's authored personalization ships, and it is authored rather than inferred. Semantic facts and automatic injection do not ship.[^spec-memory] A labeled budget and a cache-stable instruction prefix are the pieces to study. The shared table file has no owner RLS. High confidence for the label, the budget, and the authorizer that were read. No memory row was written.
7. **Model choice is a per-agent provider and model. Custom OpenAI-compatible endpoints are an OpenCode overlay. Channels and MCP are host features.** An automatic backup list moves an agent to the first ready backup when a usage limit or a provider error holds the current model, the agent has no started turn, and queued or channel work is waiting. The agent returns to the model it left once that model is ready. A list that is saved and not marked automatic does not take this branch.[^backup-move] OpenCode receives custom endpoints through `OPENCODE_CONFIG_CONTENT`, as another config layer, using the CLI's bundled `@ai-sdk/openai-compatible` adapter. The live OpenCode client passes an empty base object into that overlay. The profile-generation client is the one that sets deny-by-default with bash and read set to ask.[^opencode-overlay][^opencode-entry][^opencode-live][^opencode-profile] Operators configure llame providers in instance config. User BYOK does not ship, and this note does not move model selection into a peer CLI.[^spec-provider] Messaging platforms in the contract are Slack, Discord, and Telegram. An in-app channel task keeps one owner; a transfer replaces that owner while the previous owner's assignment can still be running.[^messaging-platforms][^channel-owner] MCP server rows are written to the table directly so `Authorization` values stay out of the append-only event log.[^mcp-store] The developer instructions say MCP servers apply to every agent.[^developer-mcp] Skills and the marketplace UI were not inventoried beyond the confinement rule that protects project skill and settings directories from a Workspace only write.[^seatbelt] No external messaging channel ships in llame.[^spec-channel] High confidence for the backup branch, the OpenCode overlay, and the channel-owner check that were read. No message was delivered.
8. **The license is PolyForm Noncommercial 1.0.0.** `LICENSE` is that text. Permitted purposes are noncommercial purposes, including personal research, experiment, and testing without an anticipated commercial application. The required notices name Synthetify Labs and a commercial-license contact.[^license-heading][^license-purpose][^license-notice] `package.json` sets `license` to `PolyForm-Noncommercial-1.0.0`. The README says versions up to and including 0.1.11 remain available under Apache-2.0. This pass did not inspect that tag.[^package-json][^readme-license] This note is a behavior study. It is a poor source to copy.

**Caution**

The README warning and the live approval strings disagree. Live start and resume send `approvalPolicy: "on-request"`. The default access and the default auto-approve grant still select Full access and the `danger-full-access` sandbox, and the registry then accepts those approvals without a card.[^readme-intro][^thread-start][^attention-grant][^approval-default] Workspace mode on a confined-process provider refuses to start on Linux and Windows. On macOS the Seatbelt profile allows reads, the network, and process starts.[^confine-spawn][^seatbelt] Claude in full reach allows its own tools inside `canUseTool`.[^claude-can-use] The Electron sandbox and the Docker seccomp profile confine the renderer and the container. They do not confine a Full access CLI.[^window-sandbox][^readme-docker][^agents-boundary] Queue pause and resume are described in the README. A search for `pausedAgentIds` found persistence of the existing set and a removal on agent delete, and no assignment that adds an id.[^readme-queue][^queue-pause-read][^queue-pause-write][^queue-pause-delete] The shared agent database lets every agent read and write every table.[^agent-tables][^agent-auth] There is no tenant RLS. The license forbids commercial use of this revision.[^license-purpose] Nothing in this note was executed. llame's approval, Workspace, bash, and memory contracts remain the ones in SPEC, VISION, and ROADMAP.[^spec-approval][^spec-bash][^spec-memory][^vision-place][^roadmap-sandbox]

[^readme-intro]: [Local-first desktop for persistent teammates, and the preview access warning](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L4-L16)

[^readme-queue]: [FIFO queues with pause, resume, cancellation, and persistence](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L25)

[^readme-site]: [A self-hosted server is used from the desktop, the iPhone app, or openbot.run/app](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L92-L93)

[^readme-apparmor]: [AppImage launch refuses to drop the Electron sandbox](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L58-L68)

[^readme-docker]: [Container seccomp keeps the Electron sandbox on](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L96-L104)

[^readme-security]: [Full local access is an explicit product decision](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L573-L581)

[^readme-license]: [PolyForm Noncommercial, with Apache-2.0 named for versions through 0.1.11](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/README.md#L601-L609)

[^license-heading]: [PolyForm Noncommercial License 1.0.0 heading](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/LICENSE#L1-L3)

[^license-purpose]: [Permitted purposes are noncommercial, including personal research](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/LICENSE#L32-L37)

[^license-notice]: [Copyright notice and commercial-license contact](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/LICENSE#L75-L77)

[^package-json]: [Package version 0.48.2 and PolyForm-Noncommercial-1.0.0](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/package.json#L2-L11)

[^package-keywords]: [Package keywords name Electron, Bun, and SolidJS](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/package.json#L20-L28)

[^agents-boundary]: [Renderer sandbox stays mandatory because coding agents already have full access](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/AGENTS.md#L31-L33)

[^agents-local]: [Chats stay on the host; agents keep workspace and identity across provider switches](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/AGENTS.md#L41-L48)

[^structure-homes]: [Provider home directories are login and resume state, not conversation storage](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/docs/architecture/structure.md#L88-L90)

[^access-default]: [Access is workspace or full, and the default is full](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-agents.ts#L31-L37)

[^access-enforced]: [Workspace access is enforced per provider](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-agents.ts#L60-L68)

[^permission-levels]: [Workspace, Ask first, and Full access from access plus auto-approve](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-agent-admin.ts#L39-L73)

[^provider-ids]: [Provider ids include Pi, Muse, Inception, and a custom ACP command](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-providers.ts#L22-L34)

[^claude-ask]: [Claude has no Ask first level in full reach](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-providers.ts#L153-L206)

[^confined-rows]: [Grok through custom ACP set workspace enforcement to confined-process](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-providers.ts#L221-L394)

[^approval-default]: [Auto-approve defaults on and stays off the Team API](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-approvals.ts#L70-L84)

[^sandbox-mode]: [Codex sandbox mode is workspace-write or danger-full-access](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/workspace-sandbox.ts#L6-L18)

[^sandbox-policy]: [Workspace-write keeps network access and the temporary directories](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/workspace-sandbox.ts#L43-L54)

[^thread-start]: [thread/start sends the workspace cwd, on-request approval, and the sandbox mode](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L522-L534)

[^thread-params]: [Resume params repeat cwd, approval policy, and sandbox](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L953-L980)

[^thread-resume]: [Resume unarchives a Codex thread and resumes again](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L993-L1011)

[^session-computer]: [A task thread drops Computer Use; Claude receives workspaceOnly](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/thread-lifecycle.ts#L858-L889)

[^turn-start]: [turn/start repeats cwd, on-request approval, and the sandbox policy](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/drain-scheduler.ts#L716-L733)

[^profile-never]: [Profile generation uses a read-only sandbox and approvalPolicy never](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/profile-generation.ts#L114-L129)

[^confine-header]: [Process confinement exists on macOS; other platforms refuse to start](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/process-confinement.ts#L7-L16)

[^confine-spawn]: [sandbox-exec wraps the spawn; Linux throws instead of starting](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/process-confinement.ts#L260-L290)

[^seatbelt]: [Seatbelt allows by default, then denies writes outside the roots](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/process-confinement.ts#L297-L327)

[^own-process]: [A confined-process provider gets its own process and writable roots](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/provider-runtime.ts#L2028-L2041)

[^claude-sandbox]: [Claude Workspace only sandboxes Bash and asks on outside writes](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/claude-workspace-sandbox.ts#L13-L38)

[^claude-can-use]: [Claude allows tools in full reach and asks only for outside writes](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/claude-client.ts#L744-L767)

[^claude-query]: [Claude query options: cwd, strict MCP, permissionMode default, workspace sandbox](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/claude-client.ts#L791-L838)

[^agent-root]: [Agents, shared files, and downloads live under ~/OpenBot](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-store.ts#L187-L193)

[^agent-create]: [A new agent gets full access and a workspace directory named by its id](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-store.ts#L1577-L1591)

[^codex-spawn]: [Codex app-server is a stdio child](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/app-server-client.ts#L82-L100)

[^acp-owner]: [ACP connection owns the child process and can wrap it with confinement](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/acp-connection.ts#L47-L80)

[^acp-stream]: [ACP uses newline-delimited JSON on the child stdin and stdout](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/acp-connection.ts#L103-L119)

[^grok-acp]: [Grok is an ACP client and confines its spawn when required](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/grok-client.ts#L14-L35)

[^cline-local]: [Cline sessions stay in the spawned process](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/provider-drivers.ts#L220-L227)

[^window-sandbox]: [The main window enables context isolation and the Electron sandbox](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/main-window.ts#L173-L180)

[^trusted-ipc]: [IPC rejects an untrusted renderer before decoding](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/trusted-ipc.ts#L135-L148)

[^trusted-url]: [A trusted renderer is the dev origin or the openbot-app origin](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/trusted-renderer.ts#L1-L9)

[^team-ws]: [Team API events are a token-authenticated WebSocket upgrade](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/team-api-server.ts#L351-L400)

[^attention-grant]: [Full access auto-accepts; Workspace only and Ask first do not](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/attention-registry.ts#L597-L605)

[^memory-turns]: [Claude memories travel with user turns so the instruction prefix stays stable](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/developer-instructions.ts#L25-L29)

[^memory-label]: [Saved memories are labeled untrusted data](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/developer-instructions.ts#L69-L72)

[^memory-budget]: [Essential-memory prompt budget is 8192 bytes](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/agent-memory-context.ts#L3-L9)

[^memory-store]: [One memory table shape for agents, channels, and messaging connections](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/memory-store.ts#L10-L18)

[^agent-tables]: [Shared agent database under the shared root; the class does not open SQLite](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-data/agent-tables.ts#L47-L74)

[^agent-db-host]: [The shared database runs in a killable child process](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-data/agent-database-host.ts#L1-L9)

[^agent-auth]: [SQLite authorizer denies attach and foreign schema changes](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-data/agent-database-host.ts#L69-L118)

[^browser-partition]: [Embedded browser uses the persist:openbot-browser session](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/browser-host.ts#L383)

[^browser-permission]: [Browser permission prompts use an allow-list](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/browser-host.ts#L2223-L2225)

[^cua-header]: [Computer Use is a long-lived child and an MCP entry providers spawn](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/main/cua-driver-runtime.ts#L1-L2)

[^mcp-store]: [MCP configs are stored directly so secrets stay out of the event log](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mcp-server-store.ts#L17-L26)

[^developer-mcp]: [Developer instructions say MCP servers apply to every agent](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/developer-instructions.ts#L176)

[^mcp-computer]: [Computer Use is omitted from the MCP set when the agent has it off](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mcp-provider-shapes.ts#L161-L176)

[^mcp-bridge]: [OpenBot tools are a loopback MCP server with a bearer token](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/local-mcp-bridge.ts#L90-L110)

[^mcp-listen]: [The bridge listens on 127.0.0.1 with an ephemeral port](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/local-mcp-bridge.ts#L175-L184)

[^channel-owner]: [A channel task keeps one owner at a time](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/channel-service.ts#L577-L595)

[^messaging-platforms]: [Messaging platforms are Slack, Discord, and Telegram](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/packages/contracts/src/ipc-messaging.ts#L15-L16)

[^queue-next]: [The next delivery is the first queued item that may start](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L1148-L1154)

[^queue-order]: [Queued deliveries are sorted by queue order](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L1199-L1203)

[^queue-compare]: [Queue order, then createdAt, then id](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L2522-L2527)

[^queue-controls]: [Queue controls own cancel, edit, update, reorder, and steer](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent/queue-controls.ts#L45-L49)

[^queue-pause-read]: [The mailbox projection reads agents whose queue row is paused](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/database/mailbox-projection.ts#L303-L305)

[^queue-pause-write]: [Each mailbox write replaces queue state and marks the paused ids](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/database/mailbox-projection.ts#L237-L245)

[^queue-pause-delete]: [Agent deletion removes that agent from the paused set](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/mailbox-store.ts#L1329)

[^mailbox-schema]: [Mailbox messages, deliveries, and queue state are SQLite projections](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/openbot-database-schema.ts#L240-L266)

[^provider-session]: [One active provider session per thread, hidden from the renderer](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/database/provider-sessions.ts#L7-L44)

[^backup-move]: [Automatic backup models apply when no turn has started](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/agent-service.ts#L2564-L2608)

[^opencode-overlay]: [Custom endpoints are an OpenCode config overlay](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/opencode-config.ts#L1-L8)

[^opencode-entry]: [A custom endpoint uses OpenCode's OpenAI-compatible adapter](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/opencode-config.ts#L91-L109)

[^opencode-live]: [The live OpenCode client passes an empty config base](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/provider-drivers.ts#L645-L649)

[^opencode-profile]: [The deny-by-default OpenCode permission layer is the profile-generation client](https://github.com/nightly-labs/openbot/blob/9f2f38c22c77919b5d0ec728730365165a5d6485/src/backend/provider-drivers.ts#L664-L674)

[^vision-exec]: [The harness owns execution; approvals stay out of prompts](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/VISION.md#L78-L88)

[^vision-place]: [Surface, Node, executor, Workspace, and Sandbox stay separate](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/VISION.md#L186-L206)

[^spec-boundary]: [Distributed direction is not current architecture](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L33-L37)

[^spec-approval]: [Operator permissions ship; interactive approval does not](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L75-L77)

[^spec-exec]: [Runs execute through pg-boss; no Node protocol ships](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L106-L110)

[^spec-bash]: [Shipped bash is host-user authority](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L290-L301)

[^spec-provider]: [Operators configure providers; user BYOK does not ship](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L315-L317)

[^spec-channel]: [No external messaging channel ships](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L394-L396)

[^spec-memory]: [Authored personalization ships; inferred memory does not](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/SPEC.md#L402-L412)

[^roadmap-cli]: [Standalone Node and CLI remain unselected backlog](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/ROADMAP.md#L163-L183)

[^roadmap-sandbox]: [Local Sandbox execution remains capability design](https://github.com/leon0399/llame/blob/fb5c096b5309e7e2122d23dffd998f5a38d9ebfc/ROADMAP.md#L185-L210)
