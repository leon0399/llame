## MODIFIED Requirements

### Requirement: Native mutations have a durable pre-effect fence

Before an alpha native `edit` or `write` changes bytes on any scheme, the trusted runtime MUST durably record a stable mutation attempt identity and target operation metadata. The recorded target MUST be the canonical locator: a `machine://` locator for a Machine mutation and the `kb://` locator for a Knowledge mutation, never a resolved host path. A mutation MUST NOT bind the Run to a worker. A retry on another worker MUST find the open attempt by its identity.

If a retry or recovery observes an unsettled attempt, it MUST return an unknown outcome and MUST NOT invoke the mutation again. A known result MUST be settled before the model advances. Client replay MUST return the stored result without the filesystem operation.

#### Scenario: Retry finds an open native mutation

- **WHEN** a worker dies after it records a native mutation attempt but before it settles its result
- **THEN** recovery reports `outcome_unknown`
- **AND** a queue retry does not execute the same edit or write again

#### Scenario: Knowledge mutation is fenced on any worker

- **WHEN** a worker dies after it records a `kb://` edit attempt and a different worker retries the Run
- **THEN** recovery reports `outcome_unknown` on that worker
- **AND** the retry does not execute the edit again and does not fail with `executor_unavailable`

#### Scenario: Settled native mutation replays safely

- **WHEN** a client reconnects after a native mutation result was durably settled
- **THEN** replay returns the stored result
- **AND** the filesystem operation is not repeated

#### Scenario: A Machine mutation is fenced on any worker

- **WHEN** a worker dies after it records an `edit` attempt on `machine://devl/srv/app/a.ts` and a different worker that reaches `devl` retries the Run
- **THEN** recovery reports `outcome_unknown` on that worker
- **AND** the retry does not execute the edit again

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools MUST accept absolute paths and equivalent `file:` locators. They MUST run each such call on the current Machine through its Machine daemon, with the OS authority of that Machine user. They MUST also accept `kb://` locators under the Knowledge locator requirement. `read` MUST also accept read-only skill locators under the Skill locator requirement and read-only web locators under the Web locator requirements.

When a Workspace is entered, the tools MUST also accept relative paths. They MUST resolve a relative path from the Workspace root with lexical path resolution like POSIX `path.posix.resolve`, and they MUST keep a trailing separator. The Machine daemon MUST receive exactly the projected absolute path, with that trailing separator. Projection MUST NOT resolve symbolic links. The OS follows symbolic links in the projected path as for any absolute path.

Here, a relative path does not start with `/`. It also has no `scheme:` prefix that the shared locator parser or the `file:` classifier knows. The classifier knows case-insensitive `scheme://` and `file:` forms. An unknown scheme MUST stay `invalid_path` and MUST NOT become a relative path. `..` can resolve outside the root. Without an entered Workspace, the tools MUST refuse a relative path with the existing `invalid_path` error.

The `file:` classifier MUST run before Workspace projection in native dispatch, so every valid `file:` locator is absolute and never resolves from the Workspace root. Scheme routing MUST occur before path resolution. `file:`, `kb://`, `skill://`, `http://`, and `https://` locators therefore stay under their own authority and never project from the Workspace root. A selector MUST stay with the path part and apply to the target that the path resolves to. The result of a Workspace-projected path MUST identify the canonical locator of the projected path.

A `file:` locator MUST accept `file://<authority><absolute-path>` and the RFC 8089 minimal form `file:<absolute-path>`. In these requirements, a `file:` locator means either form. One classifier MUST find a leading `file:` before other scheme parsing, and native dispatch and permission projection MUST both use it. A locator that starts with `file://` MUST always be the authority form.

The path of the minimal form MUST start with exactly one `/`. The classifier MUST compare `file` and `localhost` ASCII case-insensitively against the raw, undecoded text. In the `//` form, the authority is the text between `//` and the next `/`. The authority MUST be empty or `localhost`.

