## Why

Reading disjoint passages currently requires separate tool calls or returning
unwanted intervening text. [#705](https://github.com/leon0399/llame/issues/705)
adds one bounded read for those passages.

## What Changes

- Accept comma-separated ranges, sort them, and merge overlaps and adjacency.
- Return exact selected intervals with per-interval metadata and bounded continuation.
- Preserve literal-path precedence and existing single-range behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: multi-range selectors, rendering, and truncation.

## Impact

Shared selector parsing and read rendering in `packages/native-file-tools`,
API tool descriptions and result consumers, and native-file documentation.
The shared grammar applies to absolute paths and `kb://`; later scheme adapters
reuse it. Overview hints from #572 use this syntax when that feature ships.
