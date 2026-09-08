## Why

A model reading Knowledge through `kb://` mistypes paths in two predictable
ways, and both end in a bare `File not found.` with no way forward. It
percent-encodes because the locator is URI-shaped, and nothing decodes (#736:
seven consecutive misses in one live chat, every one `%20` for a space). And
the shipped grammar bans `:` inside a Knowledge path, so a note named
`2026-09-08 14:30 standup.md` has no locator at all and `knowledge_search`
silently skips it, a regression the `kb-locator` archive records against the
deleted `knowledge_read`. Independently, a wrong extension, a Unicode
normalization difference, or a path copied from an older listing fails the
same way, and every peer harness that has thought about model path errors
answers a miss with candidate names (#737). Both land here because the second
is what makes the first survivable when it recurs in a shape decoding cannot
fix.

## What Changes

- `kb://` paths are percent-decoded on parse, per segment, after the locator
  is split on `/` and the selector colon, so `%2F` can never introduce a path
  boundary and `%3A` addresses a file containing `:`. A literal spelling and
  an encoded spelling of the same path resolve to the same file. A malformed
  sequence is `invalid_path`. A filename containing a literal `%` is addressed
  as `%25`.
- `knowledge_search` no longer skips a file whose path contains `:`. Emitted
  locators encode a segment only when it contains `:`, `?`, `#`, or `%`;
  spaces and every other character stay literal.
- The `read` description and the default chat prompt state the rule in one
  sentence each.
- A `read` that misses a file returns the closest sibling names from the same
  directory, for absolute paths and `kb://` locators alike, through one
  implementation in the native package. Names only, scored and capped; a miss
  with no plausible sibling stays a bare error; a missing parent directory is
  reported as such. `edit` and `write` are unchanged.
- To reach that layer, a `kb://` read resolves its locator tolerating a
  missing leaf, exactly as a `kb://` write already does; containment is proven
  on the nearest existing ancestor before the read is attempted, and the
  parent directory is `lstat`-checked and refused as a symbolic link
  immediately before it is opened for names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: the Knowledge locator requirement gains percent
  decoding and the emission rule and drops the `:` ban; the absolute-path
  requirement's missing-target scenario gains sibling suggestions for every
  scheme.
- `knowledge-tools`: the search requirement stops skipping `:` paths and
  specifies the conditional encoding of emitted locators.

## Impact

`apps/api/src/knowledge/knowledge-locator.ts` (decode on parse),
`knowledge-filesystem-validation.ts` (`isLocatorAddressablePath` deleted; the
decoded-segment `/` check lives in the locator parser, per segment, before
the segments are rejoined, because `validatePath` sees only the joined string), `knowledge-filesystem.ts` (the search skip
goes), `knowledge-tools.ts` (`passageLocator` encodes conditionally),
`apps/api/src/tools/native-files.ts` (reads resolve with the missing leaf
allowed). `packages/native-file-tools/src/read.ts` (suggestions on the
`ENOENT` path). Tool description, `apps/api/src/prompts/chat-default.md`,
`docs/knowledge.md`, `docs/native-files.md`, changelog. No database change.
Issues: #736 and #737 under tracker #701. Does not touch `bash-executor`,
`bash.ts`, or the bash spec, so it runs in parallel with
`host-bash-context`; it shares the `native-file-tools` spec file with the
pending directory-listing follow-ups (#738, #712, #713) but modifies
different requirement blocks.
