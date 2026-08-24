## Why

Operators often mount a single JSON secret file (Docker/K8s, password managers) that holds several credentials. Today `{path:LOCATION}` can only inject the whole file, so each secret needs its own mount or a preprocessing step. Extending path tokens with an optional RFC 6901 JSON Pointer lets one file feed many config fields without new secret sources.

## What Changes

- Extend `{path:LOCATION}` so `LOCATION` MAY end with `|json:POINTER`, where `POINTER` is an RFC 6901 JSON Pointer into the file's JSON document.
- The pointer MUST select a JSON string; non-string selections, invalid JSON, missing files, and missing pointers fail load naming path/source only — never the resolved value.
- Plain `{path:LOCATION}` (no `|json:`) keeps today's whole-file trim behavior.
- Update the published schema `$defs.interpolationToken` pattern so editors accept the extended grammar.
- Not **BREAKING**: every existing `{path:…}` token without `|json:` is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `instance-config`: File-path secret interpolation gains optional `|json:POINTER` selection; redaction and single-pass rules unchanged.

## Impact

- `packages/config-interpolation` — path resolver + unit tests (API and CLI both consume this).
- `apps/api` instance-config JSON Schema `$defs.interpolationToken` + drift test against `WHOLE_VALUE_TOKEN_PATTERN`.
- Docs/examples that describe `{path:…}` tokens.
- No DB, HTTP API, or dependency changes.
