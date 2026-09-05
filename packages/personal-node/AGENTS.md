# Personal Node runtime

Read the repository AGENTS.md and docs/node/local-protocol.md first.

- This package owns personal SQLite, provider resolution, execution and tool
  authorization. Terminal prompts and rendering belong to apps/cli.
- Source transcripts and filesystem Knowledge are authoritative; search indexes
  are derived. Never synchronize secrets, host paths or raw token/event progress.
- Client requests cannot change the Node's boot config path or native Workspace
  grant. Skills, retrieved content and models cannot grant execution authority.
- Approval decisions are single-use and initiating-connection bound. Disconnect
  denies them; another Surface cannot take over. Audit the deciding channel.
- Distinguish Surface disconnect, Run cancellation and executor death. Never
  replay a tool side effect just because the observer or executor disappeared.
- Strictly negotiate and bound the private protocol; no unauthenticated TCP
  listener, silent stale-socket fallback, protocol-parity or sync claim.
- Run package tests plus the CLI process regressions after builds. Production MCP
  transports must be verified separately; an injected connection is not wire proof.
