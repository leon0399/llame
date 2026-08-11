## 1. Structural truncation

- [x] 1.1 Add failing unit cases: a truncated result keeps `status` and every declared top-level field; a payload whose cut lands inside a surrogate pair stays well-formed; the marker states the omitted amount and a recovery action; the cap holds for a string-heavy payload, an array-heavy payload, and a many-keys payload.
- [x] 1.2 Implement shape-preserving truncation: normalize through the result's own JSON, binary-search one shrink limit applied to string code units, array elements, and nested object entries, keep every top-level field, and measure the real serialization instead of computing a budget.
- [x] 1.3 Replace the envelope-substituting `truncateIfOversized` with the new step in `runTool`, keeping error results untruncated and the cap a single documented constant.

## 2. Records

- [x] 2.1 Add the dated `CHANGELOG.md` entry (bug fix; `ROADMAP.md` untouched — #294 is unplanned work).
- [x] 2.2 Sync the `tool-calling` delta into `openspec/specs` and archive this change.

## 3. Verification

- [x] 3.1 Run the API unit suite, lint, and type-check (scoped to `apps/api`).
