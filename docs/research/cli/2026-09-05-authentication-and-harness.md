# CLI authentication and harness decisions

Date: 2026-09-05. Implementation base: `7d31a453788e6f56e75eb170c64c37135060c9d3`.
The bundle's VISION, SPEC and research take precedence over the older separately
attached versions. This document separates source observations from decisions.

## Repository observations

`apps/api` already accepts opaque Bearer sessions through SessionAuthGuard and
provides login, session inspection/revocation, model discovery, create-or-append
chat messages, durable run events, receipts and cancellation. Its request process
queues work; disconnecting a CLI does not cancel the worker. Personal-node storage
need not share the Hub's multi-user Postgres schema. The local-nodes research
separates human authentication, node identity, enrollment, resource replication,
and Workspace execution.

The reusable operator interpolation package already exists. Pure secret
redaction, Unicode-safe clipping and structured result truncation are presently
inside the API and can become shared runtime code. Server provider execution,
RLS and the worker must not be pulled into the CLI.

## Authentication decision

Ship existing first-party session authentication, not a new authorization server.
`auth login` calls `/auth/v1/login` and stores only its opaque session token and
account identity, bound to the exact normalized remote authority. A token can
also be supplied explicitly through stdin or the environment. Never accept an
arbitrary OIDC ID token as an llame API credential. `auth logout` revokes the
server session before deleting its local copy; a failed revocation is reported.
A separate explicit local forget operation does not pretend to revoke anything.

Require HTTPS except literal IP loopback development endpoints. Reject URL
userinfo, query/fragment and redirects, including same-host redirects. Never pass
provider credentials to the Hub or session credentials to model endpoints.
Credentials are separate 0600 files beneath a 0700 state directory on POSIX;
this is not encryption or a vault. Windows users must protect their profile with
an appropriate ACL. Environment-based credentials avoid persistent token files.

### OAuth / OIDC follow-on (not implemented in this slice)

OAuth grants API access; OIDC adds an identity layer. A future browser-native
login should use Authorization Code with S256 PKCE, an external browser, strict
state/issuer validation and a loopback redirect bound only to a literal loopback
address. Do not embed a client secret in a distributed CLI. For SSH/headless
terminals, implement the device authorization grant on the Hub, with expiry,
rate limits, user-code confirmation and the specified polling/slow-down errors.
OIDC belongs behind the Hub's login boundary: validate the IdP issuer, audience,
nonce and signature, link its subject to an llame user, and issue an llame API
credential. Do not implement the obsolete password OAuth grant. The current
first-party local-account login endpoint is not an OAuth grant.

Node enrollment is a **different** future authorization operation. Follow the
bundled research: fresh node keypair/identity, explicit human approval, narrow
proof-of-possession credentials, remote revocation and a new identity on relink.
A long-running enrolled daemon must not retain the CLI's general human session.
Remote CLI attachment here is neither enrollment nor Personal Realm sync.

Primary sources:

- [RFC 8252: OAuth for native apps](https://www.rfc-editor.org/rfc/rfc8252.html)
- [RFC 8628: device authorization grant](https://www.rfc-editor.org/rfc/rfc8628.html)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)

## Harness source observations and adoption

[OpenCode's CLI](https://opencode.ai/docs/cli/) separates local runs from attachment
to a running server and supports machine-readable output. Adopt explicit mode
selection and the same user-facing commands, not its authentication defaults or
entire runtime.

[oh-my-pi](https://github.com/can1357/oh-my-pi) exposes separable agent/runtime
components, durable sessions and stale-edit-aware tooling. Adopt explicit
transcripts/tool outcomes and content-hash preconditions for edits. Do not import
its terminal UI or another full agent hierarchy.

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) describes an
everything-is-a-plugin Cordis architecture, currently a developer preview with
breaking changes. Keep local execution, transport and terminal rendering behind
small boundaries, but do not add a second plugin framework to llame. README
examined at blob `9f89db3d4502dea4a0d181799164f304d4976740`.

[goose](https://github.com/aaif-goose/goose) presents desktop, CLI and API surfaces
for the same general-purpose agent, with provider and MCP extensibility. Preserve
surface/runtime separation; do not require Rust, ACP or a second daemon for this
TypeScript slice. README examined at blob
`44c960f0193de1ccd3a13721cfe2daf5e7707ac5`.

`yasasbanukaofficial/claude-code` returned 404 through the GitHub connector during
this review. No code or unverifiable behavior from that repository is used.
[Official Claude Code permission documentation](https://code.claude.com/docs/en/permissions)
is the substitute primary source: runtime permissions, not prompt instructions,
control tool authorization.

The repository's `.agents/skills/agents-best-practices` supplies the directly
applicable rules: small bounded loop, propose/validate/approve/execute/verify,
structured observations even on denial, bounded tool outputs, explicit native
placement, immutable evidence and honest verification claims. Its coding-agent
overlay is guidance, not a mandate to install a second orchestration framework.

No third-party harness source is copied. Existing llame code is moved with Git.

## Deliberate implementation limits

A local OpenAI-compatible Chat Completions transport is sufficient to exercise
an independently useful personal runtime against user-managed endpoints. It is
not a replacement for the Hub's AI SDK Responses adapter, nor a claim of universal
provider compatibility. It must have streaming-wire tests, explicit bounds and
no hidden fallback. Node's built-in SQLite keeps local durability independent of
Postgres and native npm addons. Node 22's SQLite API is experimental; it is not
presented as equivalent to a continuously running Hub worker.

Without a process supervisor, a killed local run is interrupted, not magically
resumed. Inspection and a subsequent conversation turn remain possible; no
uncertain side effect is replayed. Conversation growth fails visibly at a
configured budget instead of silently dropping context. Automatic compaction,
MCP/ACP/A2A and enrolled-node execution are separate extensions.
