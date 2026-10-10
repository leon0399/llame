---
summary: "tools.permissions: groups, clause matching, decision order, and the recommended portable policy"
read_when:
  - you are configuring, restricting, or rolling back llame tool-call permissions
  - you need to know why a call was rejected by a clause, or how to allowlist one domain
behavior:
  - ../reference/tools/bash.md
  - ../reference/tools/read.md
  - ../reference/tools/edit.md
  - ../reference/tools/write.md
  - ../reference/tools/enter-workspace.md
  - ../reference/locators/web.md
---

# Tool-call permissions

`tools.permissions` decides, per submitted call, whether an already-admitted
tool may execute. It is separate from `tools.allowed`: the allowlist controls
which tools are advertised and executable at all; permission rules never hide
or expose a tool. This document is the operator reference for the shipped
`tool-call-permissions` behavior.

## Configuration

Add permission groups under `tools.permissions`, keyed by an exact tool id. A
group is matched only when its key equals the executing tool's canonical id;
an unknown or no-longer-configured key (for example one left behind after an
MCP server change) is accepted at startup and simply never matches, so it does
not fail boot. Keys are not wildcards.

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
`kb://<space-id>/<encoded-path>`, a `skill://` locator to its canonical
identity, a `file://` or `file:` alias to its percent-decoded absolute host
path, and a web locator to the URL its request will use, down to the host case,
port, escapes, and fragment, as [web
locators](../reference/locators/web.md#form) describes. A Workspace-relative
host path is resolved against the Workspace root first. No filesystem or
backing path is resolved during permission evaluation, and arbitrary MCP
values receive no native normalization.

A `read` is matched **without its read selector**, on every source: the direct
host path, a decoded file alias, a `kb://` or `skill://` locator, a web
locator, and the Workspace-relative path after resolution. Nothing else is
removed from the text — a submitted web fragment stays in the submitted pass,
while the parsed/requested web projection drops it. A clause therefore names
the resource, not the window into it, so `^/srv/docs/guide\.md$` admits
`/srv/docs/guide.md:10-20`, and a clause written against the selector spelling
such as `:raw` matches no split-off read selector; it can still match ordinary
URL text such as `#x:raw` or `?x=:raw`, which is not a selector. An
instruction import whose canonical path differs is also evaluated against
`read` on its first page, and a reject denies the import. Three consequences
are worth knowing:

- Admission is text-only, so an exact allow for `/srv/docs/README` also admits
  a read of a literal file named `README:raw` when one exists.
- A selector-shaped literal filename cannot be singled out by a `read` reject.
  `^/data/report$` matches `/data/report:2024` after selector removal, so that
  read is refused. But `^/data/report:2024$` matches nothing for `read`, so it
  cannot single out that literal file apart from `/data/report`; when an allow
  names the resource, admission succeeds and the executor reads the literal
  file. Scope a reject to the resource, not to a selector spelling.
- `edit` and `write` are the exception: a mutation takes its path literally,
  so any selector-shaped suffix stays in every text they are matched on,
  including the decoded alias. `^/srv/app/config\.json$` admits the write of
  `/srv/app/config.json` and refuses `/srv/app/config.json:1-5`, which names a
  different file.

The `:` alternative in the F1-F3 credential terminators stays load-bearing for
the same reason: those rows also guard `edit`, `write`, and
`enter_workspace`, where nothing is removed, and a colon-bearing name outside
the read selector grammar, such as `/home/u/.ssh:old`, keeps its suffix in a
`read`'s matched text, so F1 still catches it. F4 keeps catching a credential
file a read selects into, because the selector is gone before the clause sees
the text: `read /srv/.env:raw` is matched as `/srv/.env`.

## Bypass

An effective `bypass` mode also admits an instruction import's canonical-path
`read` evaluation when it differs from the resolved path. The first page read
records the resulting derived `canonical` decision. See [permission
modes](../reference/permission-modes.md) for the mode's full scope.

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
`apps/api/llame.config.jsonc.example` ships this recommended portable map — a
whole-tool allow for the eight code-owned tools that need no field allow
(`bash`, `read`, `edit`, `write`, `knowledge_search`, `search_conversations`,
`conversation_read`, `exit_workspace`), an operator-edited `enter_workspace.path`
field allow naming trusted roots, and these rejects. The `B` rows recognize
common destructive host operations, the
`F` rows standard credential-locator locations and the web addresses to
refuse, the `W` rows Workspace control files, and the `E` rows roots the
Workspace group should not admit. They are textual, not a sandbox, and quoted
mentions match. See [web reads](web-read.md#enabling) for when to copy
F5a-F5f and F7, and [native files](native-files.md#workspace-entry) for what
an admitted Workspace root is trusted with.

| ID  | Tool/field                                                     | Matcher | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `bash.command`                                                 | regex   | `(^\|[^A-Za-z0-9_])(sudo\|shutdown\|reboot\|halt\|poweroff\|mkfs([.][A-Za-z0-9_-]+)?)(\s\|$)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B2  | `bash.command`                                                 | regex   | `\brm\s+(?:(?:-[A-Za-z]*[rR][A-Za-z]*[fF][A-Za-z]*\|-[A-Za-z]*[fF][A-Za-z]*[rR][A-Za-z]*\|-[A-Za-z]*[rR][A-Za-z]*\s+-[A-Za-z]*[fF][A-Za-z]*\|-[A-Za-z]*[fF][A-Za-z]*\s+-[A-Za-z]*[rR][A-Za-z]*\|--recursive\s+(?:--force\|-f)\|--force\s+(?:--recursive\|-r))\s+(?:--no-preserve-root\s+)?\|--no-preserve-root\s+(?:-[A-Za-z]*[rR][A-Za-z]*[fF][A-Za-z]*\|-[A-Za-z]*[fF][A-Za-z]*[rR][A-Za-z]*\|-[A-Za-z]*[rR][A-Za-z]*\s+-[A-Za-z]*[fF][A-Za-z]*\|-[A-Za-z]*[fF][A-Za-z]*\s+-[A-Za-z]*[rR][A-Za-z]*\|--recursive\s+(?:--force\|-f)\|--force\s+(?:--recursive\|-r))\s+)(?:--\s+)?['"]?(?://?\*?\|~(?:\*\|//?\*?)?\|\$HOME(?:/\*?)?\|\$\{{HOME\}(?://?\*?)?)['"]?($\|[\s;&\|])` |
| B3  | `bash.command`                                                 | regex   | `\bdd\s+[^\r\n;&\|]*\bof=/dev/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| B4  | `bash.command`                                                 | literal | `diskutil erase`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B5  | `bash.command`                                                 | literal | `diskutil apfs delete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| B6  | `bash.command`                                                 | literal | `git reset --hard`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B7  | `bash.command`                                                 | literal | `chmod -R 777`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B8  | `bash.command`                                                 | regex   | `\b(curl\|wget)\s+[^\r\n;\|]*\x7c\s*(ba\|z\|da\|k)?sh(\s\|$)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F1  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.ssh\|\.aws\|\.azure\|\.gnupg\|\.kube)([/\\]\|$\|:)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F2  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.git-credentials\|\.npmrc\|\.pypirc)([/\\]\|$\|:)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F3  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.docker[/\\]config\.json\|\.gem[/\\]credentials\|\.config[/\\]gh)([/\\]\|$\|:)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F4  | `read.path`                                                    | regex   | `(^\|[/\\])\.env($\|:\|\.(local\|development\|production\|staging\|test)(\.local)?($\|:))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F5a | `read.path`                                                    | regex   | `^http://(?:[1-9]\|1[1-9]\|[2-9]\d\|10[1-9]\|11\d\|12[0-689]\|1[3-5]\d\|16[0-8]\|17[013-9]\|18\d\|19[013-9]\|2[0-4]\d\|25[0-5])\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F5b | `read.path`                                                    | regex   | `^http://100\.(?:\d\|[1-5]\d\|6[0-3]\|12[89]\|1[3-9]\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F5c | `read.path`                                                    | regex   | `^http://169\.(?:\d\|[1-9]\d\|1\d\d\|2[0-4]\d\|25[0-35])\.\d{1,3}\.\d{1,3}[:/]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F5d | `read.path`                                                    | regex   | `^http://172\.(?:\d\|1[0-5]\|3[2-9]\|[4-9]\d\|1\d\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F5e | `read.path`                                                    | regex   | `^http://192\.(?:\d\|[1-9]\d\|1[0-5]\d\|16[0-79]\|1[7-9]\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F5f | `read.path`                                                    | regex   | `^http://\[(?:::(?:[02-9a-f]\|1[^\]])\|(?:[0-9a-f]{1,3}\|[0-9a-e][0-9a-f]{3}\|f[0-9abf][0-9a-f]{2}\|fe[0-7c-f][0-9a-f]):)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F6  | `read.path`                                                    | regex   | `^https?://([^/]*\.)?grokipedia\.com\.?([/:]\|$)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F7  | `read.path`                                                    | regex   | `^https?://(?:169\.254\.169\.254\|169\.254\.170\.2\|169\.254\.0\.23\|100\.100\.100\.200\|\[fd00:ec2::254\])[:/]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| W1  | `edit.path`, `write.path`                                      | regex   | `(?i)(^\|[/\\])\.mcp\.json$`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| W2  | `edit.path`, `write.path`                                      | regex   | `(?i)(^\|[/\\])\.(llame\|agents\|claude)[/\\]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E1  | `enter_workspace.path`                                         | regex   | `(^\|[/\\])node_modules([/\\]\|$)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E2  | `enter_workspace.path`                                         | regex   | `^/(tmp\|var/tmp)(/\|$)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| E3  | `enter_workspace.path`                                         | regex   | `(^\|[/\\])Downloads([/\\]\|$)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

## Restricting reads to one domain

Replacing the group's whole-tool allow with field allows turns `read` into an
allowlist of authorities. Each clause is an alternative, not a combined
constraint, so local paths, Knowledge locators, skill locators, and one domain
coexist:

```jsonc
{
  "tools": {
    "permissions": {
      "read": {
        "allow": [
          { "field": "path", "regex": "^/" },
          { "field": "path", "regex": "^kb://" },
          { "field": "path", "regex": "^skill://" },
          { "field": "path", "regex": "^media://" },
          { "field": "path", "regex": "^https://docs\\.example\\.com/" },
        ],
      },
    },
  },
}
```

With that group, reading `https://docs.example.com/guide` is admitted, and
reading `https://other.example/guide` is rejected as `no_allow` without a fetch.
The `^media://` clause admits a re-read of an image the Run owner holds
(another owner's id still returns `not_found`); without it every `media://`
read is rejected as `no_allow` before any lookup.
The `^/` and `^kb://` clauses admit `/etc/hosts` and `kb://SPACE/notes/a.md`; a
read you want blocked must be absent from the allow list or denied by a reject
clause.
The domain allowlist must also name each rewrite origin: allowing the source
host does not admit the operator-declared target origin, because the target is
a separate derived locator.

What the clause matches is locator text, not an address:

- A `kb://` locator is projected before matching (path re-encoded); a web
  locator is matched twice, both times without its read selector, so
  `^https://docs\.example\.com/` admits `.../guide:raw` and
  `HTTPS://docs.example.com/guide` alike. A reject is the stricter of the two
  texts — a clause naming the host catches the encoded, uppercase,
  default-port, and root-dot spellings of it — while an allow is decided on the
  requested text, since that is the resource the call reaches. The two forms
  are described in [web
  reads](web-read.md#derived-locators-and-permission-admission).
- A derived locator earns its own allow: a redirect hop is a different
  resource, so an allowlist admits a hop only when one of its clauses names the
  hop's own text.
- Write a rule that should cover a resource regardless of the submitted or
  derived spelling in the decoded canonical form, for example `~user` rather
  than only `%7Euser`.
- An allow admits the locator text, not the address its hostname resolves to;
  each resolved address is separately evaluated against rejects. A host's
  root dot is dropped before matching, for a submitted locator and for a
  redirect hop alike, so `https://docs.example.com./` is matched and
  requested as `https://docs.example.com/`; the recommended grokipedia clause
  keeps its `\.?` anyway, because an operator's own clause should not depend
  on that normalization.
- An address reject can cover one server across names, for example
  `^https?://10\.67\.88\.60/private`. Use `(?i)` for a case-insensitive
  server. Because some servers merge `//` or treat `..;` specially, a
  path-scoped rule can miss the resource the server serves; scope a sensitive
  address by origin instead of path when that is the boundary you need.

## Applying, recovery, and rollback

The policy is compiled and frozen at process startup. Editing the [instance
configuration](index.md) has no effect until the affected API and worker
processes restart. Each new invocation — including calls from Runs queued under
an earlier policy — uses the executing process's current policy. Tool
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
