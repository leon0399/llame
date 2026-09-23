## Why

A web read's `read` permission clause sees only the hostname text the model
or a redirecting server wrote, never the address that name resolves to
(`openspec/specs/native-file-tools/spec.md`, "Web reads follow redirects under
per-hop permission admission": "This change SHALL NOT resolve a hostname to
check its address before connecting"). A reject written for an address —
`^https?://10\.67\.88\.60/private` — is bypassed by any name that resolves
there: corporate DNS, a local resolver, an attacker-controlled zone, or a
public page that redirects into it. `https://127.0.0.1/` is dialed and dies
only at the 10 s header bound, so a host with a listener returns its body.
Issue #914, including the scope recorded in its comments: every request of a
call, the connection pinned to the address that was checked.

This is general permission strengthening, not a private-network guard: an
operator must still be able to read `http://localhost:3000/` and LAN hosts
while refusing cleartext to the public internet.

## What Changes

- Every request a web read issues — the submitted locator, each redirect hop,
  each announced alternate, suffix candidate, and `llms.txt` candidate —
  resolves its host once per call through the system resolver, evaluates the
  `read` group's rejects against an **address locator** for every resolved
  address, and connects only to the addresses no reject refused. The address
  locator is exactly the URL the request uses with its host replaced by the
  address: `https://docs.example.com/guide?q=1` resolving to `93.184.216.34`
  is also matched as `https://93.184.216.34/guide?q=1`; IPv6 is bracketed, an
  IPv4-mapped IPv6 address is written as dotted IPv4, and a read selector,
  never requested, is not part of it. An IP-literal host is matched the same
  way, with no resolution.
- Address locators are **reject-only**: a reject matching one refuses that
  address, and allow is decided on the hostname text alone, as today. A
  domain allowlist keeps working, and an allow-all group gains every address
  reject the operator writes.
- A refused address is skipped; the connection races the admitted addresses
  (Happy Eyeballs) and uses no other. When every address is refused the
  request is not issued: the call's own request or hop ends with
  `permission_denied` and a new fixed message (a hop still carries
  `rejectedUrl` in hostname form), while a probe only disqualifies its
  candidate. No address text reaches the model.
- The connection is pinned: the addresses the policy judged are the only
  ones dialed, with no second resolution between decision and connect, and a
  host resolved once keeps that answer for the rest of the call. Connections
  are not reused across requests, because each request's address locator
  carries its own path.
- Each distinct refused address is recorded privately beside the call
  decision as a derived-locator decision of the new kind `address`, without
  its text, under its own bound of 16 per call.
- Path and query percent-escapes are normalized to a fixed point in the
  canonical text policy matches and the request uses: a stray `%` becomes
  `%25`, unreserved escapes (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) are
  decoded, and every other escape keeps uppercase hex. `/%70rivate` is
  matched and requested as `/private`, and `/%%370rivate` as `/%2570rivate`,
  so no decode forms a new escape.
- The recommended `read` rejects replace F5 (`^http://`) with F5a–F5f, which
  refuse cleartext `http://` only to an address outside the internal ranges
  (loopback, `0.0.0.0/8`, RFC 1918, CGNAT `100.64.0.0/10`, link-local, ULA),
  and add F7, which refuses the well-known metadata and credential endpoints
  (`169.254.169.254`, `169.254.170.2`, `169.254.0.23`, `100.100.100.200`,
  `[fd00:ec2::254]`) on either scheme.
  A hostname text never matches F5a–F5f, so the decision falls to the
  resolved address: `http://localhost:3000/` and `http://nas.lan/` are read,
  `http://example.com/` is refused.

Not **BREAKING**: no key, tool id, error type, or schema changes. Two
decision changes reach operators who edit nothing:

- Escape normalization changes the text every clause sees, so a clause
  written against an encoded unreserved spelling (`%7Euser`, `%70rivate`) no
  longer matches it and must be written decoded.
- An operator who kept the old F5 still refuses every cleartext read,
  internal ones included. One who copies F5a–F5f **widens** cleartext reads:
  any hostname, an attacker's zone or a spoofed DNS answer included, is read
  over plain HTTP when it resolves into an internal range. That is the
  requested behavior for localhost and LAN reads; an operator who does not
  want it keeps the old F5, and the runbook says so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: "Web reads follow redirects under per-hop permission
  admission" drops the no-resolution sentence and flips the private-hop
  scenario; an added requirement covers resolution, address admission,
  pinning, and the all-refused outcome. "Web locators are fetched by the
  native read tool" states fixed-point escape normalization.
- `tool-call-permissions`: "Match submitted string values without
  serialization artifacts" adds the reject-only address locator; "Safe
  decision provenance and non-fatal rejection" adds the `address` record and
  the refused-address message; "Recommended portable policy with explicit
  replacement" replaces F5 with F5a–F5f and adds F7; "File permission
  matching uses logical resource locators" scopes its percent-decoding
  sentence to Knowledge, skill, and host locators.

## Non-goals

- A built-in address guard or fixed blocklist. Policy is the only mechanism.
- CNAME or ALIAS evaluation. The system resolver returns addresses only, and a
  CNAME rule is bypassed by an A record with the same address.
- An address-range or combinator construct in the permission language (#942);
  F5a–F5f express the complement as regexes until it lands.
- Detecting a public host that proxies to an internal one, and host `bash`,
  which reaches any address the process can.
- Caches or result snapshots (#915), PDF and image bodies (#916).

## Dependencies and delivery order

No native blockers: the web-read stack (#920–#924) is merged and archived.
`undici` becomes a direct `apps/api` dependency (already in the lockfile);
`design.md` justifies it.

```text
master <- web-read-address-policy/proposal <- web-read-address-policy/admission <- web-read-address-policy/finalize
```

- `proposal`: this ledger, design, and two delta specs. About 1,300
  authored lines. Closes nothing.
- `admission` (~900 lines): resolution, address admission, pinning,
  unreserved-escape normalization, the `address` record and message, the
  recommended rows and their boundary test, `docs/web-read.md`, changelog,
  README line. `Closes #914`.
- `finalize`: spec sync and archive only.

## Impact

`apps/api/src/tools/web-read/{http-client,admission,locator,execute,pipeline}.ts`,
`apps/api/src/tools/permissions/messages.ts`, the derived-decision bound and
its reconstruction in `apps/api/src/runs/{run-execution.service,assistant-transcript}.ts`,
`apps/api/llame.config.json.example` with its mirror
`apps/api/src/testing/portable-tool-policy.ts`, `apps/api/package.json`,
`docs/web-read.md`, `CHANGELOG.md`, `README.md`. No migration, HTTP API
surface, or database schema change.

## Acceptance

Each row is a delta-spec scenario; `tasks.md` names the owning layer.

- With `read: { allow: true, reject: [^https?://10\.67\.88\.60/private] }`,
  a read of any hostname resolving to `10.67.88.60` at `/private` — directly,
  through a redirect, or through a probe — is refused with no connection,
  while `/data` on the same address is read.
- A host resolving to one refused and one admitted address is read over the
  admitted one; a host whose every address is refused ends with
  `permission_denied` and the refused-address message.
- A resolver answer that changes after the decision is never dialed.
- Under the recommended example, `http://localhost:3000/` and a LAN host are
  read, `http://example.com/` and `http://169.254.169.254/` are refused, and
  the domain allowlist from `docs/web-read.md` still admits its host.
- `read https://host/%70rivate` is refused by a reject naming `/private`, and
  `/%%370rivate` is requested as `/%2570rivate`, never as `/private`.
- `pnpm exec openspec validate web-read-address-policy --strict`,
  `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass on
  this layer.
