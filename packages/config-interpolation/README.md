# @workspace/config-interpolation

llame's operator-config primitives, extracted from `apps/api/src/
instance-config` so every surface resolves secrets the same way.

- `{env:NAME}`, `{env:NAME:-default}`, and `{path:LOCATION}` token
  interpolation — single-pass, non-recursive, `{{` escape (`interpolation.ts`,
  moved verbatim with its suite). Resolved segments are reported separately so
  secret-aware callers can redact them (`protected-values.ts` in the API
  consumes the same grammar).
- `InstanceConfigError`, the shared config-failure contract.

Consumers: `apps/api` (instance config boot) and `apps/cli`
(`llame.cli.json` provider credentials). Build before consuming:

```bash
pnpm --filter @workspace/config-interpolation build
```
