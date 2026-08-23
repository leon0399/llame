# Agent instructions — @workspace/config-interpolation-interpolation

Secret-interpolation primitives extracted from `apps/api/src/instance-config`.
See [README.md](README.md).

## Commands

```bash
pnpm --filter @workspace/config-interpolation-interpolation build   # tsc → dist (consumers resolve this)
pnpm --filter @workspace/config-interpolation-interpolation test
```

## Gotchas

- Zero runtime dependencies by design — interpolation reads only `node:fs`
  and the caller's env. Keep it that way.
- Consumers resolve `dist`; rebuild before api/cli checks after changes.
