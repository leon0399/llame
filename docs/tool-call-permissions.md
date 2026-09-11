# Tool-call permissions

`tools.permissions` decides, per submitted call, whether an already-admitted
tool may execute. It is separate from `tools.allowed`: the allowlist controls
which tools are advertised and executable at all; permission rules never hide
or expose a tool. This document is the operator reference for the shipped
`tool-call-permissions` behavior.

## Configuration

Add permission groups under `tools.permissions`, keyed by an exact registered
code-owned tool id or an exact canonical `mcp__<server>__<tool>` id. Wildcards
are **not** valid permission keys.

```json
{
  "tools": {
    "allowed": ["bash", "read", "write", "mcp__docs__fetch"],
    "permissions": {
      "bash": {
        "allow": true,
        "reject": [{ "field": "command", "literal": "git push" }]
      },
      "read": {
        "allow": [{ "field": "path", "regex": "^kb://SPACE/notes/" }]
      },
      "write": {
        "allow": [{ "field": "path", "regex": "^kb://SPACE/notes/" }],
        "reject": [{ "allFields": true, "literal": "PRIVATE_MARKER" }]
      },
      "mcp__docs__fetch": { "allow": true }
    }
  }
}
```

Each group has optional `allow` and `reject`. Each is `true` (whole-tool) or an
array of clauses. A clause contains exactly one matcher (`literal` or `regex`)
and exactly one target (`field`, a top-level string argument property, or
`allFields: true`). `allFields` is valid only under `reject`. An empty array or
an omitted matcher matches nothing; `false` is invalid.

## Decision order

1. If the tool has no group, the call is rejected (`no_allow`).
2. If any reject matches, the call is rejected (`explicit_reject`). A
   whole-tool reject vetoes all narrower allows.
3. Otherwise a whole-tool allow or **any** matching field allow grants
   (`matched_allow`). Independent allow clauses are alternatives, not
   combined constraints.
4. Otherwise the call is rejected (`no_allow`).

Clause order never changes the outcome. A rejected call returns
`status: "error"`, `type: "permission_denied"`, and a fixed message; the Run
continues with other permitted work.

## Matching

- **Literal** is a case-sensitive substring match; regex metacharacters are
  literal. For the native Bash `command` field only, each run of whitespace in
  the literal matches one or more ECMAScript whitespace characters (tabs,
  newlines, space, the Unicode spaces, and the byte-order mark), including when
  an all-fields reject visits `command`. Other fields preserve whitespace
  exactly.
- **Regex** is case-sensitive, unanchored search over the selected string. The
  engine is bounded RE2-compatible JavaScript (`re2js`); backreferences and
  lookbehind are refused at startup, and matching never falls back to
  backtracking. Add `^`/`$` or inline flags (`(?i)`, `(?m)`, `(?s)`) as needed.
- **Field** matches an own top-level string property; an omitted, `null`,
  boolean, numeric, object, or array value never matches.
- **allFields** traverses every submitted string value in nested objects and
  arrays. Object keys are not values, non-strings are not stringified, and
  values are never concatenated. `allFields` cannot grant an allow.
- Values are matched as **submitted after schema validation**, not
  schema-inserted defaults or transform outputs.

For native `read`, `edit`, and `write`, the `path` value is projected to its
logical locator before matching: a `kb://` locator is re-encoded once to
`kb://<space-id>/<encoded-path>` with any read selector (`:N-M`, `:raw`)
removed; a direct absolute path is matched as submitted, including trailing
separators and selector-like suffixes. No filesystem or backing path is
resolved during permission evaluation, and arbitrary MCP values receive no
native normalization.

## Limits

Code-owned, not operator-configurable:

| Bound                          | Value  |
| ------------------------------ | ------ |
| Permission groups              | 256    |
| Total clauses (booleans count) | 1,024  |
| Pattern size (UTF-8 bytes)     | 4,096  |
| Selected string content/call   | 1 MiB  |
| Values visited/call            | 65,536 |
| Container depth/call           | 64     |

Exceeding a per-call bound rejects (`input_limit`) without executing, even if
an allow already matched. Invalid or unsupported patterns, unknown ids, and
malformed clauses fail startup before the process serves requests or claims
jobs.

## Recommended portable policy and replacement

