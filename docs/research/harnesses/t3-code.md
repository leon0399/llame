---
type: Reference
title: "T3 Code"
description: "Environment identity, transactional receipts, and provider instances"
resource: "https://github.com/pingdotgg/t3code"
observed:
  date: "2026-09-21"
  revision: "1de563c1491c7d82563e4553bf5bf689ce6adbb9"
sources:
  - id: apps-server-src-environment-serverenvironment-ts-l82-l245
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/environment/ServerEnvironment.ts#L82-L245"
    title: "environment descriptor"
  - id: docs-internals-remote-md-l3-l59
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/docs/internals/remote.md#L3-L59"
    title: "Remote semantics"
  - id: apps-server-src-orchestration-layers-orchestrationengine-ts-l273-l327
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L273-L327"
    title: "orchestration engine"
  - id: apps-server-src-orchestration-layers-orchestrationengine-ts-l144-l171
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L144-L171"
    title: "Receipt reuse"
  - id: apps-server-src-provider-providerdriver-ts-l58-l172
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/provider/ProviderDriver.ts#L58-L172"
    title: "driver contract"
  - id: apps-server-src-provider-services-provideradapter-ts
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/provider/Services/ProviderAdapter.ts"
    title: "Adapter capabilities"
  - id: apps-server-src-orchestration-layers-checkpointreactor-ts-l686-l815
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/CheckpointReactor.ts#L686-L815"
    title: "checkpoint reactor"
  - id: docs-internals-environment-auth-md-l40-l55
    resource: "https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/docs/internals/environment-auth.md#L40-L55"
    title: "authorization documentation"
  - id: apps-server-src-provider-layers-opencodeusagelimits-ts-l18-l28
    resource: "https://github.com/pingdotgg/t3code/blob/1de563c1491c7d82563e4553bf5bf689ce6adbb9/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L18-L28"
    title: "auth.json and usage payload schemas"
  - id: apps-server-src-provider-layers-opencodeusagelimits-ts-l46-l59
    resource: "https://github.com/pingdotgg/t3code/blob/1de563c1491c7d82563e4553bf5bf689ce6adbb9/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L46-L59"
    title: "credential resolution from auth.json or environment"
  - id: apps-server-src-provider-layers-opencodeusagelimits-ts-l63-l103
    resource: "https://github.com/pingdotgg/t3code/blob/1de563c1491c7d82563e4553bf5bf689ce6adbb9/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L63-L103"
    title: "Go usage call, window mapping, and timeout fallback"
---

# T3 Code

- **Stack:** TypeScript/Effect; SQLite server, web, Electron, mobile, relay; MIT

High-confidence reference for future Surface/Node and peer-executor contracts.
Its execution environment owns local state and providers; clients reach that
environment through different transports.

**Study**

1. **F13: Identity independent of endpoint.** The environment descriptor[^apps-server-src-environment-serverenvironment-ts-l82-l245]
   exposes persisted identity and capabilities. Remote semantics[^docs-internals-remote-md-l3-l59]
   separate reachability from execution ownership. Useful for independently
   versioned llame surfaces without turning a transport URL into Node identity.
2. **F14: Commit before notification.** The orchestration engine[^apps-server-src-orchestration-layers-orchestrationengine-ts-l273-l327]
   commits events, projections, and an accepted command receipt together before
   publishing events. Receipt reuse[^apps-server-src-orchestration-layers-orchestrationengine-ts-l144-l171]
   rejects a command ID reused against a different aggregate. Compare the
   transaction boundary with llame's terminal Run/answer settlement; it does
   not justify replacing PostgreSQL with an event-sourcing rewrite.
3. **F15: Instance-scoped peer state.** The driver contract[^apps-server-src-provider-providerdriver-ts-l58-l172]
   requires separate provider instances to own their mutable state and lifetime.
   Adapter capabilities[^apps-server-src-provider-services-provideradapter-ts]
   disclose conversation rollback support. Its checkpoint reactor[^apps-server-src-orchestration-layers-checkpointreactor-ts-l686-l815]
   coordinates Git workspace restoration with provider rollback. Future llame
   Workspace recovery must likewise distinguish file state from peer history;
   neither rollback implies reversal of external side effects.
