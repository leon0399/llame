# Generated API Client Implementation Plan

> **For agentic workers:** REQUIRED: Use
> `superpowers:subagent-driven-development` (if subagents available) or
> `superpowers:executing-plans` to implement this plan. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Replace every handwritten non-streaming web API request and duplicated
contract type with committed Orval-generated Fetch bindings while preserving the
handwritten TanStack Query and streaming layers.

**Architecture:** `apps/api/openapi.json` remains the API-owned contract. Orval
projects that contract into portable, tag-split bindings under
`apps/web/lib/api/generated`; injected Fetch policies own browser and server
runtime behavior, while feature services continue to own Query keys, hooks,
mutations, cache policy, and domain error classification. The work lands as a
seven-branch stack whose final branch deletes this plan and the design spec.

**Tech Stack:** NestJS Swagger, OpenAPI 3, Redocly CLI 2.46.2, Orval 8.24.0,
Fetch, TypeScript, Vitest, TanStack Query 5, Next.js 16, Playwright, gh-stack.

**Design authority:**
`docs/superpowers/specs/2026-08-21-generated-api-client-design.md`

---

## Chunk 1: Contract, Generator, And Core Services

### Task 1: Establish The Contract Layer

**Branch:** `generated-api-client/contract`

**Files:**

- Create: `apps/api/redocly.yaml`
- Create: `apps/api/src/openapi.contract.test.ts`
- Create: `apps/api/src/openapi-errors.integration.test.ts`
- Create: `apps/api/src/common/dto/error-response.dto.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/app.controller.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/chats/chats.controller.ts`
- Modify: `apps/api/src/chats/me-runs.controller.ts`
- Modify: `apps/api/src/chats/shared-chats.controller.ts`
- Modify: `apps/api/src/identity/identity.controller.ts`
- Modify: `apps/api/src/memory/memory.controller.ts`
- Modify: `apps/api/src/models/models.controller.ts`
- Modify: `apps/api/src/personalization/personalization.controller.ts`
- Modify: `apps/api/src/pins/pins.controller.ts`
- Modify: `apps/api/src/pins/dto/pins.dto.ts`
- Modify: `apps/api/src/projects/projects.controller.ts`
- Modify: `apps/api/src/runs/runs.controller.ts`
- Modify: `apps/api/src/identity/dto/identity.dto.ts`
- Modify: `apps/api/openapi.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add failing OpenAPI contract assertions**

Parse `apps/api/openapi.json` in `openapi.contract.test.ts` and assert:

- every operation declares a globally unique domain-oriented `operationId`;
- the exact committed operation-ID set matches an inline sorted list;
- the three event-stream operations include the `streaming` tag;
- `PinnedItemResponse` is a whole-object `oneOf` whose `itemType` discriminator
  correlates with its `item` schema;
- `OrgUnitResponse.directRole` is required and nullable;
- selected 204 responses have no content schema;
- selected conflict/validation responses reference reusable error schemas.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
pnpm --filter api test -- openapi.contract.test.ts
```

Expected: FAIL on controller-derived operation IDs, absent streaming tags, and
the uncorrelated pin schema.

- [ ] **Step 3: Make the API contract explicit**

Add `@ApiOperation({ operationId: "..." })` to every HTTP operation. Use names
based on the API action, not controller or method names. Add `streaming` to the
three SSE operations without changing their existing domain tags.

Replace `PinnedItemResponse`'s independent enum/union fields with explicit chat
and project response branches registered through Nest Swagger's extra-model and
`oneOf` support. Preserve the runtime DTO conversion shape.

Add reusable runtime-backed validation/conflict error DTOs only where web code
uses status/body semantics. Wire those DTOs into the relevant response
decorators; do not annotate description-only failures with invented bodies.

- [ ] **Step 4: Prove typed errors against real HTTP responses**

Add focused integration cases that provoke every newly typed error family and
assert the actual status and JSON body match the documented reusable schema.

Run:

```bash
pnpm --filter api test:integration -- openapi-errors.integration.test.ts
```

Expected: FAIL before the runtime error response and annotation agree, then PASS
after the minimum controller/filter/DTO correction.

- [ ] **Step 5: Regenerate OpenAPI and verify GREEN**

Run:

