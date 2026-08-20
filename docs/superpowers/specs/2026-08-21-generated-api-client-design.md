# Generated API Client Design

**Status:** Approved for implementation planning  
**Date:** 2026-08-21  
**Scope:** Replace handwritten non-streaming web API transport and duplicate
contract types with committed Orval output, delivered as a seven-PR stack.

## Context

`apps/api` already generates and commits `apps/api/openapi.json`. CI rebuilds
the API and rejects schema drift. `apps/web` currently duplicates request and
response types and manually implements non-streaming requests with Ky. The web
service layer also owns application behavior that OpenAPI cannot express:
TanStack Query key hierarchies, cache invalidation, optimistic updates,
optional-auth semantics, SSR behavior, and AI SDK streaming.

Generating the transport reduces contract duplication and turns the OpenAPI
document into an executable quality gate. It must not transfer application
cache policy into generator configuration or generated code.

## Goals

- Generate non-streaming TypeScript request functions and contract models from
  the committed OpenAPI document.
- Use Orval's bundled Fetch client, not Ky or a custom HTTP-client mutator.
- Commit deterministic, split-by-tag output and reject drift in CI.
- Keep feature-owned TanStack Query behavior handwritten and colocated.
- Correct schema defects that would produce unsound generated types.
- Replace Ky-specific errors and tests with protocol-shaped error handling.
- Preserve browser auth, optional auth, SSR, and streaming behavior.
- Leave a stable cache-key boundary for a future server-push subsystem.

## Non-Goals

- Publishing a supported API client package.
- Generating React Query hooks, query options, keys, mutations, or cache policy.
- Generating or replacing AI SDK, SSE, or other streaming transports.
- Implementing server-push delivery, event schemas, replay, or cache projectors.
- Rewriting every operation description or typing every framework-generated
  error response in this stack.
- Adding runtime response validation beyond the generated TypeScript contract.

## Architecture

The API remains the sole owner of the HTTP contract. The generated client is a
mechanical projection of `apps/api/openapi.json` and has no product behavior.

```text
apps/api source
  -> apps/api/openapi.json
  -> apps/web/orval.config.ts
  -> apps/web/lib/api/generated/**

browser component
  -> feature service / TanStack Query hook
  -> generated endpoint function
  -> injected web Fetch policy
  -> apps/api
```

The generated bindings remain under `apps/web` until a second independent
runtime consumer exists. Their implementation stays portable so extraction is
mechanical when that trigger occurs: generated files import no Next.js, React,
TanStack Query, browser globals, or environment configuration.

The intended structure is:

```text
apps/web/
  orval.config.ts
  lib/api/
    AGENTS.md
    CLAUDE.md -> AGENTS.md
    GEMINI.md -> AGENTS.md
    fetch.ts
    errors.ts
    generated/
      auth/
      chats/
      me/
      memory/
      models/
      org-units/
      personalization/
      pins/
      projects/
      runs/
```

`AGENTS.md` documents generated-file ownership, regeneration commands,
portability constraints, allowed consumers, streaming exclusions, and the
package-extraction trigger. The symlinks match the repository's instruction
file convention.

## OpenAPI Contract Corrections

Contract correctness precedes client migration.

### Stable Operation IDs

Each controller operation declares an explicit, domain-oriented
`@ApiOperation({ operationId })`. Operation IDs are public contract identifiers,
not values derived from controller or method names. A contract assertion checks
that every operation has an ID, that IDs are globally unique, and that the
committed ID set changes only through an intentional contract diff. Controller
and method refactors therefore cannot silently rename generated functions.

### Correlated Unions

`PinnedItemResponse` becomes a whole-object `oneOf`: the `chat` branch contains
a chat reference card, and the `project` branch contains a project reference
card. The schema must reject cross-paired discriminators and payloads.

Required nullable enums, existing `oneOf` structures, and empty success bodies
receive focused generation assertions. These are known generator failure modes
and must remain correct across Orval upgrades.

### Streaming Classification

Event-stream operations receive a `streaming` OpenAPI tag. Orval excludes any
operation with that tag. Streaming types may remain shared component schemas,
but generated request functions must not buffer or replace live transports.

### Typed Errors

Typed errors are selective and runtime-backed:

- A reusable error envelope documents fields that the API consistently emits.
- Named coded-error schemas cover stable machine-readable codes used by web
  behavior, initially organization conflict and validation outcomes.
- Endpoint-specific error schemas exist only when their shape or semantics are
  genuinely distinct.
- Description-only responses remain valid when the client never consumes the
  body.

Tests compare documented shapes with real exception responses. An annotation
must not describe a cleaner response than the runtime returns.

### Lint Policy

Redocly correctness rules are errors: valid references, unique operation IDs,
valid response schemas, and other generator-affecting invariants. Operation
summary and description completeness starts as warnings. This avoids turning
client generation into an unrelated 49-operation documentation rewrite while
making the remaining debt visible.