Authority validation MUST occur before the other refusals of the locator. A missing path after the authority MUST fail with `invalid_path`. An invalid `file:` locator MUST fail with `invalid_path` at dispatch, before any Machine contact. A valid `file:` locator then follows the absolute-path rules of this requirement.

Before the Machine operation, the classifier MUST decode each percent escape once to bytes. It MUST then decode the complete path strictly as UTF-8, without lexical `.` or `..` normalization. These MUST fail with `invalid_path` before filesystem access:

- a literal query, fragment, backslash, C0 control character, or DEL,
- a malformed or non-UTF-8 escape,
- a percent-encoded `/`, and a NUL.

A literal space, also a trailing space, MUST stay part of the POSIX path. A trailing selector after a valid `file:` locator MUST have the same meaning as after the decoded path. `%3A` MUST decode to `:` and then follow the selector rules for a path after the literal-path probe.

No escaped literal-colon form exists. `file:///C:/x` MUST mean `/C:/x`, and `file:///C|/x` MUST mean `/C|/x`, without drive handling. The tools MUST refuse `file://C:/x` and `file://C|/x` as other-host authorities. `file:///` MUST mean the POSIX root.

The scheme of the `path` argument MUST select the authority. No other argument or stored declaration field can select it. The API process MUST fetch a web locator through its own outbound HTTP, and the fetch MUST NOT need a Machine. `edit` and `write` MUST operate only on regular files.

Both MUST reject an `http://` or `https://` locator with `invalid_path` before any request. `read` MUST operate on regular files and directories. The Web locator requirements govern a web locator instead of the entry kind. Every other entry kind MUST fail.

A `read` that misses a regular file MUST offer bounded sibling-name suggestions from its existing parent directory. This applies on every scheme that resolves a directory on a Machine or in an installation resource. The suggestions MUST be names only, from one bounded directory read and bounded scoring work on the error path, with no work on success. A miss on an absolute or Workspace-projected path MUST follow a symbolic-link parent exactly as the read itself follows links.

A web locator MUST NOT give sibling suggestions, because a failed web read has no directory to list. The tools MUST accept a trailing path separator on a directory path. A trailing separator on any other target MUST fail as `not_found`. In a web locator, a trailing separator MUST stay part of the URL, and the tool MUST NOT read it as a directory request.

Only the path can select a Machine. A model argument MUST NOT select a different owner, tenant, permission mode, or remote authority. The candidate resolver MUST advertise `edit` and `write` whenever `tools.allowed` names them, as `tool-calling` states. `read` MUST be eligible for advertisement whenever `tools.allowed` names it. When the current Machine is unreachable, an absolute path or a valid `file:` locator on it MUST fail closed with `machine_unavailable`.

It MUST NOT resolve through Knowledge, another Machine, or the worker process. A path operation MUST target the current Machine of its attempt. A `kb://` or web operation MUST NOT need a Machine. A successful `file:` result MUST report the canonical `machine://` locator of the decoded path, not the submitted URL.

#### Scenario: Coding file is read by absolute path

- **WHEN** the model calls `read` with an existing absolute regular-file path and the current Machine is `devl`
- **THEN** the `devl` Machine daemon reads that file with the OS authority of its user
- **AND** the result identifies `machine://devl/<path>` and does not invent a Knowledge Space binding

#### Scenario: Absolute path without accepted native authority fails closed

- **WHEN** the process has a configured Knowledge root, the current Machine `devl` is unreachable, and the model calls `read` with an absolute path
- **THEN** the tool returns `machine_unavailable`
- **AND** it does not resolve the path through the Knowledge root, another Machine, or the worker process

#### Scenario: Missing or non-regular target fails

- **WHEN** `read`, `edit`, or `write` targets a missing entry, or a device, socket, FIFO, or other special entry
- **THEN** the tool returns a bounded structured error
- **AND** it does not follow a different path or use another Machine

#### Scenario: A missed read suggests sibling names