```bash
pnpm --filter api build
pnpm --filter api test -- openapi.contract.test.ts
```

Expected: API build regenerates `openapi.json`; contract test PASS.

- [ ] **Step 6: Add Redocly correctness linting**

Exact-pin `@redocly/cli@2.46.2` at the workspace root. Configure correctness and
generator-affecting rules as errors, with summary/description completeness as
warnings. Add `openapi:lint` and compose it into the API contract verification
path without converting warning-level documentation debt into a failure.

- [ ] **Step 7: Verify the contract layer**

Run:

```bash
pnpm openapi:lint
pnpm --filter api test
pnpm --filter api test:integration -- openapi-errors.integration.test.ts
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api build
pnpm format:check
git diff --check
```

Expected: all commands PASS and the second API build leaves `openapi.json`
unchanged.

- [ ] **Step 8: Commit the contract layer and create the next branch**

```bash
git add apps/api package.json pnpm-lock.yaml docs/superpowers
git commit -m "feat(api): harden generated client contract"
gh stack add generated-api-client/generator
```

### Task 2: Generate Portable Fetch Bindings

**Branch:** `generated-api-client/generator`

**Files:**

- Create: `apps/web/orval.config.ts`
- Create: `apps/web/lib/api/AGENTS.md`
- Create symlink: `apps/web/lib/api/CLAUDE.md -> AGENTS.md`
- Create symlink: `apps/web/lib/api/GEMINI.md -> AGENTS.md`
- Create: `apps/web/lib/api/fetch.ts`
- Create: `apps/web/lib/api/fetch.test.ts`
- Create: `apps/web/lib/api/errors.ts`
- Create: `apps/web/lib/api/errors.test.ts`
- Create: `apps/web/lib/api/generated/**`
- Create: `apps/web/lib/api/generated.contract.test.ts`
- Modify: `apps/web/lib/api/client.ts`
- Modify: `apps/web/lib/api/client.test.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.prettierignore` only if generated formatting requires an explicit
  ownership boundary

- [ ] **Step 1: Add failing runtime Fetch tests**

Test with real `Request`/`Response` objects and injected spies:

- relative API paths resolve against `NEXT_PUBLIC_API_URL`;
- browser authenticated Fetch defaults credentials to `include` and preserves
  caller headers, body, cache mode, and abort signal;
- unexpected browser 401 clears the registered QueryClient and redirects;
- login/register and optional-auth 401 responses pass through;
- server Fetch forwards request-scoped cookies/options without browser effects.

- [ ] **Step 2: Run the Fetch tests and verify RED**

Run:

```bash
pnpm --filter web test -- lib/api/fetch.test.ts
```

Expected: FAIL because the Fetch policies do not exist.

- [ ] **Step 3: Implement the minimum Fetch policy surface**

Implement separate authenticated-browser, optional-auth, and server policy
factories. Each accepts an underlying `typeof fetch`; generated functions
receive the resulting function through Orval's runtime fetch argument. Keep
`buildApiUrl` temporarily for the explicit AI SDK transports until layer 6.
Make the existing `authAwareFetch` delegate to the new authenticated-browser
policy so generated requests and streaming share one 401/query-clear behavior;
do not maintain parallel hooks.

- [ ] **Step 4: Add failing error-helper tests**

Assert structural recognition of Orval failures with numeric `status` and
unknown `info`, safe status/body access, and rejection of arbitrary errors.

- [ ] **Step 5: Implement structural error helpers and verify GREEN**

Run:

```bash
pnpm --filter web test -- lib/api/fetch.test.ts lib/api/errors.test.ts
```

Expected: PASS.

- [ ] **Step 6: Configure and run Orval**

Exact-pin `orval@8.24.0`. Configure `tags-split`, the bundled Fetch client,
`output.override.fetch.forceSuccessResponse: true`,
`includeHttpResponseReturnType: false`, and `useRuntimeFetcher: true`. Exclude
operations tagged `streaming`. Generate tag directories plus shared models;
run Prettier after generation and never patch generated files manually.

- [ ] **Step 7: Add generated-contract assertions**

Assert representative generated types/functions preserve:

- nullable `OrgUnitResponse.directRole`;
- correlated `PinnedItemResponse` discrimination;
- 204 `void` success;
- selected typed error status/body unions;
- relative `/api/` and `/auth/` endpoint URLs;
- no generated streaming request function;
- no imports from Next.js, React, TanStack Query, browser globals, or app env.

Run the test once before any assertion accommodation. A failure is a contract or
configuration defect; do not hand-edit output.

- [ ] **Step 8: Add deterministic generation and CI drift checks**

Add separate commands for API schema generation, web client generation, and the
full ordered chain. Extend CI's build drift check so it also regenerates the web
client before `git diff --exit-code`. The ordinary web build consumes committed
output and never boots Nest.

- [ ] **Step 9: Document the private-portable boundary**

The nested `AGENTS.md` must state generated ownership, allowed service imports,
streaming exclusions, injected runtime policy, and the extraction trigger: move
to `packages/api-client` only when a second independent runtime consumer exists.

- [ ] **Step 10: Verify and commit the generator layer**

Run:

```bash
pnpm generate:api-client
pnpm --filter web test -- lib/api
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm format:check
git diff --exit-code
```

Expected: all commands PASS; repeated generation is clean.

```bash
git add .github apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): generate portable API bindings"
gh stack add generated-api-client/core-services
```

### Task 3: Migrate Core Services

**Branch:** `generated-api-client/core-services`

**Files:**

- Modify: `apps/web/lib/services/auth/queries.ts`
- Modify: `apps/web/lib/services/auth/queries.test.ts`
- Modify: `apps/web/app/(auth)/login/components/login-form.tsx`
- Modify: `apps/web/lib/services/models/queries.ts`
- Modify: `apps/web/lib/services/models/queries.test.ts`
- Modify: `apps/web/lib/services/memory/queries.ts`
- Create: `apps/web/lib/services/memory/queries.test.ts`
- Modify: `apps/web/lib/services/memory/mutations.ts`
- Create: `apps/web/lib/services/memory/mutations.test.ts`
- Delete: `apps/web/lib/services/memory/types.ts`
- Modify: `apps/web/lib/services/personalization/queries.ts`
- Create: `apps/web/lib/services/personalization/queries.test.ts`
- Modify: `apps/web/lib/services/personalization/mutations.ts`
- Create: `apps/web/lib/services/personalization/mutations.test.ts`
- Modify: `apps/web/lib/services/personalization/types.ts`
- Modify tests and mocks under the same four service directories when their
  handwritten DTO or Ky boundary changes

- [ ] **Step 1: Redirect tests to generated-function boundaries**

Mock the generated endpoint modules, not Ky or `buildApiUrl`. Preserve existing
assertions for Query keys, auth freshness, optional-auth 401-to-null behavior,
logout cleanup, and optimistic settings updates. Add one assertion that unknown
optional-auth failures are rethrown. Add transport and cache-behavior tests for
memory and personalization before changing either implementation.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter web test -- lib/services/auth lib/services/models lib/services/memory lib/services/personalization
```

Expected: FAIL while services still call Ky.

- [ ] **Step 3: Migrate service functions and types**

Replace request construction with generated endpoints plus the correct injected
Fetch policy. Re-export or alias generated model types only where that preserves
the service's domain-facing API. Keep Query keys, hooks, stale times, mutation
scope, optimistic updates, rollback, and invalidation handwritten and unchanged.
Replace `HTTPError` inspection in the login form with the structural error
helper or a service-classified error. Keep `personalization/types.ts` as a thin
facade for generated models plus the locally owned `PERSONALIZATION_CAPS`, because
non-transport consumers still import that module.

- [ ] **Step 4: Verify and commit the core layer**

```bash
pnpm --filter web test -- lib/services/auth lib/services/models lib/services/memory lib/services/personalization
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm format:check
```

Expected: PASS.

```bash
git add apps/web
git commit -m "refactor(web): migrate core API services"
gh stack add generated-api-client/project-pins
```

## Chunk 2: Domain Migrations And Finalization

### Task 4: Migrate Projects And Pins Together

**Branch:** `generated-api-client/project-pins`

**Files:**

- Modify: `apps/web/lib/services/project/queries.ts`
- Modify: `apps/web/lib/services/project/queries.test.ts`
- Modify: `apps/web/lib/services/project/mutations.ts`
- Modify: `apps/web/lib/services/project/mutations.test.ts`
- Modify: `apps/web/lib/services/project/management-mutations.test.tsx`
- Modify: `apps/web/lib/services/project/types.ts`
- Modify: `apps/web/lib/services/pins/queries.ts`
- Modify: `apps/web/lib/services/pins/mutations.ts`
- Modify: `apps/web/lib/services/pins/mutations.test.tsx`
- Modify: `apps/web/lib/services/pins/types.ts`

- [ ] **Step 1: Convert tests to generated boundaries and verify RED**

Preserve filtered query keys, project/chat cross-resource invalidation, pin
discriminator narrowing, optimistic pin/unpin behavior, and rollback assertions.

```bash
pnpm --filter web test -- lib/services/project lib/services/pins
```

Expected: FAIL while production services still use Ky.

- [ ] **Step 2: Replace transport and duplicate DTOs**

Use generated project and pin functions/types. Feature services remain the only
component-facing surface and continue to classify idempotent conflict/not-found
outcomes structurally. Keep each `types.ts` as a service-owned facade of
generated models so existing components do not import generated modules.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter web test -- lib/services/project lib/services/pins
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm format:check
```