## Orval Generation

Orval is exact-pinned. The relevant baseline configuration shape is:

```typescript
output: {
  mode: "tags-split",
  client: "fetch",
  schemas: "./lib/api/generated/models",
  override: {
    fetch: {
      forceSuccessResponse: true,
      includeHttpResponseReturnType: false,
      useRuntimeFetcher: true,
    },
  },
}
```

The generation command runs Prettier over the output. Generated endpoint URLs
remain relative; the OpenAPI document does not supply an absolute server URL,
and generation assertions reject absolute endpoint URLs. The injected Fetch
policy, not Orval URL generation, resolves those paths against the environment's
API origin. `useRuntimeFetcher` provides the per-call Fetch injection only; it
does not perform origin resolution.

Generated operations return success data directly. Failed responses throw an
error carrying a status and parsed `info` body. `lib/api/errors.ts` provides a
structural type guard and accessors so feature code does not depend on Orval's
concrete error class or implementation details.

Generation is available as separate, composable commands:

1. API source to committed OpenAPI document.
2. Committed OpenAPI document to committed web client.
3. Full regeneration in that order.

CI runs the full chain and then `git diff --exit-code`. The normal frontend
build consumes committed output and does not boot Nest.

Generated files are formatted, typechecked, and built. Source-style lint rules
may ignore the generated directory when Orval output conflicts with repository
authoring rules. The boundary is explicit and documented; generated files are
never manually patched to satisfy lint.

## Runtime Fetch Policies

### Browser Authenticated Fetch

The default browser Fetch policy:

- Resolves generated relative paths against `NEXT_PUBLIC_API_URL`.
- Defaults credentials to `include`.
- Preserves caller headers, bodies, cache options, and abort signals.
- Clears the registered QueryClient and redirects to login on an unexpected
  401 response.
- Passes login and registration 401 responses through so forms can display
  credential errors.

It returns the `Response`; generated code owns body parsing and error creation.
The same Fetch policy remains usable by `DefaultChatTransport` with an absolute
URL, preserving the current streaming auth behavior.

### Optional Auth Fetch

Optional-auth Fetch resolves the API origin and includes credentials but never
redirects on 401. `fetchMeOptional` uses the generated auth endpoint, maps a
status 401 error to `null`, and rethrows other failures.

### Server Fetch

SSR uses a server-specific Fetch policy that resolves relative paths without
browser side effects. Server services retain ownership of request-scoped
cookies, `cache: "no-store"`, timeouts, abort signals, and Next.js
`redirect()`/`notFound()` outcomes. Generated functions replace URL assembly,
serialization, and response casting only.

## Feature Service And Query Boundary

Components import feature service hooks, not generated modules. Generated
imports are limited to `lib/services/**` and `lib/api/**`.

Feature services retain:

- Hierarchical, serializable query-key factories.
- Key variables as query dependencies.
- `QueryFunctionContext` for variables encoded in a query key.
- Reusable `queryOptions` factories where SSR, prefetching, or multiple hooks
  share a query contract.
- Mutation keys, optimistic patches, cancellation, rollback, and targeted
  invalidation.
- Cross-resource effects such as project changes invalidating chats and pins.
- Domain-error classification and non-error outcomes such as optional 404s.

Normal and infinite queries never share a key. Query keys remain organized from
generic resource prefixes to specific detail, subresource, and filter keys, in
line with TkDodo's
[Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys).

Orval does not generate React Query hooks, keys, invalidation helpers, cache
setters, or mutation policy. Encoding the cache graph in a central generator
mutator would be less typed and less colocated than the feature factories.

## Server-Push Readiness

Server push is a separate system and future behavioral change. This work only
preserves the boundary it will need.

Feature query-key factories form an internal cache protocol. A future event
projector will translate domain events into feature invalidation or cache
patches. Server events never contain frontend Query keys.

Invalidation is the default response to a pushed event. Direct cache patches
require an authoritative payload and ordering information sufficient to update
every relevant cached shape. Stale-time defaults do not change until push
delivery, reconnect, and replay are reliable.

## Error Handling

The generated Fetch client throws status/body-bearing errors for non-success
responses. The shared structural guard recognizes that protocol without unsafe
type assertions. Feature services then decide whether to:

- Map a status to a non-error domain outcome.
- Classify a stable coded error.
- Produce a domain-specific error for UI copy.
- Rethrow an unknown transport failure.

Components do not inspect Orval errors directly. Unknown or undocumented error
bodies remain `unknown`; the client does not manufacture type safety absent
from OpenAPI.

## Verification

### Contract And Generation

Focused checks prove:

- Operation IDs are unique and controller-independent.
- Every operation declares an explicit operation ID, and the committed ID set
  changes only through an intentional contract update.
