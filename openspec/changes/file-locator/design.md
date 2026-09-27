# Design

## Context

See [proposal.md](proposal.md) for the problem and issue scope. This design
keeps the existing native authority and permission boundaries while adding one
local spelling.

On current `master`, `executeNative` lower-cases the parsed `scheme://` prefix,
branches to Knowledge, Skill, or web execution, and sends an unimplemented
scheme to the fixed `invalid_path` result. A path without a scheme reaches the
host executor (`apps/api/src/tools/native-files.ts:59-87`). The shared parser
intentionally rejects a scheme-looking value before any selector split or
filesystem probe (`packages/native-file-tools/src/path.ts:66-84,182-212`).
Unknown schemes return `invalid_path` with `This path scheme is not available.`
(`apps/api/src/tools/native-files.ts:385-390`).

Permission projection currently has a separate fixed set for Knowledge, Skill,
and HTTP(S), and passes direct host values through unchanged
(`apps/api/src/tools/permissions/locator-projection.ts:15-51`). The evaluator
checks submitted values before projected values; this change preserves that
order and only adds the file alias projection. The native result and mutation
paths already carry the host display path separately from the resolved path.

The host selector parser probes the complete path before interpreting a colon
as a selector, then uses the last colon after the last slash
(`packages/native-file-tools/src/path.ts:182-212,266-288`). Normalizing a file
URL to a host string before invoking that parser preserves literal filename
precedence, `:raw`, ranges, multi-ranges, directory behavior, sibling
suggestions, `realPath`, and the common result bound.

The packaged prompt currently lists absolute paths, conditional `kb://`,
`skill://`, and HTTP(S), and says other logical schemes are separate
capabilities (`apps/api/src/prompts/tools/read.md:1-16`; `docs/native-files.md:97-115,219-227`). The native architecture paragraph in `SPEC.md` currently names only host and `kb://` authority (`SPEC.md:165-188`).

## Prior art

