---
type: Reference
title: "nanoclaw"
description: "Containerized agent execution and host-side authority"
resource: "https://github.com/nanocoai/nanoclaw"
observed:
  date: "2026-09-10"
  revision: "2c754a2234390fcc597273cef6344d99e8ac03d0"
sources:
  - id: src-container-runner-ts-l808-l1015
    resource: "https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/src/container-runner.ts#L808-L1015"
    title: "mount construction"
  - id: docs-db-session-md-l72-l149
    resource: "https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/docs/db-session.md#L72-L149"
    title: "mailbox contract"
  - id: container-agent-runner-src-mcp-tools-self-mod-ts-l43-l210
    resource: "https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/container/agent-runner/src/mcp-tools/self-mod.ts#L43-L210"
    title: "self-modification requests"
---

# nanoclaw

- **Stack:** TypeScript personal bot host with Linux containers; MIT

NanoClaw routes messaging channels into agent-group sessions and runs agent work
inside per-session containers. Moderate-confidence reference for executor
isolation and host/container messaging in a single-user bot host.

**Study**

1. **Explicit executor mounts.** `container-runner.ts` composes a `SessionSpec` from explicit mounts: session
   workspace and agent-group data are writable, while config, plugins, composed
   instructions, and skills are mounted read-only; extra/provider mounts are
   allowlisted (mount construction[^src-container-runner-ts-l808-l1015]). This is a concrete
   executor isolation pattern if llame moves untrusted tools out of process.
2. **Host/container mailbox.** Host/container messaging uses a per-session mailbox backed by separate SQLite
   databases and sequence parity (mailbox contract[^docs-db-session-md-l72-l149]).
   Self-modification requests are separately approval-gated and validated
   (self-modification requests[^container-agent-runner-src-mcp-tools-self-mod-ts-l43-l210]).

**Caution**

The model/provider and channel integrations are partly external or branch-local;
the host has no user-account or database-RLS model. Its SQLite mailbox and
container mounts do not provide llame's authenticated ownership, pg-boss Run
identity, or provider/tool policy. Copy the boundary and approval seams only
after mapping them to llame's owner identity and fail-closed datastore rules.

[^src-container-runner-ts-l808-l1015]: [mount construction](https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/src/container-runner.ts#L808-L1015)

[^docs-db-session-md-l72-l149]: [mailbox contract](https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/docs/db-session.md#L72-L149)

[^container-agent-runner-src-mcp-tools-self-mod-ts-l43-l210]: [self-modification requests](https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/container/agent-runner/src/mcp-tools/self-mod.ts#L43-L210)
