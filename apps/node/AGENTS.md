# Personal application composition

Read root AGENTS.md, packages/personal-node/AGENTS.md, and docs/node/integration.md.

- This app owns independent startup and transport lifetime, not a second runtime.
- Never import apps/cli, apps/api, Postgres, or terminal rendering here.
- Keep stdio stdout exclusively protocol data; notices belong on stderr.
- Private IPC version changes require both client negotiation and migration notes.
- No automatic stale-socket replacement, TCP exposure, or silent native fallback.
- Run the direct startup test and CLI process regressions after changing lifecycle.
