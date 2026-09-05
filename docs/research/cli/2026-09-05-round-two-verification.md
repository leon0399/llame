# CLI round two: executed verification

Date: 2026-09-05. Starting bundle commit: `05d36b1fc5b860b481f33e82910439ac98768235`.
Implementation branch: `feat/cli-connected-mcp`.

## Result, without conflating test layers

**63 core tests passed, zero failed, zero skipped.** This includes all 36 tests
from the preceding bundle. Executed with Node 22.16.0 and global TypeScript 5.8.3
on Linux, not the repository's Node 22.23.1 / pnpm 11 / TypeScript catalog toolchain.

**The five production MCP wire tests did not pass.** They were invoked and all
five failed before a real MCP handshake: the runtime cannot load `@ai-sdk/mcp`.
A direct import independently confirms that missing package. The environment
could not install repository dependencies or retrieve them from the registry.
These are recorded as blocked acceptance checks, not silently skipped tests or
successful SDK verification. The default `test` script includes these tests.

**A complete MCP-enabled standalone distribution was not produced.** The updated
packager correctly refuses the missing production dependency instead of emitting
a directory that would fail only when the first MCP server is used. The delivered
source bundle includes the packager and all dependencies in the workspace graph
and lockfile; a normal installation/build is still required.

## What the passing core tests actually exercise

The tests launch compiled CLI processes and use real loopback HTTP, SQLite,
filesystem operations, subprocesses and the util-linux `script` PTY utility.
They cover persisted remote enable/disable across fresh processes, flag precedence,
no credential-driven mode switch, no fallback on missing authentication, exact
URL/account binding, private credential modes, symlink/hardlink refusal, and a
concurrent logout/new-login race. Auth commands remain usable against a saved
disabled remote without switching the execution default back on.

Remote tests exercise existing API-shaped fixtures for login/revocation,
models, Run streaming/reconnection, Knowledge metadata pagination, chat search
and historical tool receipts. Their paths/fields are checked against the committed
OpenAPI file. These are **not** a live deployed node, real Postgres/RLS or genuine
indexed-Knowledge acceptance test.

MCP host tests use a deliberately injected **connection port**, not a fake npm
package or a substituted production SDK. They test exact allowlists, terminal vs
config approval, schema-validation-before-call at that port, credential refusal,
result redaction before subsequent real model-HTTP requests/SQLite persistence,
cleanup, declaration limits, ambiguous-call handling and no in-Run reconnect.
One runs the actual local model loop over HTTP with this injected MCP connection.
That proves host wiring and policy, not SDK transport interoperability or Ajv
semantics. Those remain the production integration/shared Vitest suite's job.

Package-export tests exercise installed dependency/peer traversal, conflicting
nested versions, license copying, excluding development-only packages and
preserving an existing distribution when a dependency is missing. They use small
fixture packages, not the unavailable real MCP dependency closure.

## Builds and static checks

The `config-interpolation` and `runtime-safety` production TypeScript builds
passed with the available compiler. The CLI build also passed against emitted
shared declarations. **The full shared `tool-runtime` build/typecheck failed**
because MCP/AI SDK, Ajv, Ajv formats and Zod dependencies/types were missing;
TypeScript emitted JavaScript/declarations despite those diagnostics. Core tests
used that emitted code only where its dependencies were available, including the
pure tool-ID helper. This is not a clean full-program typecheck and must not be
reported as one.

Git whitespace checks and static relative-import resolution checks passed.
Shared tests moved with their implementations; API callers, test aliases,
coverage/mutation tasks and CI dependency inputs were updated. Dependency versions
were reused from the existing lockfile rather than resolved to new releases.
Full lint/format, quality metrics, Vitest coverage, mutation, API typecheck/build,
Postgres integration, browser and live-provider suites were not executed.

## Commands used for this environment

After providing ignored local links to the already available TypeScript compiler,
Node types and workspace packages:

```sh
node /path/to/available/tsc -p packages/config-interpolation/tsconfig.build.json --types node
node /path/to/available/tsc -p packages/runtime-safety/tsconfig.build.json --types node
node /path/to/available/tsc -p packages/tool-runtime/tsconfig.build.json --types node
# The preceding tool-runtime command FAILED for unavailable dependencies.
node /path/to/available/tsc -p apps/cli/tsconfig.build.json
node --test apps/cli/tests/*.test.mjs
# 63 passed; this is the explicitly narrower core suite.
node --test apps/cli/tests/integration/*.test.mjs
# 5 failed because production MCP dependency loading is blocked.
node apps/cli/scripts/package.mjs
# Refused missing @ai-sdk/mcp; no partial new distribution was accepted.
```

No SDK implementations or credential responses were fabricated to obtain a green
transport result. No external model account was charged and nothing was pushed
to GitHub.

## Required normal-environment gates

Use the repository's `.node-version` and package-manager pin, then:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build test typecheck --filter=cli --concurrency=1
pnpm exec turbo run test:coverage --filter=@workspace/runtime-safety --filter=@workspace/tool-runtime --concurrency=1
pnpm --filter @workspace/tool-runtime test:mutation
pnpm exec turbo run typecheck --filter=api --concurrency=1
pnpm --filter api test:coverage
pnpm lint
pnpm format:check
pnpm exec turbo run package:standalone --filter=cli --concurrency=1
```

Then verify against an actual node: authenticate, enable remote once, restart the
CLI, perform an episodic and Knowledge query, and inspect its receipt; separately
connect a trusted local MCP server and approve a tool call. Do not substitute
these proposed checks for the results recorded above. OAuth-only MCP providers,
Windows ACLs, Personal Realm sync and cross-node tool execution are not acceptance
claims of this bundle.
