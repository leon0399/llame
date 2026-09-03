# @workspace/config-interpolation

Zero-dependency secret interpolation extracted from API instance config. See
[README.md](README.md).

```bash
pnpm --filter @workspace/config-interpolation build # consumers resolve dist
pnpm --filter @workspace/config-interpolation test
```

- Keep runtime dependencies at zero; use only `node:fs` and caller-supplied env.
- Rebuild before API/CLI checks.
- `{path:LOCATION|json:POINTER}` selects an RFC 6901 string;
  `{path:LOCATION}` trims the whole file.
