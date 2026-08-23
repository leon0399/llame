# @workspace/config-interpolation

llame's operator-config primitives, extracted from `apps/api/src/
instance-config` so every surface resolves secrets the same way.

- `{env:NAME}`, `{env:NAME:-default}`, `{path:LOCATION}`, and
  `{path:LOCATION|json:POINTER}` token interpolation (RFC 6901; `POINTER`
  must select a JSON string) — single-pass, non-recursive, `{{` escape
  (`interpolation.ts`). Resolved segments are reported separately so
  secret-aware callers can redact them (`protected-values.ts` in the API
  consumes the same grammar).
- `InstanceConfigError`, the shared config-failure contract.

Consumers: `apps/api` (instance config boot) and `apps/cli`
(`llame.cli.json` provider credentials). Build before consuming:

```bash
pnpm --filter @workspace/config-interpolation build
```
