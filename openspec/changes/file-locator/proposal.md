# Proposal

## Why

`read` accepts absolute host paths, `kb://`, `skill://`, and `http(s)://`, but refuses the `file://` spelling that models copy from editors, pages, and stack traces. The refusal is avoidable because a `file://` locator can name the same local host file without adding an authority, while the current dispatcher and permission projection must be changed together to preserve fail-closed policy.

Issue #929 asks whether selectors retain their meaning, how POSIX should treat `file:///C:/x`, and whether mutations share the alias. The approved contract answers yes, POSIX semantics, and yes: `file://` is an alias for `read`, `edit`, and `write`, not a remote source.

## What Changes

- Accept `file:///absolute/path` and `file://localhost/absolute/path` for `read`, `edit`, and `write`; compare the authority case-insensitively and refuse every other non-empty authority before filesystem access.
- Parse with the WHATWG URL implementation and `fileURLToPath`, while refusing query, fragment, empty paths, malformed escapes, percent-encoded `/`, and NUL instead of allowing conversion to silently discard or create unsafe path text.
- Apply the existing host-path executor binding, mutation serialization, literal-path probe, trailing-selector split, real-path field, sibling suggestions, bounds, and result envelope after normalization. A selector remains after the file URL, and the result `path` is the normalized host path rather than the submitted URL.
- Run permission admission over the submitted locator first and the decoded host-path projection second. Host-path reject clauses therefore catch encoded `file://` spellings, and host-path allow clauses admit the equivalent alias; invalid aliases remain refused by execution.
- Replace the paired hard-coded dispatch and projection switches with one static source table whose entries declare scheme, supported operations, projection, and executor. Existing schemes keep their observable behavior; `ssh://` (#936) is the next source entry.
- Preserve the exact unknown-scheme refusal: `invalid_path` with `This path scheme is not available.`
- Update the `read` prompt, native-files operator documentation, `SPEC.md` native-file architecture, and changelog in the implementation layer, not this proposal layer.

**BREAKING**: None for calls that do not use `file://`; the alias only expands accepted spellings, and existing schemes retain their behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: extend the native source contract with the `file://` host alias, authority and refusal rules, selector behavior, normalized result identity, and mutation support; update the requirements that enumerate edit and write locators.
- `tool-call-permissions`: project `file://` to its decoded host path for native file permission matching while retaining submitted-text admission and the existing two-pass web/derived-locator behavior.

## Impact

The implementation layer will touch `apps/api/src/tools/native-files.ts`, `apps/api/src/tools/permissions/locator-projection.ts`, the shared native path/locator seam, `apps/api/src/prompts/tools/read.md`, `docs/native-files.md`, `SPEC.md`, and `CHANGELOG.md`, plus focused native and permission tests. No new dependency, tool id, configuration key, remote authority, or persistence schema is required. The proposal is one independent stack from `master` and names `web-read-adapters` and `read-representations` as sibling changes owning planes 2 and 3 of the shared read architecture.

Open questions and negative authority/permission cases are recorded in `design.md`; the delta specs carry the observable contract and scenarios.
