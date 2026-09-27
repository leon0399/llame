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

### D1: Share pure scheme metadata and key exhaustive executor dispatch by it

**Decision.** A pure scheme contract module, with no executor imports, owns the
scheme ids, supported-operation metadata, and projection functions. The
permission projection consumes its static table. `native-files.ts` owns an
exhaustive `Record<SchemeId, Executor>` keyed by those same ids, so the
compiler forces a new source to receive both a projection entry and an
executor entry. Per-source mutation refusal and serialization details remain
inside each executor, preserving the different existing error and ordering
semantics. The host default is selected when no scheme exists; `file` delegates
to the host executor after strict decoding and is not a sixth authority.

The five real source entries are host default, `file` alias, `kb`, `skill`, and
web (`http` and `https`). This is the internal source table described by the
three-plane architecture: one pure scheme table and one exhaustive dispatch
record keyed by it, not a runtime registry.

**Alternatives rejected.** Keep two independent scheme switches and add `file`
to both places. That is shorter for one scheme but preserves two lists that
must change together for every later source, already evidenced by
`native-files.ts:70-87` and `locator-projection.ts:33-51`. Put executors in the
pure table. That closes the current import graph through
`web-read/execute.ts` and `web-read/admission.ts` back into
`locator-projection.ts`, risks ESM initialization cycles, and forces
source-specific mutation refusals into a generic shape. Create a runtime
registry or plugin loader. That would violate `CODING_STANDARDS.md:38-41`, add
lifecycle and trust surface without an operator need, and make source authority
loadable at runtime.

