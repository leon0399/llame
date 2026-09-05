# CLI

Read the root instructions and [operator guide](README.md). The capability
contract is [cli](../../openspec/specs/cli/spec.md).

Build/check through Turbo so all shared runtime packages exist first:

```sh
pnpm exec turbo run build test typecheck --filter=cli --concurrency=1
pnpm exec turbo run package:standalone --filter=cli --concurrency=1
```

Remote code consumes the API; it must not import API implementation/DB modules.
Local SQLite is single-user runtime state, not a second client of Hub Postgres.
Only `env.ts` reads process environment in production. Credentials, human
sessions and future cryptographic Node enrollment remain distinct boundaries.

`--native` is an explicit OS-user grant, never a sandbox. Native tools must not
gain automatic approvals or command allowlist bypasses. MCP alone supports exact-name grants in
user configuration; server annotations and project files cannot supply them.
Do not add inherited skill trust or action replay.
Unknown crash outcomes stay unknown. Preserve mode isolation and cursor/account
binding tests when touching authentication, transport or persistence.

Built-distribution checks use Node's test runner in `tests/*.test.mjs` and
`tests/integration/*.test.mjs`; co-located shared-helper unit tests remain Vitest. Fixtures are not live-vendor proof.
