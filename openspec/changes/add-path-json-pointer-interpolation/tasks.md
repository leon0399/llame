## 1. Interpolator

- [ ] 1.1 Extend `resolvePathToken` for `|json:POINTER` (RFC 6901 walk, string-only, no trim on selected strings; plain path keeps `.trim()`) and update `PATH_TOKEN` / `WHOLE_VALUE_TOKEN_PATTERN` — verify with new unit cases in `interpolation.test.ts` (happy path, `~0`/`~1`, non-string, bad JSON, missing pointer; errors omit secret material)
- [ ] 1.2 Rebuild `@workspace/config-interpolation` (`pnpm --filter @workspace/config-interpolation build`) and confirm package tests pass

## 2. Schema + docs

- [ ] 2.1 Sync `llame.config.schema.json` `$defs.interpolationToken.pattern` (and description) to the updated `WHOLE_VALUE_TOKEN_PATTERN` — verify `schema.test.ts` drift check still passes
- [ ] 2.2 Mention `|json:POINTER` in the package README / example config comments where `{path:…}` is documented — verify examples match the spec grammar
