# apps/web/lib/api

## Generated boundary

`generated/` comes from `apps/api/openapi.json` through Orval 8.24.0. Never edit
it directly. Regenerate both sides with `pnpm generate:api-client`; narrower
commands are `generate:api-schema` and `generate:web-client`. Review the pinned
`@orval/fetch` patch with every Orval upgrade.

Only `lib/api/` and `lib/services/` may import generated runtime modules.
Type-only model imports are allowed in consumers and fixtures. Components and
routes use feature services for requests, query keys, pagination, cancellation,
cache invalidation, and domain errors.

Generated code stays runtime-neutral: relative URLs; no Next, React, TanStack,
environment, or browser imports. Callers inject the policy from `fetch.ts`.
`buildApiUrl` is reserved for explicit AI SDK transports.

The `streaming` OpenAPI tag is excluded. Chat send, reconnect, and run-event
streams remain explicit transports using `buildApiUrl` and `authAwareFetch`.

Keep this layer local until a second independent runtime needs it.