There is no built-in policy: omitting `tools.permissions` rejects every call.
`apps/api/llame.config.json.example` ships this recommended portable map — a
whole-tool allow for the seven current code-owned tools (`bash`, `read`,
`edit`, `write`, `knowledge_search`, `search_conversations`,
`conversation_read`) plus these rejects. They recognize common destructive host
operations and standard credential-locator locations. They are textual, not a
sandbox, and quoted mentions match.

| ID  | Tool/field                             | Matcher | Value                                                                                              |
| --- | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| B1  | `bash.command`                         | regex   | `(^\|[^A-Za-z0-9_])(sudo\|shutdown\|reboot\|halt\|poweroff\|mkfs([.][A-Za-z0-9_-]+)?)(\s\|$)`      |
| B2  | `bash.command`                         | regex   | `\brm\s+-(rf\|fr)\s+['"]?(/\*?\|~(\*\|/\*?)?\|\$HOME(/\*?)?\|\$\{HOME\}(/\*?)?)['"]?($\|[\s;&\|])` |
| B3  | `bash.command`                         | regex   | `\bdd\s+[^\r\n;&\|]*\bof=/dev/`                                                                    |
| B4  | `bash.command`                         | literal | `diskutil erase`                                                                                   |
| B5  | `bash.command`                         | literal | `diskutil apfs delete`                                                                             |
| B6  | `bash.command`                         | literal | `git reset --hard`                                                                                 |
| B7  | `bash.command`                         | literal | `chmod -R 777`                                                                                     |
| B8  | `bash.command`                         | regex   | `\b(curl\|wget)\s+[^\r\n;\|]*\x7c\s*(ba\|z\|da\|k)?sh(\s\|$)`                                      |
| F1  | `read.path`, `edit.path`, `write.path` | regex   | `(^\|[/\\])(\.ssh\|\.aws\|\.azure\|\.gnupg\|\.kube)([/\\]\|$\|:)`                                  |
| F2  | `read.path`, `edit.path`, `write.path` | regex   | `(^\|[/\\])(\.git-credentials\|\.npmrc\|\.pypirc)([/\\]\|$\|:)`                                    |
| F3  | `read.path`, `edit.path`, `write.path` | regex   | `(^\|[/\\])(\.docker[/\\]config\.json\|\.gem[/\\]credentials\|\.config[/\\]gh)([/\\]\|$\|:)`       |
| F4  | `read.path`                            | regex   | `(^\|[/\\])\.env($\|:\|\.(local\|development\|production\|staging\|test)(\.local)?($\|:))`         |

A supplied `tools.permissions` **is the complete policy** — there is no merge
and no default to inherit. Copy the map from the example, keep every group you
intend to retain, and note that `{}` rejects every call. Every MCP tool needs
its own explicit group; a newly discovered MCP tool is rejected until one is
supplied.

What to keep portable vs local:

- Destructive host commands and standard credential locations are portable
  defaults (the table above).
- Toolchain lists (`brew`, `composer`, `pnpm`, `docker`, `gh`), repository
  workflow preferences (`git push`, `--force`), MCP namespaces, and personal
  instruction-file exceptions are installation-specific. Keep them in an
  operator replacement map, not in shared configuration.
- Broad bans on `.key`/`.pem`, `secrets`/`credentials` directories,
  `docker-compose*.yml`, or `config/database.yml` obstruct routine inspection
  or miss files; make them explicit and local if you want them.

## Applying, recovery, and rollback

The policy is compiled and frozen at process startup. Editing
`llame.config.json` has no effect until the affected API and worker processes
restart. Each new invocation — including calls from Runs queued under an
earlier policy — uses the executing process's current policy. Tool
declarations and availability catalogs are not rebound by a permission change.

A rejected call is a non-fatal observation: no executor runs, no native
attempt is created, and the Run continues. A permission decision is recorded
on owner-scoped tool activity and the stored tool part as an opaque policy
instance id, decision, static reason, and clause reference — never rule text,
matched fragments, or host paths. This metadata is excluded from model replay,
public shares, exports, and search. The id is regenerated on every restart and
carries no information about interpolated values.

Roll back by restoring the previous binary together with its compatible
configuration. The previous binary does not accept the `tools.permissions`
key; rolling back also removes this call gate, which is an explicit operator
decision.