- **WHEN** `read` targets a missing regular file, named without a trailing separator, whose parent directory exists, on any scheme that resolves a directory
- **THEN** the `not_found` result also lists at most five plausible entry names from that directory
- **AND** each listed entry is a bare name without any path
- **AND** a miss with no plausible sibling, a trailing separator, or scoring work past its bound returns the bare `not_found`
- **AND** `edit` and `write` never produce the suggestion list

#### Scenario: A missed read under a missing parent says so

- **WHEN** `read` targets a path whose parent directory does not exist
- **THEN** the `not_found` result states that the parent directory is missing
- **AND** no entry of any other directory is listed

#### Scenario: Mutation on a directory fails

- **WHEN** `edit` or `write` targets an existing directory
- **THEN** the tool returns the `not_regular_file` error
- **AND** it does not create, rename, or modify any entry

#### Scenario: Trailing separator on a file fails

- **WHEN** `read` targets an existing regular file with a trailing path separator
- **THEN** the tool returns `not_found`
- **AND** it does not read the file

#### Scenario: Physical path is bound to one executor

- **WHEN** a later attempt of a Run on another worker reads the same absolute path in the same unbound Chat
- **THEN** the path resolves on the same current Machine, `machines.default`
- **AND** it never resolves on the computer of that worker unless that computer is the current Machine

#### Scenario: A web locator is read without host authority

- **WHEN** the current Machine is unreachable, `read` is allowlisted, and the model calls `read` with `https://example.test/guide`
- **THEN** the API process fetches the URL and returns the page content
- **AND** the read does not return `machine_unavailable` and uses no Machine, while an absolute path in the same Run returns `machine_unavailable`

#### Scenario: Mutation on a web locator fails before any request

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** the tool returns `invalid_path`
- **AND** no request is issued and no entry is created, renamed, or modified

#### Scenario: A failed web read suggests no siblings

- **WHEN** `read` targets `https://example.test/missing` and the server answers 404
- **THEN** the error names the status and lists no sibling names
- **AND** no directory is read to produce suggestions

#### Scenario: A file URL reads the host file

- **WHEN** the current Machine is the host Machine `devl`, the model calls `read` with `file:///tmp/guide.md`, and `/tmp/guide.md` is an existing regular file
- **THEN** the call and a call with `/tmp/guide.md` both use the `devl` Machine daemon and return the same file content and native read metadata
- **AND** the `path` of the file URL result is `machine://devl/tmp/guide.md`

#### Scenario: Localhost file authority is accepted

- **WHEN** the model calls `read` with `file://LOCALHOST/tmp/guide.md`
- **THEN** the tool reads `/tmp/guide.md` on the current Machine
- **AND** no other authority is contacted

#### Scenario: A file URL selector follows host selector rules

- **WHEN** the model calls `read` with `file:///tmp/guide.md:10-12`
- **THEN** the classifier decodes the file URL to `/tmp/guide.md` before native selector handling
- **AND** the result selects lines 10 through 12 with the same context, bounds, and range metadata as `/tmp/guide.md:10-12`

#### Scenario: A file URL mutation uses the host operation

- **WHEN** `edit` or `write` targets a valid `file:///tmp/guide.md` locator and the current Machine is the host Machine `devl`
- **THEN** the mutation runs through the `devl` Machine daemon with the same fencing, serialization, validation, and result semantics as the absolute path
- **AND** the result identifies `machine://devl/tmp/guide.md` rather than the submitted URL

#### Scenario: A remote file authority is refused before access

- **WHEN** `read`, `edit`, or `write` targets `file://other.example/tmp/guide.md`, `file://C:/x`, or `file://C|/x`
- **THEN** the tool returns `invalid_path` with `A file:// URL with a host other than localhost names another Machine. Use machine://<name>/<path> to reach a configured Machine.`
- **AND** it performs no filesystem probe, mutation, or network request

#### Scenario: Query or fragment on a file URL is refused