```bash
git add apps/web
git commit -m "refactor(web): migrate project and pin APIs"
gh stack add generated-api-client/org-units
```

### Task 5: Migrate Organization Units

**Branch:** `generated-api-client/org-units`

**Files:**

- Modify: `apps/web/lib/services/org-units/queries.ts`
- Modify: `apps/web/lib/services/org-units/mutations.ts`
- Modify: `apps/web/lib/services/org-units/errors.ts`
- Modify: `apps/web/lib/services/org-units/errors.test.ts`
- Modify: `apps/web/lib/services/org-units/mutations.test.ts`
- Modify: `apps/web/lib/services/org-units/types.ts`
- Modify: `apps/web/app/(admin)/admin/organizations/components/api-error-message.tsx`

- [ ] **Step 1: Replace Ky-shaped fixtures with protocol-shaped errors**

Keep every existing optimistic-update, rollback, serialized mutation scope,
membership invalidation, and coded-error classification assertion. Add focused
coverage for documented coded conflicts and unknown error bodies.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter web test -- lib/services/org-units
```

Expected: FAIL until the services and classifier accept generated errors.

- [ ] **Step 3: Migrate endpoints and types**

Use generated org-unit and membership functions. Preserve the feature-owned
error vocabulary consumed by UI copy; components must not inspect generated or
Orval errors. Keep `types.ts` as the component-facing facade of generated
contract models.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter web test -- lib/services/org-units
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm format:check
```

```bash
git add apps/web
git commit -m "refactor(web): migrate organization APIs"
gh stack add generated-api-client/chat-runs
```

### Task 6: Migrate Chats And Runs, Then Remove Ky

**Branch:** `generated-api-client/chat-runs`

**Files:**

- Modify: `apps/web/lib/services/chat/active-runs.ts`
- Modify: `apps/web/lib/services/chat/export.ts`
- Modify: `apps/web/lib/services/chat/fork.ts`
- Modify: `apps/web/lib/services/chat/history.ts`
- Modify: `apps/web/lib/services/chat/management.ts`
- Modify: `apps/web/lib/services/chat/queries.ts`
- Modify: `apps/web/lib/services/chat/runs.ts`
- Modify: `apps/web/lib/services/chat/search.ts`
- Modify: `apps/web/lib/services/chat/server.ts`
- Modify: `apps/web/lib/services/chat/shared.ts`
- Modify: all transport-facing tests in `apps/web/lib/services/chat/*.test.ts*`
- Modify: `apps/web/lib/services/chat/transport.ts`
- Modify: `apps/web/lib/api/client.ts`
- Modify or delete: `apps/web/lib/api/client.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/AGENTS.md`
- Modify: `apps/web/lib/api/AGENTS.md`
- Modify: `SPEC.md`
- Modify: `CHANGELOG.md`
- Modify: `ROADMAP.md` only if a matching unshipped item exists
- Create: `e2e/web/chat/public-share.spec.ts`

- [ ] **Step 1: Move chat tests off Ky and verify RED**

