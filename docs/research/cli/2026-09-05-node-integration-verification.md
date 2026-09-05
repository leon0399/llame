# Node integration iteration: verification and delivery

## Source and scope

Base: round-three `f007c48` from the supplied Git bundle. Implementation branch:
`feat/node-integration`. Implementation source verified in a fresh bundle clone:
`8da6a1508ab991cc2c26e36c610aca9ba05e12ea`. The subsequent verification-document
commit changes documentation only, not tested application/test/build code.

The implementation adds independent `apps/node`, reusable `node-client`, shared
`node-protocol`, actual hosted adapters and explicit Run admission. It does not
implement Personal Realm enrollment, synchronization, remote native execution,
provider/MCP credential forwarding, or universal execution-protocol parity.

## Executed successfully

The following command passed **101 tests**, with zero failures, cancellations or
skips, including in a fresh clone with no preexisting `dist` files:

```bash
node --test \
  packages/node-protocol/tests/*.test.mjs \
  packages/node-client/tests/*.test.mjs \
  apps/node/tests/*.test.mjs \
  apps/cli/tests/*.test.mjs \
  packages/personal-node/tests/*.test.mjs
```

The suite exercises compiled application entrypoints, real child processes,
Unix sockets, SQLite, filesystem writes, terminal behavior and HTTP connections
to controlled fixtures. It covers independent Node startup/identity, private
version-2 negotiation, common contract argument/capability validation, authenticated
principal assertions, result correlation/provenance, saved remote selection,
canonical-query routing, no authority fallback, explicit admission/stream attach,
uncertain submissions, durable event cursors, cancellation, and existing runtime
regressions. Unicode bounds and explicit null inputs have negative tests.

The HTTP shared-access fixture uses the actual protocol dispatcher with an
injected owner port. It is **not** a deployed Nest application or proof of RLS.
Model HTTP responses are fixtures, not paid/live provider inference. MCP host
checks in the core suite use an injected connection port, not production SDK
wire interoperability.

The common OpenAPI extension blocks in `apps/api/openapi.json` match their
production generator exactly. This checks the common extension source; it is
**not** a successful full Nest OpenAPI generation.

Workspace manifest/lock importer agreement and the selected production dependency
graph were checked; the graph is acyclic. Lockfile registry resolutions and
snapshots remain unchanged. Git diff whitespace checking passed. The Git bundle
records complete branch history and was cloned for the fresh verification.

## Build environment and important qualification

Observed environment: Linux, Node **22.16.0**, TypeScript **5.8.3**, no pnpm.
Repository requirements are Node >=22.19, `.node-version` **22.23.1**, pnpm
**11.22.0**, TypeScript **5.7.3**. The full third-party dependency closure could
not be installed; registry/DNS access attempts failed.

Fresh-clone setup linked only the tracked workspace packages and the preinstalled
Node declaration package. No third-party SDK or fake implementation was substituted.
Global `tsc -p tsconfig.build.json` built the selected new packages and CLI;
existing shared primitives were built with `--types node` to use those installed
declarations. The `tool-runtime` build returned **exit 2** for missing real SDK/
schema dependencies and dependent type diagnostics. TypeScript emitted its JS and
declarations despite those errors; the downstream builds consumed that output.

Consequently, successful targeted builds are **not** a full dependency-resolved
monorepo type proof. The fresh clone reproduced this exact qualification rather
than relying on copied build output from a previous round.

## Failed and unavailable gates

All **five production MCP transport tests fail**, not skip:

```bash
cd apps/cli
node --test tests/integration/*.test.mjs
```

Directly loading the production client fails with missing `@ai-sdk/mcp`.
`tool-runtime` also lacks the actual MCP SDK, AI SDK, AJV and Zod dependencies.
No production MCP success is claimed.

The standalone packager returns **exit 1**, refusing the missing installed
production dependency closure. No standalone archive is delivered.

The API typecheck attempt returns **exit 2**, with unavailable Nest, database,
SDK and other packages. The existing quality-metrics test fails at module load
because `ts-complex` is absent. Neither is a passing gate.

The following tests are implemented but **not executed** in this environment:

- Hosted Node controller binding/validation/cancellation and canonical adapter
  unit tests in `apps/api/src/node`.
- Inherited message DTO and explicit admission tests, plus accepted-message
  regression tests in `ChatLoopService`.
- Real Nest/session/Postgres Knowledge isolation integration tests, including
  foreign versus missing resource equivalence and rejected owner injection.

Full lint, formatting, generated web client, dependency-resolved API build,
coverage/mutation, database integration, browser E2E and live deployment acceptance
remain unverified. Existing quality gates are not lowered or bypassed in source.
Git commits were created without local hooks because their tools are absent.

## Repository-pinned acceptance commands

On a machine with the pinned Node and package manager:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=cli --filter=api --concurrency=1
pnpm exec turbo run test --filter=cli --filter=@workspace/node \
  --filter=@workspace/personal-node --filter=@workspace/node-client \
  --filter=@workspace/node-protocol --concurrency=1
pnpm --filter api exec vitest run --project unit src/node \
  src/chats/chat-loop.service.test.ts
pnpm --filter api exec vitest run --project integration \
  src/node/node.integration.test.ts
pnpm generate:api-client
pnpm typecheck
pnpm format:check
pnpm lint
```

The integration project provisions its database through the repository harness;
a real database/container runtime is necessary. Remaining repository coverage,
mutation and browser gates also apply before release.

## Upgrade and deployment

Upgrade the hosted API before using the new remote query/admission paths. Stop
old private version-1 daemons and restart with the new `llame-node` or
`llame node serve`; the new client deliberately rejects old private IPC. Shared
owner API version 1 is independent of private IPC version 2. No source-data
migration is introduced. Nothing was pushed to GitHub.

Operator commands and the honest capability boundary are in
[the integration guide](../../node/integration.md); request contracts are in
[shared access](../../node/shared-access.md). The raw verification logs accompany
the delivery, including failing gates, rather than only a selected green summary.
