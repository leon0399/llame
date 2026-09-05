# CLI implementation verification

Date: 2026-09-05. Base bundle commit:
`7d31a453788e6f56e75eb170c64c37135060c9d3`.
Implementation branch: `feat/cli-local-remote`.

## Executed checks

The CLI and both shared runtime dependencies compiled successfully with strict
TypeScript settings. CLI compilation also passed `--noUnusedLocals` and
`--noUnusedParameters`. The implementation environment provided Node **22.16.0**,
TypeScript **5.8.3**, and global `@types/node` **25.1.0**. These are not the
repository-pinned Node 22.23.1 / catalog compiler environment. The supported Node
floor remains the repository's 22.19; no engine constraint was weakened.

The compiled CLI distribution suite passed **36 tests, 0 failures, 0 skips**.
It exercises actual CLI subprocesses and loopback HTTP, real SQLite, filesystem
writes, child processes and a PTY, rather than mocking the whole runtime.

Coverage of those checks includes local streaming and follow-up history; secret
redaction across arbitrary stream boundaries; private files and strict config;
Workspace traversal/symlink/hardlink/secret-path rejection; denied piped edits;
approved optimistic writes and concurrent-edit rejection; native environment,
output and cancellation limits; malformed tool arguments; bounded final steps;
premature completion failure; exclusive execution; SIGKILL recovery without
replay; repeated tool-call ID recovery; stdin cancellation; lazy instruction-only
skills; split UTF-8 and SSE framing; remote login and authority/account isolation;
redirect refusal; replay cursors and duplicate suppression; ambiguous submission
without retry; explicit cancellation; revocation failure retention; expired-token
logout; and the checked-in OpenAPI wire contract.

One repeated PTY check exposed a real prompt/echo race: printing `Password:` before
switching off terminal echo allowed an immediate paste to echo. The implementation
now switches to raw/no-echo mode before displaying readiness. The new automated
PTY regression starts with echo enabled and sends the password immediately when
the prompt arrives, without sleeps that could conceal the race.

Three additional interactive scenarios were exercised through a separate real
PTY against a loopback fixture: UTF-8 hidden-password login, a two-turn REPL with
history/exit, and individually approving an actual hash-guarded file replacement.
All three passed on three consecutive runs after the race fix. These are not
live-provider or deployed-Hub tests.

Portable packaging succeeded. A complete copy of the built `standalone` tree was
run from a separate temporary directory without the repository's `node_modules`.
It performed real fixture-backed inference and created private SQLite state.
The package includes only the CLI build and its two workspace runtime libraries;
no external dependency install, provider key, config or model is included.

A TypeScript export audit checked **98 API source/test consumers and 187 imported
bindings** against the extracted runtime-safety package, with no missing exports.
The new CLI/API/runtime-safety lockfile importers were compared to their package
manifests: dependency names and all specifiers matched. No external runtime
package or registry snapshot was introduced by this CLI.

## Commands used in the constrained environment

Global TypeScript was used because the container could not reach the npm registry
or bootstrap pnpm. Temporary ignored workspace links connected only local packages
and the already-installed Node type declarations; they are not in the bundle.

```sh
TSC=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/bin/tsc
node "$TSC" -p packages/config-interpolation/tsconfig.build.json --types node
node "$TSC" -p packages/runtime-safety/tsconfig.build.json --types node
node "$TSC" -p apps/cli/tsconfig.build.json
node "$TSC" -p apps/cli/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
node --test apps/cli/tests/*.test.mjs
node apps/cli/scripts/package.mjs
node apps/cli/standalone/bin/llame.cjs --help
```

The PTY regression uses util-linux `script`, available in the tested Linux
environment and Linux CI runners. A missing PTY program fails the test; it is not
silently skipped. The optional manual PTY driver was an external verification
script, not a new application runtime dependency.

The delivery also verifies the Git bundle and clones its implementation branch
into a fresh checkout. The companion delivery manifest records the final commit,
artifact checksums and fresh-checkout results without a self-referential commit
hash inside this report.

## Not executed or not established

The full pnpm installation, repository lint/format/Knip/complexity checks, original
Vitest coverage/mutation suites, API typecheck/build, Testcontainers/Postgres RLS
integration, browser E2E and live deployed-node/provider acceptance were **not
executed** here. The environment lacked the dependencies, package-registry access,
Docker/Postgres and external credentials required. No claim that full CI is green
is made; the existing gates remain required in the pinned environment. Their
configuration was retained/extended, not lowered to make these checks pass.

The remote fixtures exercise the repository's real wire contract, but do not
prove a particular deployed node's configuration, reverse proxy, provider health
or latest schema. Likewise, Chat Completions fixtures do not prove every vendor's
extensions. Windows-native process execution, general cross-platform ACLs and
hostile concurrent native filesystem/process behavior are not claimed secure by
these tests. Native execution is expressly not sandboxing.

OAuth/OIDC exchange, device authorization, cryptographic Node enrollment,
Personal Realm/Knowledge/Profile synchronization, automatic compaction, MCP/ACP
local adapters and a persistent background daemon are not implemented. See the
[operator guide](../apps/cli/README.md) and
[auth/harness research](research/cli/2026-09-05-authentication-and-harness.md).
