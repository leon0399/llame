# Agent instructions — @workspace/config

Secret-interpolation primitives extracted from `apps/api/src/instance-config`.
See [README.md](README.md).

## Commands

```bash
pnpm --filter @workspace/config build   # tsc → dist (consumers resolve this)
pnpm --filter @workspace/config test
```

## Gotchas

- Zero runtime dependencies by design — interpolation reads only `node:fs`
  and the caller's env. Keep it that way.
- Consumers resolve `dist`; rebuild before api/cli checks after changes.