- **WHEN** `read`, `edit`, or `write` targets `file:///tmp/guide.md?version=1`, `file:///tmp/guide.md#section`, `file:///tmp/guide.md?`, or `file:///tmp/guide.md#`
- **THEN** the tool returns `invalid_path` before decoding or filesystem access
- **AND** it does not silently discard the query or fragment

#### Scenario: Encoded separator, NUL, or invalid UTF-8 is refused

- **WHEN** `read`, `edit`, or `write` targets a file URL that contains a percent-encoded `/`, NUL, or non-UTF-8 escape, such as `file:///tmp/a%2Fb`, `file:///tmp/a%00b`, or `file:///tmp/%FF`
- **THEN** the tool returns `invalid_path` before filesystem access
- **AND** it does not decode the spelling into a different path

#### Scenario: Unsafe literal file URL characters are refused

- **WHEN** a file URL contains a literal backslash, tab, line feed, carriage return, DEL, or another C0 control character
- **THEN** the tool returns `invalid_path` before decoding or filesystem access
- **AND** a literal trailing space stays accepted as part of the POSIX filename

#### Scenario: A file URL with no authority path is refused

- **WHEN** `read` targets `file://` or `file://localhost`
- **THEN** the tool returns `invalid_path`
- **AND** it does not read the root directory

#### Scenario: The file URL root is a directory

- **WHEN** `read` targets `file:///` and the current Machine is `devl`
- **THEN** the `devl` Machine daemon returns the root directory listing under the existing directory bounds
- **AND** the result identifies `machine://devl/`

#### Scenario: The minimal file URL form equals its host path

- **WHEN** the model calls `read` with `file:/tmp/guide.md`
- **THEN** it reads the same file and returns the same native metadata as `/tmp/guide.md`

#### Scenario: Workspace-relative local read resolves from the Workspace root

- **WHEN** the model reads `src/app.ts:2-4` with a Workspace entered at `machine://devl/work/project`
- **THEN** the `devl` Machine daemon reads `/work/project/src/app.ts` and applies selector `:2-4` to that file
- **AND** the result identifies `machine://devl/work/project/src/app.ts` as the path used

#### Scenario: Workspace-relative path may resolve outside the root

- **WHEN** the model reads `../shared/data.json` with a Workspace entered at `machine://devl/work/project`
- **THEN** the `devl` Machine daemon reads `/work/shared/data.json` when a registered root contains it
- **AND** the result identifies `machine://devl/work/shared/data.json` and the Workspace root is not a confinement boundary

#### Scenario: Workspace projection preserves a trailing separator

- **WHEN** the model reads `app.ts/` with a Workspace entered at `machine://devl/work/project`
- **THEN** lexical projection passes `/work/project/app.ts/` exactly to the `devl` Machine daemon
- **AND** the regular-file target returns `not_found` and is not read

#### Scenario: Unknown scheme is invalid

- **WHEN** the model calls `read` with `vault://notes/a.md` while a Workspace is entered
- **THEN** the tool returns `invalid_path`
- **AND** it does not treat the unknown-scheme value as a relative path or probe a file

#### Scenario: Relative local paths are refused without a Workspace

- **WHEN** no Workspace is entered and `read`, `edit`, or `write` receives a relative path
- **THEN** the tool returns the existing `invalid_path` error
- **AND** it does not read, create, or modify an entry

#### Scenario: A file alias ignores the entered Workspace root

- **WHEN** the model calls `read` with `file:///etc/passwd` while a Workspace is entered at `machine://devl/work/project`
- **THEN** the tool resolves `/etc/passwd` on `devl` as an absolute target
- **AND** it does not read `/work/project/etc/passwd`

#### Scenario: An invalid alias fails before executor availability

- **WHEN** the current Machine is unreachable and the model calls `read` with `file://other.example/x` or `file:///a?`
- **THEN** the tool returns `invalid_path`
- **AND** it does not contact a Machine and does not return `machine_unavailable`

#### Scenario: A file URL without an absolute path is invalid

- **WHEN** the model calls `read` with `file:x`
- **THEN** the tool returns `invalid_path`
- **AND** it does not treat `x` as a relative path or a filename

