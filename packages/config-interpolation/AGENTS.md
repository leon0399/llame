# Agent instructions — @workspace/config-interpolation

Secret-interpolation primitives extracted from `apps/api/src/instance-config`.
See [README.md](README.md).

## Commands

```bash
pnpm --filter @workspace/config-interpolation build   # tsc → dist (consumers resolve this)
pnpm --filter @workspace/config-interpolation test
```

## Gotchas

- Zero runtime dependencies by design — interpolation reads only `node:fs`
  and the caller's env. Keep it that way.
- Consumers resolve `dist`; rebuild before api/cli checks after changes.
- `{path:LOCATION|json:POINTER}` selects an RFC 6901 string from a JSON file;
  plain `{path:LOCATION}` still trims the whole file.