Mock generated endpoint functions for non-streaming requests. Keep explicit
Fetch tests for AI SDK send/resume streams. Preserve pagination, search abort,
SSR cookie/no-store/timeout, active-run 404 mapping, run cancellation conflict,
chat mutation invalidation, and public-share fork behavior.

```bash
pnpm --filter web test -- lib/services/chat contexts/active-runs-context.test.tsx
```

Expected: FAIL while non-streaming services still call Ky.

- [ ] **Step 2: Migrate every non-streaming chat, run, and me endpoint**

Use the generated `chats`, `runs`, and `me` modules, including active runs and
paginated message history. Preserve handwritten conversion of server message
parts into AI SDK `UIMessage`s and all Query key/cache behavior.

Keep send-message, reconnect-chat-stream, and run-event-stream paths explicit.
They may reuse the authenticated Fetch policy and URL resolver, but must not use
a generated function that buffers a stream.

- [ ] **Step 3: Remove the legacy client and Ky**

After `rg` proves no imports remain, delete Ky-specific client/error scaffolding
and remove `ky` from `apps/web/package.json`. Move the URL resolver used by the
explicit streaming transport into `fetch.ts`; delete `lib/api/client.ts` so the
legacy ownership boundary cannot survive under a new implementation.

- [ ] **Step 4: Add anonymous public-share parity coverage**

Create a share as an authenticated fixture, then use an explicit empty storage
state (`test.use({ storageState: { cookies: [], origins: [] } })` or a separate
`browser.newContext({ storageState: undefined })`) to open `/shared/:id`. Assert
the shared chat renders without a login redirect. Do not rely on the default E2E
fixture, which installs a worker-authenticated storage state.

- [ ] **Step 5: Update durable documentation**

Record generated transport ownership and handwritten Query/streaming boundaries
in `SPEC.md`, `apps/web/AGENTS.md`, and nested API instructions. Add the dated
`CHANGELOG.md` entry and remove a matching roadmap item only if one exists.

- [ ] **Step 6: Run the functional completion gate**

```bash
rg -n 'from "ky"|from '\''ky'\''|FakeHTTPError|lib/api/client' apps/web
pnpm generate:api
pnpm generate:api-client
git diff --exit-code
pnpm --filter api test
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api build
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web build
pnpm format:check
pnpm test:e2e -- e2e/web/auth e2e/web/org-units e2e/web/chat
```

Expected: the Ky/error/legacy-client search has no matches except historical documentation;
all checks PASS; regeneration leaves the tree clean; streaming and anonymous
share E2E flows retain behavior.

- [ ] **Step 7: Commit and create the finalization branch**

```bash
git add apps/web e2e SPEC.md CHANGELOG.md ROADMAP.md pnpm-lock.yaml
git commit -m "refactor(web): complete generated API migration"
gh stack add generated-api-client/finalize
```

### Task 7: Delete Temporary Planning Artifacts

**Branch:** `generated-api-client/finalize`

**Files:**

- Delete: `docs/superpowers/specs/2026-08-21-generated-api-client-design.md`
- Delete: `docs/superpowers/plans/2026-08-21-generated-api-client.md`

- [ ] **Step 1: Audit durable decision ownership**

Verify the surviving config, tests, `SPEC.md`, `apps/web/AGENTS.md`, nested
`apps/web/lib/api/AGENTS.md`, and changelog collectively retain every durable
architecture and regeneration decision. Do not add functional code in this
branch.

- [ ] **Step 2: Delete only the two temporary artifacts**

```bash
git rm docs/superpowers/specs/2026-08-21-generated-api-client-design.md
git rm docs/superpowers/plans/2026-08-21-generated-api-client.md
```

- [ ] **Step 3: Verify and commit finalization**

```bash
pnpm lint:markdown
pnpm format:check
git diff --check
git diff --name-status generated-api-client/chat-runs...HEAD
```

Expected: the branch diff contains exactly two deletions.

```bash
git commit -m "docs: retire generated client planning artifacts"
gh stack rebase --upstack --remote origin
gh stack view --json
```

Expected: the saved chain is exactly `master -> contract -> generator ->
core-services -> project-pins -> org-units -> chat-runs -> finalize`, with no
layer needing rebase. Do not push, submit, or merge without Leo's explicit
authorization.
