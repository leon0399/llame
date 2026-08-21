# API Client Layer

## Generated ownership

`generated/` is produced from `apps/api/openapi.json` by Orval 8.24.0. Do not
hand-edit generated files. The API schema is authoritative; regenerate the
schema and client together with:

```bash
pnpm generate:api-client
```

The shorter commands are `pnpm generate:api-schema` and
`pnpm generate:web-client`. The checked-in `@orval/fetch@8.24.0` patch is part
of this reproducible generation path and must be reviewed with any Orval bump.

## Consumption boundary

Generated endpoint modules are service-layer inputs. Only modules under
`lib/services/` and `lib/api/` may consume them; components and routes use
feature services instead of importing generated modules directly. This keeps
the generated contract replaceable without leaking it through the UI. Feature
services retain Query keys, pagination, abort propagation, cache invalidation,
and domain error mapping.

Generated code is portable TypeScript: endpoint URLs stay relative, and the
output has no Next.js, React, TanStack Query, environment, or browser imports.
The caller supplies the final `fetch` argument. Use the authenticated browser,
optional-auth, or server policy factory from `fetch.ts` for the relevant
runtime. Keep `buildApiUrl` for explicit AI SDK transports only.

The OpenAPI `streaming` tag is intentionally excluded. Chat send, reconnect,
and run-event streaming remain explicit AI SDK/Fetch transports and are not part
of the generated client. `buildApiUrl` and `authAwareFetch` in `fetch.ts` exist
only for those explicit stream paths; generated functions always receive an
injected policy and parse non-streaming responses themselves.

Extract this layer into a shared package only when a second independent runtime
consumer exists. Until then, keep the generated client local to `apps/web`.
