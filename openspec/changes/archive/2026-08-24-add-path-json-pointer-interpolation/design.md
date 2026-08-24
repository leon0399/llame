## Context

See proposal.md — Why. Path tokens live in `@workspace/config-interpolation` (`resolvePathToken` + `PATH_TOKEN` / `WHOLE_VALUE_TOKEN_PATTERN`); the API schema `$defs.interpolationToken` must stay byte-identical to that pattern. Prior art: `evolab/secret_refs.py` (`{path:FILE|json:POINTER}`, RFC 6901, string-only).

## Goals / Non-Goals

**Goals:**

- Parse optional `|json:POINTER` inside the existing `{path:…}` token body.
- Select with RFC 6901; require a JSON string result.
- Keep errors free of secret material; keep single-pass / non-recursive rules.

**Non-Goals:**

- New token kinds (`{jsonpath:…}`), env+JSON hybrids, non-string coercion at the interpolator, recursive interpolation of selected values, caching parsed JSON across tokens.

## Decisions

1. **Syntax = lab `|json:` suffix, not a new token** — one filesystem source with an optional selector; matches operator mental model and prior art. Rejected: dotted keys (weaker for `/`/`.` in key names); separate `{jsonpath:…}` (more grammar churn for no gain).

2. **RFC 6901 pointer, string-only** — standard nested/array/escaped-key selection; non-strings fail closed so credentials stay typed as secrets, not accidental `"[object Object]"` / `"true"`. Numeric/boolean config fields still use whole-value token + existing post-interpolation coercion when the selected _string_ is numeric text.

3. **Partition on first `|json:`** — file path is everything before; pointer is everything after. A path that literally contains `|json:` is unsupported (same class of limitation as `}` in `LOCATION` today). Document it.

4. **Trim only the plain-file branch** — whole-file path keeps `.trim()`; JSON-selected strings are used as-is (no trim), matching the lab and avoiding stripping intentional whitespace inside secrets.

5. **Implementation stays in `config-interpolation`** — zero new deps; hand-roll pointer walk (~30 lines) rather than adding a JSON Pointer package.

## Risks / Trade-offs

- [Path containing `|json:`] → Document as unsupported; operators use a differently named mount.
- [Large JSON files re-parsed per token] → Acceptable at boot; no shared cache unless it becomes a problem.
- [Schema/pattern drift] → Existing drift test continues to gate `WHOLE_VALUE_TOKEN_PATTERN` vs `$defs.interpolationToken`.

## Migration Plan

Deploy anytime: additive grammar. No rollback data migration; remove `|json:` usages before downgrading the binary if needed.