4. **Go quota read from the Zen API with the user's own key.** Go usage arrives
   from `GET https://opencode.ai/zen/go/v1/usage` with a bearer token, not from a
   console session[^apps-server-src-provider-layers-opencodeusagelimits-ts-l63-l103]. The key
   is resolved from `auth.json`'s `opencode-go` entry with environment
   `OPENCODE_API_KEY` as fallback, the auth file may be replaced wholesale by
   `OPENCODE_AUTH_CONTENT`, and a missing file degrades to
   empty[^apps-server-src-provider-layers-opencodeusagelimits-ts-l46-l59]. `403` means the key is
   valid but carries no Go subscription, so it maps to `unavailable` rather than an
   error, the whole read is bounded by a five-second timeout and a total
   fallback[^apps-server-src-provider-layers-opencodeusagelimits-ts-l63-l103], and the payload's
   rolling, weekly, and monthly windows become labeled usage
   rows[^apps-server-src-provider-layers-opencodeusagelimits-ts-l18-l28]. Moderate confidence for
   llame's quota and credential plumbing (#765): a documented JSON endpoint behind the
   subscription key beats cookie scraping, and "valid key, no subscription" is a
   distinct state from failure.

**Caution:** Remote control targets one environment; it is not Personal Realm
replication or cross-node execution routing. Its authorization documentation[^docs-internals-environment-auth-md-l40-l55]
states that Projects do not sandbox the filesystem and read scope can reach
host-readable absolute paths outside a Project. Provider-instance separation
does not supply llame's datastore tenant isolation. Its OpenCode path also runs
the peer CLI rather than the wire: the provider spawns `opencode serve` and reads
`auth.json` only for usage probing, so client-identification and session-affinity
headers on inference traffic belong to the peer process, not to this host.

[^apps-server-src-environment-serverenvironment-ts-l82-l245]: [environment descriptor](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/environment/ServerEnvironment.ts#L82-L245)

[^docs-internals-remote-md-l3-l59]: [Remote semantics](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/docs/internals/remote.md#L3-L59)

[^apps-server-src-orchestration-layers-orchestrationengine-ts-l273-l327]: [orchestration engine](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L273-L327)

[^apps-server-src-orchestration-layers-orchestrationengine-ts-l144-l171]: [Receipt reuse](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L144-L171)

[^apps-server-src-provider-providerdriver-ts-l58-l172]: [driver contract](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/provider/ProviderDriver.ts#L58-L172)

[^apps-server-src-provider-services-provideradapter-ts]: [Adapter capabilities](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/provider/Services/ProviderAdapter.ts)

[^apps-server-src-orchestration-layers-checkpointreactor-ts-l686-l815]: [checkpoint reactor](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/CheckpointReactor.ts#L686-L815)

[^docs-internals-environment-auth-md-l40-l55]: [authorization documentation](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/docs/internals/environment-auth.md#L40-L55)

[^apps-server-src-provider-layers-opencodeusagelimits-ts-l18-l28]: [auth.json and usage payload schemas](https://github.com/pingdotgg/t3code/blob/1de563c1491c7d82563e4553bf5bf689ce6adbb9/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L18-L28)

[^apps-server-src-provider-layers-opencodeusagelimits-ts-l46-l59]: [credential resolution from auth.json or environment](https://github.com/pingdotgg/t3code/blob/1de563c1491c7d82563e4553bf5bf689ce6adbb9/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L46-L59)

[^apps-server-src-provider-layers-opencodeusagelimits-ts-l63-l103]: [Go usage call, window mapping, and timeout fallback](https://github.com/pingdotgg/t3code/blob/1de563c1491c7d82563e4553bf5bf689ce6adbb9/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L63-L103)