**Consequence.** A source addition has one pure scheme entry and one
compiler-checked executor entry. The existing schemes remain wired to their
current behavior. The table is a local coordination device, not an externally
extensible API. `ssh://` (#936) is the next source entry.

### D2: Treat `file://` as a host alias, not a source authority

**Decision.** A file locator with an empty authority or a case-insensitive
`localhost` authority decodes to an absolute POSIX host path without lexical
dot-segment normalization. The alias uses host executor binding, host mutation
serialization, host directory and regular file checks, host sibling
suggestions, host `realPath`, and host result bounds. It supports `read`,
`edit`, and `write`. A successful result reports the decoded host path in
`path`; it never echoes the submitted URL as identity.

**Alternatives rejected.** Add `file` as a separate source with its own reader
and result envelope. That duplicates the host selector and mutation behavior,
creates a second executor identity, and risks different permissions for one
file. Keep `file://` read-only like Skill. The issue's three Decide questions
and the shared contract require edit and write acceptance, and the alias has no
independent read authority to justify a split.

**Consequence.** A `file://` call needs accepted native host authority just as
its absolute-path equivalent does and binds the same Run identity on its first
absolute operation. `kb://` and web behavior is unchanged. A file URL cannot
route through Knowledge, Sandbox, or a remote host. `.` and `..` retain the
same textual and filesystem semantics as a directly submitted host path.

### D3: Use a strict total parser over the submitted text

**Decision.** A pure parser examines the submitted locator before any
generic scheme dispatch. The scheme `file` is matched ASCII
case-insensitively. It accepts `file://<authority><path>` and `file:<path>`
when the path starts with `/`. A locator beginning `file://` is always the
authority form; the minimal form's path begins with exactly one `/`, so
`file:////x` is the authority form with an empty authority and path `//x`,
never the minimal form. For the `//` form, authority is the raw, undecoded
text between `//` and the next `/`; it must be empty or ASCII-case-insensitive
`localhost` (so `file://%6Cocalhost/x` and `file://localhoſt/x` are remote
authorities), and this check precedes every other refusal. A missing path
after the authority is invalid, so `file://` and `file://localhost` fail while
`file:///` denotes the POSIX root. The minimal `file:/absolute/path` form is
accepted; `file:x` is invalid.
One pure classifier recognizes a leading ASCII-case-insensitive `file:` before
`parsePathScheme`, which recognizes only `://`. Both `executeNative` and
`projectNativeFilePath` call it, so the minimal form is dispatched to the host
executor and projected to its host path; without the shared classifier the
projection's early return for scheme-less text (`locator-projection.ts:33-35`)
would leave `file:/home/u/%2Essh/id_rsa` unprojected and let it miss a
host-path reject.

The parser refuses any literal `?`, `#`, `\\`, C0 control character including
tab, carriage return, and line feed, or DEL. A literal space, including a
trailing space, is a legal POSIX filename character and is retained. It
decodes each `%XX` escape once to bytes and strictly decodes the complete path
as UTF-8. Malformed escapes, non-UTF-8 output, `%2F`, and `%00` are invalid.
`.` and `..` segments are not normalized; after decoding they have exactly the
host-path semantics of the equivalent absolute path. The parser is total: it
returns either a decoded host path or a typed `invalid_path` result and never
throws. Permission projection invokes the same function and returns the
submitted text unchanged for an invalid result.

The bounded parser spike in this worktree produced these outcomes:

- `file://C:/x` -> refused because `C:` is a non-local authority.
- `file://C|/x` -> refused because `C|` is a non-local authority.
- `file://C\\|/x` -> refused because `C\\|` is a non-local authority before the forbidden backslash check.
- `file:///C|/x` -> `/C|/x`, a literal POSIX path with no drive handling.
- `file:///a<TAB>b` -> refused for a literal C0 control.
- `file:///a<LF>b` -> refused for a literal C0 control.
- `file:///tmp/a.md<trailing-space>` -> `/tmp/a.md<trailing-space>`; the `<trailing-space>` marker denotes one retained literal space.
- `file:///tmp/a\\b` -> refused for a literal backslash.
- `file:///a?` -> refused for a literal query marker.
- `file:///a#` -> refused for a literal fragment marker.
- `file://` -> refused because the path after the authority is missing.
- `file://localhost` -> refused because the path after the authority is missing.
- `file:///` -> `/`, the POSIX root.
- `file:///a%FF` -> refused because the decoded bytes are not UTF-8.
- `file:///a%zz` -> refused for a malformed percent escape.
- `file:///a%2F` -> refused for a percent-encoded `/`.
- `file:///a%00` -> refused for a decoded NUL.
- `file:///tmp/%2e%2e/secret` -> `/tmp/../secret`; the dot segment is preserved.
- `file:///tmp/notes%3A10-12` -> `/tmp/notes:10-12`; `%3A` becomes `:` before host selector rules.
- `FILE:///x` -> `/x`; the scheme is ASCII case-insensitive.
- `file:/x` -> `/x`; this is the RFC 8089 minimal form.
- `file:x` -> refused because the path does not start with `/`.

**Rejected alternative evidence.** An earlier Node spike against WHATWG URL
plus `fileURLToPath` observed `file://localhost/x` becoming `/x`,
`file:///a%2Fb` throwing `ERR_INVALID_FILE_URL_PATH`, `file:///a%00`
producing a NUL-containing string, `file:///a?x` and `file:///a#x` silently
becoming `/a`, `FILE:///x` and `file://LOCALHOST/x` becoming `/x`, and
`file://otherhost/x` throwing `ERR_INVALID_FILE_URL_HOST`. It also observed
`file:///C:/x` as `/C:/x`, `%2e%2e` dot-segment normalization, and one-level
decoding of `%252e%252e`. Those results are useful evidence for why the
platform helper is tempting, but they are rejected here because silent input
rewrites, drive quirks, dot normalization, and uncaught conversion errors do
not preserve exact host-path semantics.

**Alternatives rejected.** Use WHATWG URL plus `fileURLToPath`. It rewrites or
drops submitted controls, backslashes, queries, fragments, authorities, drive
forms, and dot segments, and it can throw for malformed or non-UTF-8 escapes.
Use a hand parser that returns exceptions. A shared total function is required
because permission projection and mutation execution call the same boundary.
Split selectors before decoding. That would make selector behavior differ from
the host parser's literal-path precedence.

**Consequence.** The alias has no platform-specific drive interpretation and no
lexical traversal normalization. A selector after decoding is owned by the
host parser, so `file:///tmp/guide.md:10-12` has the same meaning as
`/tmp/guide.md:10-12`. `%3A` decodes to `:` and then follows host selector
rules, with literal-path probing first; there is no escaped literal-colon form.

### D4: Answer all three #929 selector and mutation questions explicitly

**Decision.** A selector after a valid file URL means the same as the selector
after the decoded host path. `file:///srv/app.log:100-120` is equivalent to
`/srv/app.log:100-120`. `%3A` decodes to `:` and follows host selector rules
after the literal-path probe; there is no escaped literal-colon form. On POSIX,
`file:///C:/x` means `/C:/x`, and `file:///C|/x` means `/C|/x`, with no drive
handling. `file://C:/x` and `file://C|/x` are remote authorities and are
refused. The minimal `file:/absolute/path` form is equivalent to its absolute
host path. `edit` and `write` accept valid local file aliases and use the host
operation.

**Alternatives rejected.** Treat `%3A` as an escaped literal colon as the web
and Knowledge locators do. That would make the alias differ from the host
parser after decoding and would invent an escape form the host path does not
have. Refuse drive-looking paths after the authority has been validated. That
would invent Windows behavior in a POSIX process. Accept the alias only for
`read`. That makes one local file have inconsistent mutation spellings and does
not match the approved contract.

**Consequence.** The prompts state one selector rule and identify the
`%3A`/colon exception. Tests compare file URL and host calls at the result and
mutation seams rather than duplicating a new selector grammar.

### D5: Refuse unsafe submitted text before decoding

**Decision.** Before filesystem resolution, refuse a non-empty authority other
than case-insensitive `localhost`, a missing path after an authority, any
literal query or fragment marker, a backslash, a C0 control character, DEL,
malformed or non-UTF-8 percent escapes, percent-encoded `/`, or NUL. The
authority refusal uses this exact message: `A file:// URL with a host other
than localhost names another machine. Only this host's files are readable;
write the absolute path instead.` Other invalid file URL cases use the
existing `invalid_path` error family without returning a host path.

**Alternatives rejected.** Let Node normalize and silently drop query,
fragment, controls, backslashes, or spaces. That makes text which was part of
permission input disappear before execution and changes legal POSIX filenames.
Treat a non-local authority as a local path by dropping the host. That converts
an explicit remote target into a possibly unrelated local path. Decode
non-UTF-8 or NUL bytes and let the host resolver decide. That can produce
unsafe strings before policy and filesystem checks.

**Consequence.** Refusals happen before a filesystem probe, network request, or
mutation. `file:///` is the local root; `file://` and `file://localhost` have
no path and are invalid. A URL naming another machine is not a request to
fetch that machine, and no remote fallback is attempted.

### D6: Project the decoded host path while retaining submitted-text admission

**Decision.** The source-table projection for a valid file alias returns the
decoded absolute host path plus any trailing selector. It preserves `.` and
`..` segments exactly as submitted after one percent-decoding pass. The
permission runner continues to evaluate the submitted string first and the
projection second. A reject matching either spelling vetoes the call; an allow
matches the projected host path. Invalid aliases are returned unchanged by the
pure projection and then fail native validation. The projection performs no
filesystem probe, realpath, URL fetch, authority lookup, or argument rewrite.

**Alternatives rejected.** Match only the submitted URL. A host-path reject
could be bypassed with a percent-encoded or URL spelling. Match only the
decoded path. An operator could not reject `file://` spellings, and invalid or
remote aliases could be made to look local before validation. Substitute the
resolved real path. That changes the existing direct-host policy identity and
would make symlink behavior part of permission matching.

**Consequence.** A reject such as `^/etc/` catches
`file:///etc/%70asswd` after projection. An allow such as `^/srv/docs/` admits
`file:///srv/docs/guide.md`. An allow written as `^file:///srv/docs/` does not
admit a valid alias because the projected text has no scheme. A reject such as
`(?i)^file:` can still refuse every submitted alias spelling, including the
minimal form; a case-sensitive `^file://` misses both `FILE://` and `file:/`.
The same projection applies when an all-fields reject
visits the native `path` field. An invalid alias remains unchanged in
projection: under a host-path-only allow it is rejected as `no_allow` before
native validation; under a whole-tool allow it reaches native `invalid_path`.

### D7: Preserve host fencing, operation semantics, and result identity

**Decision.** The implementation layer delegates decoded aliases to the
same host read, edit, and write functions. It does not add a second mutation
queue, a second durable attempt kind, a second executor binding, or a second
result format. Alias results report the decoded host path. Host `realPath`
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
file URL parser/alias, focused tests, `read.md`, `edit.md`, `write.md`,
`docs/native-files.md`, the `SPEC.md` three-plane paragraph, and the dated
`CHANGELOG.md` entry. The proposal branch owns only planning artifacts. The
architecture paragraph names all three planes and the sibling change owners,
while the native and mutation prompts and operator docs explain local file
alias authority, host-only permission allows, selectors, `%3A`, and refusals.

**Alternatives rejected.** Put shipped architecture in proposal or finalize.
Proposal is not shipped documentation, and finalize owns spec synchronization
and archive movement only. Split the source table and alias into separate
implementation layers. They change the same dispatch and projection boundary,
so splitting would leave an intermediate branch with inconsistent policy and
executor behavior.

**Consequence.** One implementation PR closes #929. If a sibling lands first,
this layer rebases before editing shared `native-files.ts`, `read.md`, `edit.md`,
`write.md`, docs, or `SPEC.md`; if this layer lands first, the sibling rebases
and preserves the source table and architecture paragraph.

## Threats and negative permission cases

- **Authority smuggling.** `file://other.example/secret`, `file://C:/x`, and
  `file://C|/x` are refused by submitted-text authority validation before
  decoding, filesystem access, or network activity. A policy allow cannot
  transform a remote authority into a local path.
- **Pre-existing host traversal semantics.** The strict parser preserves `.`
  and `..` after one percent-decoding pass, so
  `file:///tmp/%2e%2e/secret` projects to `/tmp/../secret`, exactly like the
  equivalent host path. Direct host permissions already match submitted text,
  so an anchored allow such as `^/srv/docs/` admits
  `/srv/docs/../../etc/passwd`. This is a pre-existing native-file-tools
  property, not introduced or widened by this alias; changing it requires a
  separate issue and is not part of #929.
- **Policy bypass through percent encoding.** The submitted text and decoded
  host path are both evaluated. A host-path reject catches `%70` spellings,
  and a submitted `(?i)^file:` reject still works. Projection does not probe or
  resolve the filesystem.
- **Query and fragment confusion.** Literal `?` and `#`, including empty
  components such as `file:///a?` and `file:///a#`, are refused before
  decoding, so no submitted text disappears before execution.
- **NUL and malformed bytes.** Strict UTF-8 decoding rejects `%00`, `%FF`,
  malformed escapes, and encoded `/` before the host parser or filesystem.
- **Case variants.** The parser accepts the `file` scheme and `localhost`
  authority case-insensitively. A `^file://` regex reject remains
  case-sensitive; operators who want every scheme case should use
  `(?i)^file:`, which the current RE2 matcher accepts
  (`apps/api/src/tools/permissions/matcher.ts:40-63`).
- **No allow.** A group with no matching allow rejects a `file://` call even if
  the equivalent absolute host path would be allowed by some unrelated tool.
- **Host reject veto.** A reject for `^/etc/` rejects
  `file:///etc/passwd` after projection, even when a whole-tool allow exists.
- **Submitted reject veto.** A reject for `(?i)^file:` rejects every alias
  spelling even when its projected host path matches an allow.
- **URL-form allow is inert for valid aliases.** A group whose only allow is
  `^file:///srv/docs/` rejects a valid alias as `no_allow`, because projection
  drops the scheme; operators must write alias allows against host paths.
- **Invalid alias precedence.** An invalid alias remains unchanged in
  projection. A host-path-only allow therefore yields `no_allow` and
  `permission_denied` before native validation; a whole-tool allow reaches the
  native `invalid_path` result.
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
projection, and decoded result identity are settled above and in the delta
specs.

Implementation-layer questions that do not change the contract are:

1. Which existing native error helper should carry the fixed remote-authority
   message, provided the result remains `invalid_path` and does not expose the
   submitted authority beyond that bounded diagnostic.
2. Where the pure scheme module lives: `apps/api/src/tools/permissions/` beside
   `locator-projection.ts`, or a new file in `packages/native-file-tools`.
   `native-files.ts` may import it but must never own it; owning it there
   recreates the cycle through `web-read/execute.ts` and `web-read/admission.ts`.
3. Which current native test fixture is least coupled to executor setup for
   alias equivalence. The candidate seams are
   `apps/api/src/tools/native-files.test.ts` and
   `apps/api/src/tools/permissions/locator-projection.test.ts`; this is test
   placement only, not a behavior decision.