- Streaming operations carry the exclusion tag.
- `PinnedItemResponse` generates a correlated discriminated union.
- Required nullable enums preserve `null`.
- Empty success responses generate `void`.
- Selected typed errors preserve their status and body type.
- Repeated generation is deterministic and leaves a clean tree.
- Generated endpoint URLs remain relative and begin with the API path prefix.

### Fetch Policies

Unit tests use injected Fetch functions and real `Request`/`Response` values to
prove:

- Origin resolution and credential inclusion.
- Caller option and abort-signal propagation.
- Browser 401 cache clearing and redirect.
- Credential-submission and optional-auth 401 pass-through.
- SSR cookie and header preservation.
- Typed, empty, and unknown error bodies.

### Query Behavior

Existing Query tests remain authoritative for key structure, cache updates,
optimistic behavior, rollback, and cross-resource invalidation. Ky and
`FakeHTTPError` mocks are replaced with generated-function boundaries or
protocol-shaped errors.

The final functional layer runs existing auth, project, organization, chat, and
streaming flows for behavioral parity. It also adds one focused public-share
parity scenario: an anonymous visitor can open a shared chat without being
redirected to login. This covers the optional-auth transport boundary that the
current E2E suite does not exercise directly.

Each stack layer passes affected unit tests, lint, typecheck, format check, and
sequential workspace builds. The completed stack additionally runs full schema
and client regeneration followed by a clean-diff check.

## Delivery Stack

Work is implemented bottom-to-top as one linear `gh stack` story:

```text
master
<- generated-api-client/contract
<- generated-api-client/generator
<- generated-api-client/core-services
<- generated-api-client/project-pins
<- generated-api-client/org-units
<- generated-api-client/chat-runs
<- generated-api-client/finalize
```

### 1. Contract

Correct OpenAPI schemas, stable operation IDs, streaming classification,
selective reusable typed errors, contract tests, and Redocly linting.

### 2. Generator

Add exact-pinned Orval configuration, committed split-by-tag output, Fetch
policies, structural error helpers, generation assertions, drift CI, and the
nested instruction files. No feature service migrates in this layer.

### 3. Core Services

Migrate auth, models, memory, and personalization. This layer proves normal,
credential-submission, and optional-auth browser flows.

### 4. Project And Pins

Migrate the coupled project and pin domains while retaining their
cross-resource cache invalidation and optimistic behavior.

### 5. Organization Units

Migrate organization queries and mutations, including coded error
classification and the most complex optimistic-update behavior.

### 6. Chat And Runs

Migrate non-streaming chat and run operations, retain explicit streaming and
SSR policies, migrate the `me`-tagged active-runs request, remove Ky and
duplicate DTOs, clean migration orphans, add anonymous public-share parity
coverage, and update current architecture documentation and shipped chronology.

### 7. Finalize

Delete this design spec and its implementation plan after verifying that every
durable decision has moved into the owning documentation, configuration, tests,
or code comments. This layer contains no functional implementation changes.

Intermediate layers may contain both Ky and generated Fetch services, but each
is deployable. The sixth layer is the functional completion gate: no Ky
dependency, no handwritten contract duplicates, no component imports from
generated code, and unchanged streaming behavior. The seventh layer is only the
planning-artifact cleanup gate.

Before submission, rebase upstack and verify the saved parent chain with
`gh stack view --json`. Stack merge remains an explicit user-authorized action.

## Documentation Updates

The final stack state updates:

- `SPEC.md` section 22.0 to state that the web transport and models are
  generated from the API-owned OpenAPI contract.
- `apps/web/AGENTS.md` to replace the Ky description with Orval Fetch and retain
  the streaming exception.
- `CHANGELOG.md` with the shipped client-generation change.
- `ROADMAP.md` only if a matching unshipped item exists at implementation time.

The design does not create an OpenSpec proposal because this change reorganizes
contract projection, build tooling, and client implementation without changing
product behavior.

The design spec and implementation plan are temporary execution artifacts. They
remain committed while the functional stack is under review so each layer has
shared context. A separate finalization PR removes them after functional
completion. `SPEC.md`, workspace instructions, generated-client instructions,
tests, configuration, and the changelog retain the durable decisions without
preserving process scaffolding.

## Acceptance Criteria

- All non-streaming web requests use committed Orval-generated Fetch functions.
- Feature-owned Query hooks and cache behavior remain the component-facing API.
- OpenAPI corrections prevent the known nullability and union failures.
- Selected runtime-backed errors are typed; unknown bodies remain unknown.
- Browser auth, optional auth, SSR, and streaming behavior are preserved.
- Regeneration is deterministic and enforced by CI.
- Ky and Ky-specific test scaffolding are removed.
- Generated bindings remain portable and private to `apps/web` until a second
  independent runtime consumer justifies package extraction.