The OMP prior-art report (`agent://OmpReadPrior/report`, section
“file:// behavior”) identifies the same alias boundary. In the inspected OMP
checkout, `stripFileUrl` recognizes the scheme case-insensitively and delegates
conversion to `url.fileURLToPath` (`/home/leon0399/.cache/checkouts/github.com/can1357/oh-my-pi/packages/coding-agent/src/tools/path-utils.ts:94-101`).
`expandPath` applies that conversion before the rest of path normalization
(`/home/leon0399/.cache/checkouts/github.com/can1357/oh-my-pi/packages/coding-agent/src/tools/path-utils.ts:116-130`), and the read entrypoint expands a `file://`
input before URL and internal-scheme dispatch
(`/home/leon0399/.cache/checkouts/github.com/can1357/oh-my-pi/packages/coding-agent/src/tools/read.ts:1539-1548`). OMP therefore
supports the alias as a local-file spelling rather than a remote protocol. This
proposal adopts that placement but adds llame-specific authority, permission,
POSIX, mutation, and refusal rules.

## Three-plane read architecture

The read surface is divided into three static, code-owned planes. Each plane is
an ordered TypeScript array or record of typed entries. It is not a runtime
registry, operator-loaded code path, plugin loader, or dynamic import. Adding a
source, a web adapter, or a representation means one module, one list entry,
and a spec delta. This is justified here because each plane has at least two
real implementations at introduction and the current dispatch is duplicated;
it does not pre-allocate a general extension system.

```text
read(path)
  -> source plane: host | file alias -> host | kb | skill | http/https | ssh later
       submitted and projected permission admission
       source authority resolution and bounded content
       http/https only -> web service adapter plane -> generic web ladder
  -> representation plane -> shared selectors, paging, result bound, envelope
```

### Plane 1: sources, owned here

`file-locator` owns the source table and the `file://` alias in issue #929. The
source entries are:

1. host paths, the no-scheme default;
2. `file`, an alias that resolves to the host entry;
3. `kb`, Knowledge authority;
4. `skill`, read-only Skill authority;
5. web, `http` and `https`, the existing API-process fetch authority.

Each entry declares its scheme id or ids, supported operations, permission
projection, and executor. The same table drives top-level native dispatch and
permission projection. Existing entries retain their current executors and
projection functions, so existing schemes have no observable change. `ssh://`
is the next source entry and remains issue #936, not a hidden part of this
change.

### Plane 2: web service adapters, owned by `web-read-adapters`

`web-read-adapters` owns the ordered adapters inside the existing HTTP(S)
source. It covers native first-party APIs, operator-configured delegated
services, and operator-declared rewrites, with the unauthenticated public
GitHub adapter and Telegram adapter as the built-in default list. An optional
operator GitHub token is scoped by the operator's policy; delegated adapters
such as an FxEmbed protocol or a Telegram-API-style bridge, and rewrites such
as `x.pcstyle.dev`, are opt-in configuration entries. The adapter contract is
general across native APIs, service protocols, and rewrites, and every
delegated request records its origin and leak. It must reuse the existing
derived-locator admission, address pinning, bounds, provenance, and generic
fallthrough. Its change name is `web-read-adapters`; this design does not
implement or modify that plane.

### Plane 3: representations, owned by `read-representations`

`read-representations` owns content readers selected after source resolution,
including the representation selector slot and future Markdown or AST readers.
Readers consume authorized source content and preserve common selector paging,
bounds, source envelopes, and coordinates. They do not resolve authorities or
perform filesystem or network I/O. Its change name is
`read-representations`; this design does not implement or modify that plane.

`file-locator` owns the three-plane architecture paragraph in `SPEC.md` when
its implementation layer ships. Sibling changes own their plane-specific
requirements and must preserve this source-first, adapter-second,
representation-third order.

## Goals / Non-Goals

**Goals:**

- Make valid local `file://` spellings behave exactly like their absolute POSIX
  host paths for all three native operations.
- Keep authority selection, executor fencing, mutation ordering, selector
  semantics, permission admission, result identity, and bounds on one path.
- Make source dispatch and permission projection change together through one
  small static table.
- Fail closed on remote authority, unsafe URL escapes, query/fragment text, and
  malformed locators before filesystem access.
- Document the three-plane architecture and name the sibling owners.

**Non-Goals:**

- Remote `file://host/` access, `ssh://` (#936), Windows path semantics, or
  relative paths.
- A runtime registry, operator-loadable source code, dynamic imports, or a
  general reader framework.
- New configuration, credentials, network requests, tool ids, persistence, or
  changes to Knowledge, Skill, or web authority.
- Web service adapters and content representations owned by the sibling
  changes.

## Decisions

### D1: Use one static source table for dispatch and projection

**Decision.** Replace the two scheme switches with one static table. The table
has five real entries: host default, `file` alias, `kb`, `skill`, and web
(`http` and `https`). An entry records the accepted operations, a projection
from submitted text to policy text, and its executor. The host entry is selected
when no scheme exists. The `file` executor delegates to the host executor after
normalization; it is not a sixth authority.

**Alternatives rejected.** Keep a second switch and add `file` to both places.
That is shorter for one scheme but preserves two lists that must change together
for every later source, already evidenced by
`native-files.ts:70-87` and `locator-projection.ts:33-51`. Create a runtime
registry or plugin loader. That would violate `CODING_STANDARDS.md:38-41`, add
lifecycle and trust surface without an operator need, and make source authority
loadable at runtime.

**Consequence.** A source addition has one table entry and one spec delta. The
existing schemes remain wired to their current behavior. The table is a local
coordination device, not an externally extensible API. The implementation must
keep the entry ordering explicit so dispatch and projection are auditable.

### D2: Treat `file://` as a host alias, not a source authority

**Decision.** A file locator with an empty authority or a case-insensitive
`localhost` authority normalizes to an absolute POSIX host path. The alias uses
host executor binding, host mutation serialization, host directory and regular
file checks, host sibling suggestions, host `realPath`, and host result bounds.
It supports `read`, `edit`, and `write`. A successful result reports the
normalized host path in `path`; it never echoes the submitted URL as identity.

**Alternatives rejected.** Add `file` as a separate source with its own reader
and result envelope. That duplicates the host selector and mutation behavior,
creates a second executor identity, and risks different permissions for one
file. Keep `file://` read-only like Skill. The issue's three Decide questions
and the shared contract require edit and write acceptance, and the alias has no
independent read authority to justify a split.

**Consequence.** A `file://` call needs accepted native host authority just as
its absolute-path equivalent does and binds the same Run identity on its first
absolute operation. `kb://` and web behavior is unchanged. A file URL cannot
route through Knowledge, Sandbox, or a remote host.

### D3: Normalize with WHATWG URL plus `fileURLToPath`, then reuse host parsing

**Decision.** Parse the URL with Node's WHATWG URL implementation, validate the
file-specific authority and forbidden components, convert with
`fileURLToPath`, reject NUL after conversion, and pass the resulting string to
the existing host resolver. Do not split selectors before conversion. This
keeps the host resolver's literal-path probe ahead of selector interpretation,
including for a literal filename containing a colon.

The bounded Node spike in this worktree produced these results:

| Input                           | Observed Node result                                         | Design response                                        |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `file://localhost/x`            | URL host becomes empty, `href` is `file:///x`, path `/x`     | accept as `/x`                                         |
| `file:///a%2Fb`                 | `fileURLToPath` throws `ERR_INVALID_FILE_URL_PATH`           | map to `invalid_path`                                  |
| `file:///a%00`                  | conversion returns a string containing NUL                   | reject before filesystem access                        |
| `file:///a?x`                   | conversion silently returns `/a`                             | refuse the query                                       |
| `file:///a#x`                   | conversion silently returns `/a`                             | refuse the fragment                                    |
| `FILE:///x`                     | WHATWG protocol is `file:`, `href` is `file:///x`, path `/x` | accept the lower-cased scheme alias                    |
| `file://LOCALHOST/x`            | host becomes empty, path `/x`                                | accept case-insensitively                              |
| `file://otherhost/x`            | conversion throws `ERR_INVALID_FILE_URL_HOST`                | return the explicit remote-authority refusal           |
| `file:///C:/x`                  | POSIX conversion returns `/C:/x`                             | apply no drive special case                            |
| `file:///tmp/%2e%2e/secret`     | WHATWG normalization returns `/secret`                       | policy and execution see `/secret`                     |
| `file:///tmp/%252e%252e/secret` | conversion returns `/tmp/%2e%2e/secret` after one decode     | keep the literal `%2e%2e` segment; never double-decode |

**Alternatives rejected.** Use `fileURLToPath` alone. It silently discards
query and fragment text and accepts a NUL-containing result. Hand-parse the
authority and percent escapes. That risks disagreement with URL dot-segment,
case, and malformed-escape behavior and duplicates a platform parser.
Normalize only by string replacement. That cannot safely distinguish authority,
encoded separators, and path selectors.

**Consequence.** URL syntax is used only to establish a local host path. A
query or fragment is never silently discarded. A selector after conversion is
owned by the host parser, so `file:///tmp/guide.md:10-12` has the same meaning
as `/tmp/guide.md:10-12`. `%2F`, malformed escapes, NUL, and empty paths fail
before any host operation.

### D4: Answer all three #929 selector and mutation questions explicitly

**Decision.** A selector after a valid file URL means the same as the selector
after the normalized host path. `file:///srv/app.log:100-120` is equivalent to
`/srv/app.log:100-120`. On POSIX, `file:///C:/x` means `/C:/x`; the colon in
`C:` is before the final slash and is not a selector. `edit` and `write` accept
valid local file aliases and use the host operation.

**Alternatives rejected.** Refuse drive-looking forms or percent-encode the
colon specially. That would invent Windows behavior in a POSIX process and
break equivalence with `/C:/x`. Accept the alias only for `read`. That makes a
single local file have inconsistent mutation spellings and does not match the
approved contract.

**Consequence.** The prompt can state one selector rule and one authority rule.
Tests compare file URL and host calls at the result and mutation seams rather
than duplicating a new selector grammar.

### D5: Refuse authority, query, fragment, empty-path, and unsafe escape cases

**Decision.** Before filesystem resolution, refuse a non-empty authority other
than case-insensitive `localhost`, query, fragment, empty path, malformed
percent escape, percent-encoded `/`, or NUL. The authority refusal uses this
fixed message: `The URL names another machine; only this host's files are
reachable as the absolute path; remote hosts are a separate scheme.` Other
invalid file URL cases use the existing `invalid_path` error family without
returning a host path.

**Alternatives rejected.** Let Node normalize and silently drop query or
fragment. That makes text which was part of permission input disappear before
request and can hide a model mistake. Treat a non-local authority as a local
path by dropping the host. That converts an explicit remote target into a
possibly unrelated local path. Percent-decode all escapes and let the host
resolver decide. Encoded `/` and NUL can change path boundaries or produce
unsafe strings before policy and filesystem checks.

**Consequence.** Refusals happen before a filesystem probe, network request, or
mutation. `file://localhost/` remains the local root; an empty path without the
root slash is invalid. A URL naming another machine is not a request to fetch
that machine, and no remote fallback is attempted.

### D6: Project the decoded host path while retaining submitted-text admission

**Decision.** The source-table projection for a valid file alias returns the
percent-decoded normalized absolute host path plus any trailing selector. The
permission runner continues to evaluate the submitted string first and the
projection second. A reject matching either spelling vetoes the call; an allow
matches the projected host path. Invalid aliases are returned unchanged by the
pure projection and then fail native validation. The projection performs no
filesystem probe, realpath, URL fetch, authority lookup, or argument rewrite.

**Alternatives rejected.** Match only the submitted URL. A host-path reject
could be bypassed with a percent-encoded or URL spelling. Match only the
resolved path. An operator could not reject `file://` spellings, and invalid or
remote aliases could be made to look local before validation. Substitute the
resolved real path. That changes the existing direct-host policy identity and
would make symlink behavior part of permission matching.

**Consequence.** A reject such as `^/etc/` catches
`file:///etc/%70asswd` after projection. An allow such as `^/srv/docs/` admits
`file:///srv/docs/guide.md`. A reject such as `^file://` can still refuse the
submitted spelling. The same projection applies when an all-fields reject
visits the native `path` field. A broad policy allow cannot grant a remote file
authority because execution remains fail closed.

### D7: Preserve host fencing, operation semantics, and result identity

**Decision.** The implementation layer delegates normalized aliases to the
same host read, edit, and write functions. It does not add a second mutation
queue, a second durable attempt kind, a second executor binding, or a second
result format. Alias results report the normalized host path. Host `realPath`
and sibling suggestions remain governed by their current success and error
conditions.

**Alternatives rejected.** Record the submitted URL as the mutation target or
bind a separate alias identity. That would make recovery and permission audit
refer to a spelling rather than the host resource and could allow inconsistent
fences. Add alias-specific selector and result assembly. That duplicates shared
native code and makes behavior drift.

**Consequence.** Existing host tests continue to cover most behavior; focused
alias tests prove equivalence at read, edit, write, selector, authority, and
result seams. A Run that first reads through `file://` is bound exactly as one
that first reads the absolute path.

### D8: Keep unknown scheme behavior byte-for-byte stable

**Decision.** A parsed scheme not present in the source table returns the
existing `invalid_path` result with message `This path scheme is not
available.` The change does not reinterpret an unknown scheme as a host path.

**Alternatives rejected.** Fall through unknown schemes to the host executor.
The shared path parser intentionally refuses scheme-looking input, and this
would turn an authority marker into a filesystem spelling. Return a new error
for every unknown scheme. That changes an established model recovery message
without helping the requested alias.

**Consequence.** `ftp://`, `vault://`, and future schemes remain refused until
their own source design is approved. `ssh://` remains #936.

### D9: Land documentation and architecture in the implementation layer

**Decision.** The single implementation layer owns the source-table refactor,
file URL parser/alias, focused tests, `read.md`, `docs/native-files.md`, the
`SPEC.md` three-plane paragraph, and the dated `CHANGELOG.md` entry. The
proposal branch owns only planning artifacts. The architecture paragraph names
all three planes and the sibling change owners, while native docs explain local
file alias authority and refusals.

**Alternatives rejected.** Put shipped architecture in proposal or finalize.
Proposal is not shipped documentation, and finalize owns spec synchronization
and archive movement only. Split the source table and alias into separate
implementation layers. They change the same dispatch and projection boundary,
so splitting would leave an intermediate branch with inconsistent policy and
executor behavior.

**Consequence.** One implementation PR closes #929. If a sibling lands first,
this layer rebases before editing shared `native-files.ts`, `read.md`, docs, or
`SPEC.md`; if this layer lands first, the sibling rebases and preserves the
source table and architecture paragraph.

## Threats and negative permission cases

- **Authority smuggling.** `file://other.example/secret` is refused before
  `fileURLToPath`, filesystem access, or network activity. A policy allow cannot
  transform that remote authority into a local path.
- **Encoded traversal.** WHATWG dot-segment normalization occurs before the
  host path is admitted. `file:///tmp/%2e%2e/secret` projects to `/secret`, so
  a reject on `/tmp` is not incorrectly treated as a guarantee about the
  normalized target. Encoded `/` is refused, and double-encoded dot text is
  decoded only once.
- **Policy bypass through percent encoding.** The submitted text and projected
  host path are both evaluated. A host-path reject catches `%70` spellings, and
  a submitted `^file://` reject still works. Projection does not probe or
  resolve the filesystem.
- **Query and fragment confusion.** Node would drop these during
  `fileURLToPath`; this design refuses them so hidden text cannot change the
  permission identity or disappear before execution.
- **NUL injection.** Node can return a NUL-containing string for `%00`; the
  alias rejects NUL before the host parser or filesystem.
- **Case variants.** WHATWG lower-cases the scheme and host. Submitted-text
  admission still lets an operator reject an uppercase or `file://` spelling,
  while projected host-path rules remain effective.
- **No allow.** A group with no matching allow rejects a `file://` call even if
  the equivalent absolute host path would be allowed by some unrelated tool.
- **Host reject veto.** A reject for `^/etc/` rejects `file:///etc/passwd` after
  projection, even when a whole-tool allow exists.
- **Submitted reject veto.** A reject for `^file://` rejects the alias even when
  its projected host path matches an allow.
- **All-fields traversal.** An all-fields reject visits the native `path`
  through the same projection; it cannot be bypassed by placing an alias in a
  different field shape.
- **Authority still wins over policy.** A broadly allowed `file://` spelling
  with a remote authority is still refused by source validation. Policy does
  not grant a remote authority.
- **Existing host behavior.** Direct absolute paths remain textual in policy,
  retain literal-path precedence, and do not receive URL decoding.

## Open Questions

No contract-shaping questions remain: the three #929 Decide questions,
local-only authority, POSIX drive treatment, refusal set, two-pass permission
projection, and normalized result identity are settled above and in the delta
specs.

Implementation-layer questions that do not change the contract are:

1. Which existing native error helper should carry the fixed remote-authority
   message, provided the result remains `invalid_path` and does not expose the
   submitted authority beyond that bounded diagnostic.
2. Whether the source-table type belongs beside `executeNative` or in the
   existing permissions locator module. Keep one owner and avoid a new package;
   the choice must not duplicate the table or create a runtime registry.
3. Which current native test fixture is least coupled to executor setup for
   alias equivalence. The candidate seams are
   `apps/api/src/tools/native-files.test.ts` and
   `apps/api/src/tools/permissions/locator-projection.test.ts`; this is test
   placement only, not a behavior decision.
