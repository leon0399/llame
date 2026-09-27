## Why

`read` accepts absolute host paths, `kb://`, `skill://`, and `http(s)://`, but refuses the `file://` spelling that models copy from editors, pages, and stack traces. The refusal is avoidable because a `file://` locator can name the same local host file without adding an authority, while the current dispatcher and permission projection must be changed together to preserve fail-closed policy.

Issue #929 asks whether selectors retain their meaning, how POSIX should treat `file:///C:/x`, and whether mutations share the alias. The approved contract answers yes, POSIX semantics, and yes: `file://` is an alias for `read`, `edit`, and `write`, not a remote source.

## What Changes

- Accept `file:///absolute/path`, `file://localhost/absolute/path`, and the RFC 8089 minimal form `file:/absolute/path` for `read`, `edit`, and `write`; compare the authority case-insensitively and refuse every other non-empty authority before filesystem access.
- Parse the submitted locator with a strict, total local parser rather than WHATWG normalization: refuse literal query, fragment, backslash, C0/DEL control characters, empty authority paths, malformed or non-UTF-8 escapes, percent-encoded `/`, and NUL. Preserve `.` and `..` exactly as host paths do.
- Apply the existing host-path executor binding, mutation serialization, literal-path probe, trailing-selector split, real-path field, sibling suggestions, bounds, and result envelope after decoding. A selector remains after the file URL, `%3A` decodes to `:` and follows host selector rules after the literal-path probe, and there is no escaped literal-colon form; the result `path` is the decoded host path rather than the submitted URL.
- Run permission admission over the submitted locator first and the decoded host-path projection second. Host-path reject clauses therefore catch encoded `file://` spellings, and host-path allow clauses admit the equivalent alias; invalid aliases remain unchanged in projection and are refused by execution or by permission admission.
- Add one pure `file:` classifier and decoder that both native dispatch and permission projection call before generic scheme parsing and before Workspace-relative projection. A valid alias is always absolute and never resolved from the entered Workspace root. The existing `kb`, `skill`, and web branches are unchanged; the dispatch/projection table refactor is deferred to `ssh://` (#936), the next real source.
- Preserve the exact unknown-scheme refusal: `invalid_path` with `This path scheme is not available.`
- Update the `read`, `edit`, and `write` prompts, native-files operator documentation, one `SPEC.md` §13.7 sentence for the alias, and the changelog in the implementation layer, not this proposal layer. The three-layer read architecture stays in `design.md`; each sibling change documents its own layer in `SPEC.md` when it ships.

**BREAKING**: None for calls that do not use a file locator; the alias only
expands accepted local spellings, and existing schemes retain their behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: extend the native source contract with the `file://` host alias, authority and refusal rules, selector behavior, decoded result identity, and mutation support; update the requirements that enumerate edit and write locators.
- `tool-call-permissions`: project `file://` to its decoded host path for native file permission matching while retaining submitted-text admission and the existing two-pass web/derived-locator behavior.

## Impact

The implementation layer will touch `apps/api/src/tools/native-files.ts`, `apps/api/src/tools/permissions/locator-projection.ts`, one new pure file-alias module beside `locator-projection.ts`, `apps/api/src/prompts/tools/read.md`, `apps/api/src/prompts/tools/edit.md`, `apps/api/src/prompts/tools/write.md`, `docs/native-files.md`, `SPEC.md`, and `CHANGELOG.md`, plus focused native and permission tests. No new dependency, tool id, configuration key, remote authority, or persistence schema is required. The proposal is one independent stack from `master` and names `web-read-adapters` and `read-representations` as sibling changes owning the web-adapter and representation layers of the shared read architecture.

Open questions and negative authority/permission cases are recorded in `design.md`; the delta specs carry the observable contract and scenarios.