#### Scenario: POSIX drive syntax is an ordinary path

- **WHEN** the model calls `read` with `file:///C:/x` or `file:///C|/x` on a POSIX Machine
- **THEN** the target is `/C:/x` or `/C|/x`
- **AND** no Windows drive-letter interpretation is applied

#### Scenario: A decoded colon follows host selector rules

- **WHEN** the model calls `read` with `file:///tmp/notes%3A10-12`
- **THEN** `%3A` decodes to `:` and the literal-path probe runs on the current Machine before selector interpretation
- **AND** there is no escaped literal-colon spelling distinct from `/tmp/notes:10-12`

### Requirement: Web locators are fetched by the native read tool

The native `read` tool MUST accept an absolute `http://` or `https://` locator as its `path`. The API process MUST fetch it through its own outbound HTTP, and the fetch MUST NOT need a Machine. The tool MUST admit no other web scheme. `edit` and `write` MUST reject a web locator with `invalid_path` before any request.

The tool MUST first cut a fragment and split off a selector. It MUST then normalize the submitted web locator to its WHATWG URL serialization and request that text. The tool MUST normalize these forms and not refuse them, because none of them addresses a different resource:

- an uppercase scheme or host, and a percent-encoded or Unicode host,
- an explicit default port, a root dot on a host, and an empty path,
- unencoded path or query characters, and percent escapes in the path or query.

A refusal of them costs a call and teaches the model nothing for the next locator.

The tool MUST normalize path and query escapes in one pass that gives a fixed point:

- It MUST encode a `%` that does not start a valid escape as `%25`.
- It MUST decode an escape of an unreserved character (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`).
- It MUST keep every other escape encoded with uppercase hexadecimal digits, `%2F` included.

A second normalization of the normalized text thus changes nothing, and llame forms no new escape. The tool MUST cut a fragment before anything else reads the locator, because the request drops it in any case.

No normalization can repair these, so they MUST still fail before any request: a text that is not a URL, a scheme other than `http` and `https`, and userinfo. Userinfo MUST fail with `invalid_path`, so the tool never sends credentials that the model put in a URL, and the message MUST NOT repeat them. A suffix outside the selector grammar MUST fail with `invalid_selector` and name the forms that work. The locator before that suffix is a URL that this tool can request.

After the tool admits and canonicalizes the submitted locator, the read MUST consider the ordered, code-owned web adapters before the generic HTML and text ladder. The tool MUST select a matching adapter without network I/O. `:raw` MUST bypass every adapter and keep the raw-response behavior below. `:outline` MUST NOT bypass an adapter, because it describes the document that a plain read of the same locator returns.

The rendered document of a claiming adapter is thus the input of the outline. An adapter MUST NOT add a tool id, a second permission group, or a different source authority. An adapter target is another derived locator, and the tool MUST admit it separately.

The requested text is not always the submitted text, so the permission decision MUST examine both. A reject clause that matches the submitted locator without its read selector, or its normalized form, MUST refuse the call. No spelling can thus miss a reject. The tool MUST decide the allow on the normalized form.

An allow names the resource that the call reaches, and the two texts are one resource. A redirect hop is a different resource, and the tool MUST admit it separately. The tool MUST also judge every address that a request connects to under the address-admission requirement below.

Only the `path` clauses of the `read` permission group MUST control the availability and restriction of web locators through `read`. A prefix allow admits the web, and a prefix or domain reject removes a host. This rule governs an attempt in `default` mode. Under `bypass`, the web is reachable without a `path` allow, as the Purpose of this capability states.

The system MUST NOT add a web tool id, a `tools.allowed` entry, a configuration block, or an advertisement condition for a web locator. `web_search`, which `web-search` specifies, is a separate tool with its own allowlist entry, configuration, and permission group. The `path` clauses of the `read` group do not restrict it. A process that does not advertise `read` MUST NOT reach a URL through it.

Each call MUST fetch again. The tool MUST NOT cache a response or a render, and a later selector read of the same locator MUST send a new request. The tool MUST NOT consult `robots.txt` or any publisher signal such as `content-signal`. The tool MUST NOT present a fetch as permission from the publisher.

The scheme split and the trailing selector rules that protect a `scheme://` prefix MUST apply unchanged. The tool never reads the colon of the scheme as a selector. The shipped trailing-selector split, the last colon after the last slash, governs the rest. The tool MUST recognize the `:raw` and `:outline` representation forms before that last-colon fallback.

The tool MUST split a selector only from a locator that has a path and contains no `?` and no `#`. A colon in a query is thus part of the URL: `https://example.test/search?at=2026:10` is fetched as written. The only colon of a locator without a path opens its port. `https://example.test:88` is port 88, `https://example.test/:88` is line 88 of the site root, and `https://example.test:88/:88` is line 88 from port 88.

The model MUST write a literal colon in the last path segment of a locator without a query as `%3A`, as in `https://w.example/wiki/Special%3ASearch`. The tool always reads a trailing colon as a selector split. The shipped grammar admits `raw`, `raw:<list>`, `N`, `N-M`, `N+K`, `N-`, `-K`, comma lists of those, `outline`, `outline:N`, `outline:N-M`, `outline:N+K`, `outline:N-`, and `outline:-K`. `:<list>:raw` is the same read as `:raw:<list>`. `Search` is outside the grammar, so `https://w.example/wiki/Special:Search` fails as `invalid_selector`.

`https://w.example/docs/2024:10` selects line 10 of `https://w.example/docs/2024`, and `https://w.example/docs/2024:10-20` selects lines 10 through 20. The tool MUST split a suffix `:outline` or `:outline:<range>` as the outline representation before the last-colon fallback. `https://h.example/p:outline:5-40` thus requests `https://h.example/p` and limits the outline to rendered lines 5 through 40. The model MUST percent-encode a literal colon in the last segment of a path that ends in `outline`.

Each remaining refusal MUST name the spelling that works, not the rule that the locator broke:

- A selector written directly after the authority, such as `https://example.test:1-5`, is not a URL, because `1-5` is not a port. The answer MUST be the serialization of the authority with that selector: `https://example.test/:1-5`.
- For a port that is not a number, such as `https://example.test:abc/`, the answer MUST name that rule and the same locator without a port. The locator is absolute, and only its port is broken.
- A suffix can mean a line that the grammar cannot serve, such as `:12+`, or be outside the grammar, such as `Search`. The answer MUST then name the forms first, `N-` and `-K` included. It MUST name the encoding of the literal colon second.
- A selector can be past the end of the render or contain no line. The answer MUST then give the number of lines that the page rendered. The model cannot know that number before it reads the page.

#### Scenario: A web locator is fetched by the API process

- **WHEN** the model calls `read` with `https://example.test/guide`
- **THEN** the API process issues the request and returns the page content
- **AND** no Machine is needed, used, or reported

#### Scenario: A rejected cleartext scheme never reaches the network

- **WHEN** the `read` group rejects `path` matching `^http://` and the model reads `http://example.test/guide`
- **THEN** the call is rejected before any request is issued
- **AND** an admitted `https://` locator is unaffected by that reject

#### Scenario: A web locator is never mutated

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** it returns `invalid_path`
- **AND** no request is issued

#### Scenario: A noncanonical spelling is normalized, not refused

- **WHEN** the model reads `https://g%72okipedia.com/page`, `HTTPS://Example.test/guide`, `https://example.test:443/guide`, or `https://example.test./guide`
- **THEN** the read requests the normalized locator (`https://grokipedia.com/page`, `https://example.test/guide`) without a refusal first
- **AND** a reject clause written against the canonical spelling still refuses every one of those variants
- **AND** the decision examines the submitted text and the normalized text
- **AND** a reject clause written against the submitted spelling, such as one naming `%72`, also refuses

#### Scenario: An encoded unreserved character cannot slip past a path reject

- **WHEN** the `read` group rejects `path` matching `^https://example\.test/private` and the model reads `https://example.test/%70rivate`
- **THEN** the call is rejected before any request, because the normalized text is `https://example.test/private`
- **AND** `https://example.test/%%370rivate` is requested as `https://example.test/%2570rivate`, whose once-decoded path is the literal `/%70rivate` it named, so llame's normalization forms no new escape; a server that decodes a path twice can still read it as `/private`, which a path-scoped rule cannot bound
- **AND** `https://example.test/a%2fb` is requested as `https://example.test/a%2Fb`, still encoded

#### Scenario: A pathless host reads its port, a path reads its line

- **WHEN** the model reads `https://example.test:88`, which has no path for a selector to trail
- **THEN** the read requests `https://example.test:88/` on port 88, and the permission decision matched that same text
- **AND** `https://example.test/:88` requests the site root and returns line 88 of its render
- **AND** `https://example.test:88/:88` requests the root on port 88 and returns line 88 of it

#### Scenario: Userinfo in a locator fails closed

- **WHEN** the model reads `https://user:secret@example.test/guide`
- **THEN** the read returns `invalid_path` before any request
- **AND** no credential from the locator is sent to the host

#### Scenario: A colon in the last path segment is a selector unless encoded

- **WHEN** the model reads `https://w.example/wiki/Special:Search`
- **THEN** the read fails with `invalid_selector` and issues no request, because the split-off suffix is present but outside the grammar
- **AND** `https://w.example/wiki/Special%3ASearch` is fetched as written, while `https://w.example/docs/2024:10` selects line 10 and `https://w.example/docs/2024:10-20` lines 10 through 20 of `https://w.example/docs/2024`
- **AND** `https://w.example/wiki/Special:-5` is the last five rendered lines of `https://w.example/wiki/Special`, and the literal spelling of that same resource is `https://w.example/wiki/Special%3A-5`

#### Scenario: Outline representation splits before the last-colon fallback

- **WHEN** the model reads `https://h.example/p:outline:5-40`
- **THEN** the request targets `https://h.example/p` and the outline is scoped to rendered lines 5 through 40
- **AND** the `:outline` text is not sent as part of the URL path

#### Scenario: A refused locator names the spelling that works

- **WHEN** the model reads `https://example.test:1-5`, which no URL parser accepts because `1-5` is not a port
- **THEN** the read returns `invalid_path` naming `https://example.test/:1-5`, and resubmitting that reads lines 1 through 5 of the page
- **AND** reading `https://example.test/guide:12+` returns `invalid_selector` naming the `:N`, `:N-M`, `:N+K`, `:N-`, and `:-K` forms before the `%3A` spelling, while `https://example.test/guide:12-` reads line 12 through the render's last line
- **AND** a suffix outside the grammar with no line number in it, such as `https://w.example/wiki/Special:Search`, names the same forms and then the encoded spelling

#### Scenario: A selector the page cannot serve reports the page's length

- **WHEN** the model reads `https://example.test/guide:100-200` and the render is 3 lines long
- **THEN** the read returns `invalid_selector` reporting that the page rendered 3 lines
- **AND** the message does not repeat the error type as its text

#### Scenario: A local-only allow does not admit the web

- **WHEN** the only allow clause of the `read` group is a `path` regex for `^machine://`
- **THEN** an `https://` locator matches no allow and is rejected as `no_allow` before any request

#### Scenario: Publisher signals are not permission

- **WHEN** a page's `robots.txt` disallows the path or its response carries `content-signal: ai-train=no`
- **THEN** an admitted read still fetches the locator and returns its content
- **AND** the read does not report or enforce the signal

#### Scenario: Read path clauses do not govern web search

- **WHEN** the `read` group has no allow for `^https://` and `tools.allowed`, `webSearch`, and `tools.permissions.web_search` admit `web_search`
- **THEN** a `web_search` call runs its engines and returns results
- **AND** a `read` of any returned `https://` URL is still rejected as `no_allow` before any request
