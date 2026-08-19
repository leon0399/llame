## Context

See [proposal.md](proposal.md) for motivation and [specs/](specs/) for the behavior contract. Every technical claim below is sourced in [docs/research/tool-harness/2026-08-12-mcp-stdio.md](../../../docs/research/tool-harness/2026-08-12-mcp-stdio.md), which carries file:line citations; this document records the decisions, not the evidence.

Three properties of the shipped MCP path constrain the approach:

- **Every guard lives in a wrapped `fetch`.** `mcp-server-client.ts`'s `protocolGuardedFetch` and `createMcpBoundedFetch` enforce the byte bounds, the protocol pin, session-id protection, and response matching. stdio has no `fetch`, so none of that layer transfers; the transport instance is the only equivalent seam.
- **The API process holds live MCP connections.** `ChatsModule` imports `McpRuntimeModule` and `ChatLoopService` calls `snapshotCandidates()` to author a Run's availability manifest at accept time. Discovery has no offline form, so "spawn only where Runs execute" is not available.
- **Secrecy is enforced by a value set, not by a channel.** `normalizeProtectedValues` collects configured header values, and every egress checks against that set. Anything llame did not resolve cannot be redacted.

## Goals / Non-Goals

**Goals:**

- One lifecycle, catalog, and admission path shared by both transports, differing only where the transport genuinely differs.
- The configuration file is the complete statement of what a child process can reach.
- No new authorization concept, no new unavailability vocabulary, no change to shipped HTTP behavior.

**Non-Goals:**

- Sandboxing or resource-limiting a child process. A configured server runs as the llame user with llame's access. Documented, not mitigated.
- Guaranteeing termination of a process tree a configured executable spawns.
- Reconciling stdio's bounded retry with HTTP's unbounded reconnect. Noted as a follow-up.

Originally also listed here: bounding the MCP SDK's read buffer. Reversed — see D1's revision note and the corresponding entry under Risks / Trade-offs. The reasoning that moved it out of Non-Goals: this document's own D1 evaluation weighed the risk as "operator-installed local process, not an attacker," but that framing only narrows who can _deliberately_ trigger unbounded growth — it says nothing about an ordinary bug doing the same thing with no adversary at all (an unbuffered debug dump, a misconfigured logger writing to stdout instead of stderr). A goal framed around trust was the wrong lens for a risk that does not require distrust to fire.

## Decisions

### D1: Use the official `StdioClientTransport`, not the AI SDK's, and not one we write

**Revised.** This decision's "not one we write" conclusion is reversed for the read-buffer piece specifically; the rest of the evaluation below stands. What changed: the original evaluation treated "a llame-authored transport" as one all-or-nothing choice, costed against a _full_ reimplementation diverging broadly from upstream. Review surfaced that the actual mitigation needed is narrow — own only the spawn and stdout-read path, transcribe the SDK's spawn options, base-environment allowlist, and close() escalation verbatim rather than reinvent them — which is a much smaller and more targeted divergence than "permanently diverging from upstream" implied. Two further reconsiderations followed from writing that narrow piece: `@modelcontextprotocol/sdk`'s `deserializeMessage`/`serializeMessage`/`getDefaultEnvironment` are public exports reusable directly, so the custom transport isn't reimplementing wire framing either; and `createMCPClient` accepts a transport structurally, not nominally, so the custom transport satisfies it the same way `StdioClientTransport` always did, without adopting `@ai-sdk/mcp`'s own `MCPTransport` type nominally (its `JSONRPCMessage` differs narrowly from the raw SDK's on an error response's optional `id`). See `mcp-stdio-transport.ts`'s `BoundedStdioTransport` and the corresponding Risks / Trade-offs entry.

`createMCPClient` accepts `MCPTransportConfig | MCPTransport` and branches on `isCustomMcpTransport`, so any transport instance can be supplied. Three candidates were evaluated.

`@ai-sdk/mcp`'s `Experimental_StdioMCPTransport` is disqualified: it exposes neither the child process nor its diagnostic stream, so the spec's stderr requirement is unimplementable with it. Its `stderr` option is typed to accept a `Stream`, which reads like an escape hatch, but Node rejects an in-memory stream as a `stdio` target — verified, `TypeError: The argument 'stdio' is invalid`. The remaining choices are `'inherit'` (leaks into llame's own diagnostics), `'ignore'` (no diagnostics at all), or a file on disk (an unsanitized secret sink). It also lacks the teardown escalation the shutdown requirement needs.

A llame-authored transport was the earlier recommendation and was rejected here on the original evaluation. It was costed as buying a bounded read buffer and process-group termination at the price of permanently diverging from upstream, with both gaps accepted instead — see the first two entries under Risks / Trade-offs as they stood at the time. The read-buffer half of that tradeoff is superseded by the revision above; process-group termination remains a real, accepted gap (see Risks / Trade-offs).

`@modelcontextprotocol/sdk`'s `StdioClientTransport` supplies what the specs require: a `stderr` accessor returning a stream created before `start()` so early output is not lost, a `pid` accessor, and a teardown ladder of `stdin.end()` → 2s → `SIGTERM` → 2s → `SIGKILL`. It is also what the AI SDK's own documentation recommends pairing with `createMCPClient`, and what Claude Code uses. One further difference matters for D2: the official transport merges as `{ ...getDefaultEnvironment(), ...serverParams.env }`, so a declared value overrides an inherited one, whereas `@ai-sdk/mcp`'s `getEnvironment` assigns the allowlist _after_ the caller's map and would silently clobber a declared `PATH`. Cost, as originally weighed here: promoting `@modelcontextprotocol/sdk` from a transitive `shadcn` dependency to a direct pinned dependency of `apps/api`, and two MCP implementations in one process. `BoundedStdioTransport` keeps both of those costs unchanged — it still depends on the same pinned package for its exported message/environment helpers and still coexists with `@ai-sdk/mcp` in the same process — and adds no third implementation; it replaces the SDK's `StdioClientTransport` class specifically, narrowly, for the one piece that needed a bound.

### D2: Declared environment only, over the SDK base allowlist — therefore no deny-list

The child environment is the declared `env` map merged over the SDK's base allowlist, which is what the official transport already produces when handed an `env` record. That allowlist is not zero: on POSIX the library copies `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, and `USER` from llame's own environment so a child can locate its executable. "Declared only" therefore means _beyond those six_ — llame adds no further ambient variable, so its datastore URL and provider keys never reach a child unless an entry names them.

The reason is mechanical, not a judgement about operator trust. The stderr requirement adds a channel that carries a child's output into operator-visible records. llame can only strip a value it resolved. A read-only Postgres MCP that fails to connect prints its connection string to its diagnostic stream — under ambient inheritance that value never passed through interpolation, is not in the protected set, and would be written out verbatim. Declared explicitly, the same value is protected and redacted from the same line.

The alternative — full `process.env` inheritance, as Claude Code does — is viable but strictly more machinery: it requires llame to override the transport default _and_ maintain a deny-list of its own secrets to be safe (Claude Code ships exactly such a list, opt-in, covering provider keys and cloud credentials). Explicit declaration is the library default and needs neither.

Accepted friction: `NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY`, `PLAYWRIGHT_BROWSERS_PATH` and similar each need a one-line declaration, and a config entry copied from a tool that inherits may need one added. Inheritance can be added later; removing it after operators depend on it cannot.

Consequence for the common docker idiom: `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN …` forwards the variable only because the entry also declares it in `env`. That is the documented shape, and it is what github-mcp-server's own README uses. No argument-sniffing rejection rule is needed.

### D2a: Interpolation marks a value as secret; literal text is never protected

Protected values are substring-matched across tool traffic, and `normalizeProtectedValues` filters only empty strings — no length or entropy floor. A low-entropy protected value is therefore actively harmful: `containsProtectedValueJson` refuses a whole tool call whose arguments contain it, and outbound sanitization rewrites it to `[REDACTED]` in results. Protect `/srv/data` and a filesystem server stops working on its own root.

Two rejected rules bracket the chosen one. Protecting every `args` value would break exactly that case, and would also protect `--headless`. Protecting no `args` value fails the many servers that accept credentials only as flags (`--api-key`, `--token`) and have no environment option at all.

The rule is therefore: the resolved value of each `{env:…}` / `{path:…}` token is protected, wherever it appears; literal text never is. `apps/api/AGENTS.md` already names these "secret interpolation", so the config language already carries the intent. The operator gets per-value control with no new configuration surface, and a remedy for the low-entropy case — write the value literally.

Only the substituted segment is protected, not the surrounding field, so `--auth "Bearer {env:TOKEN}"` contributes the token rather than the whole argument and still matches a server that echoes the bare secret. This requires the interpolation helper to report substituted values rather than only the resolved string.

Two accepted weaknesses, both documented rather than mitigated:

- A value that must vary per deployment but is not secret has no good option: interpolating it protects it and can break tool calls. Rare enough to document.
- A secret written literally instead of interpolated is not protected and would not be redacted from that server's diagnostics. The remote-header rule has no such gap, because it protects every header value regardless of origin. Closing it would mean protecting all `env` values in full, which reintroduces the low-entropy hazard for env-borne paths. Accepted: the configuration file is operator-owned and gitignored, so an inlined credential is already sitting in plaintext on that host, and the documentation says to always interpolate secrets.

### D3: Reuse the HTTP client's structure rather than generalizing it prematurely

`McpServerClient` is HTTP-shaped throughout its connect path but its post-connect half — discovery paging and budgets, declaration admission, executor wrapping, protected-value sanitization, failure classification — is transport-agnostic. The stdio path constructs its own transport and client, then joins that shared half. `declaration-admission.ts`, `protected-values.ts`, `tool-id.ts`, and `mcp-failure-policy.ts` are used unchanged.

`McpRuntimeService` keeps one record type for both transports. Its `McpRuntimeServerDefinition` becomes a discriminated union and its client factory dispatches on the discriminator. The lifecycle state machine, catalog publication, remembered-id retention, and refresh scheduling are shared.

Alternative considered: extract a transport-neutral base class first. Rejected — one additional transport does not justify the abstraction, and a second stdio-like transport is not on the roadmap.

### D4: Gate the protocol revision after connect

The HTTP path intercepts the `initialize` response inside the wrapped fetch. There is no equivalent interception point for stdio, but the AI SDK client writes the negotiated revision onto the transport instance after a successful handshake, so the stdio path reads it back from its own instance and closes the client if it falls outside llame's three revisions. This matters because the library's own supported set additionally includes `2024-11-05`, which llame excludes.

Confirmed under `tsgo` in task 1.4 and simpler than this document first assumed: `MCPTransport` itself declares `protocolVersion?: string`, so holding the instance at that type makes the gate a plain property read with no cast and no accessor type. Only the concrete class carries `stderr` and `pid`, so the client keeps a reference at each type.

### D5: Bounded retry for stdio, with recovery folded into the existing refresh tick

Today's reconnect is full-jitter backoff to a 5-minute cap with no attempt ceiling. That is correct for a socket and wrong for a spawn: a typo'd `command` or a missing image respawns forever.

An earlier draft proposed a fast-exit heuristic (child exits within N seconds, K times → terminal). Rejected in favour of the reference implementation's simpler shape: bound the attempts. Five attempts with 1s doubling, then settle as unavailable. Claude Code does not reconnect stdio servers at all, which works for a session-scoped tool with a manual retry button; llame runs for weeks with no such surface, so a settled server needs some path back.

**Recovery after settling: the periodic occasion is extended to settled stdio records.** An earlier version of D5 assumed the existing 48–72 minute catalog refresh would carry a cold retry for free. It would not: refresh is scheduled only while a server is _ready_ — the base requirement says "While ready, each instance-managed server SHALL undergo complete discovery periodically", and `scheduleRefresh` is called only immediately after `record.state = 'ready'` (`mcp-runtime.service.ts:271,336`). A settled server had no tick to ride, so as first written a stdio server that lost five attempts to a transient condition stayed unavailable until process restart.

The fix is to schedule the same periodic occasion for settled stdio records, with the tick attempting recovery rather than a refresh. One scheduler, one interval, one jitter policy — no second timer and no new state machine.

This was chosen over the two alternatives because the bounded fast retry is ~31 seconds, which expires faster than the failures that actually occur. A compose ordering race where llame reaches its first spawn before the docker socket or DNS is usable exhausts the budget and, without recovery, presents to an operator as "stdio MCP servers do not work in docker-compose" — a bug report resolved by a restart, which is the worst possible diagnostic signal. The same holds for a cold `npx` install on a slow link and for a server that dies at 3am. Dropping automatic recovery entirely (the reference implementation's behavior) only saves a handful of cheap failed spawns per hour on a genuinely misconfigured entry, and pays for that with a permanently degraded process; on an instance whose selling point is durable chat, "restart the API to recover one MCP server" also drops in-flight Runs.

**A budget only a stable session refunds.** Bounding the attempts is not enough on its own, because the counter was cleared the moment a record reached `ready`. A child that initializes, answers discovery, and _then_ exits therefore restarted the ladder every cycle, never reached the ceiling, and would have been respawned about once a second for as long as it stayed configured — the exact outcome this decision exists to prevent, reached by a route the attempt bound does not cover. The shape is ordinary: a container that exits when its stdin closes, a server that throws on the first unhandled rejection after startup.

Reaching `ready` now records _when_, and the refund is decided when the session ends. Past a stability threshold (60s, comfortably clear of the ~31s ladder) the budget comes back; inside it, the cycle costs budget like any other failure. That keeps the two cases apart without a second heuristic: a genuine blip after hours of health still gets the fast ladder, and a crash loop walks the budget down and settles onto the periodic occasion. Remote is untouched — its backoff is unbounded by design and any complete success still refunds it.

Accepted cost: recovery latency is the refresh interval, so worst case is ~72 minutes. That is poor for the boot-race case specifically — an hour without a server because of a five-second startup race. It is accepted for now because the alternative is a dedicated shorter-interval recovery timer, which is a second timer to reason about for a case that has not yet been observed in practice. If that latency proves unacceptable, the upgrade is one constant and a separate scheduling call, not a redesign.

Deliberately not introduced: a new `ToolUnavailableReason` variant. That vocabulary is model-facing and lands in persisted snapshots, so adding one is a wire-format change; the existing unavailable disclosure is sufficient and the configuration-versus-outage distinction belongs in operator logs.

HTTP reconnect is untouched. Two different policies is a wart, recorded as a follow-up rather than smuggled into this change.

### D6: Eager spawn, refresh by re-listing

Eager spawn at boot matches HTTP and is effectively forced: the availability manifest is authored at Run-accept from the process-local catalog, so a lazily-spawned server would be `unavailable` on a chat's first turn and healthy on its second. No in-place disable field is provided: the configuration file is JSONC and restart-applied, so commenting an entry out is behaviorally identical to marking it disabled, and llame has no runtime surface that would make the two differ. A disable field earns its place only alongside such a surface.

Refresh re-lists on the live child rather than recycling it; recycling would turn a routine refresh into a browser or container restart. The consequence is that a child lives for the whole process lifetime, so its memory and descriptor growth is llame's operational problem.

### D7: `type` is required, not inferred

Claude Code and VS Code both accept `{ command, args }` with no `type` and infer stdio. llame requires it. Inference needs `oneOf` discrimination on property presence, which fights the strict-closed, `required: ["type", …]`, `additionalProperties: false` style every other setting uses. An explicit `"stdio"` entry stays readable by the tools that infer, so portability is unharmed — the README's "`.mcp.json`-compatible" phrasing softens to "`.mcp.json`-shaped".

## Risks / Trade-offs

- **The pinned `@modelcontextprotocol/sdk`'s stdio `ReadBuffer` is unbounded** (`Buffer.concat` with no cap) → a server emitting a newline-less stream would grow llame's heap. This was initially accepted as a robustness concern against an operator-installed local process rather than an attacker, deferring the fix because it would cost a permanent fork of upstream — but "operator-installed" only narrows who can trigger it, not whether an ordinary bug (an unbuffered debug dump, a misconfigured logger writing to stdout instead of stderr) can still exhaust host memory. Revisited and closed: `mcp-stdio-transport.ts` now owns the child spawn and stdout read path directly rather than delegating that one piece to the SDK, and enforces the same 1 MiB pre-parse bound the remote transport already applies to a response body, per unterminated line. The SDK's own spawn options, base-environment allowlist, and close() escalation are transcribed verbatim, so this is a narrow, targeted divergence from upstream rather than a broad fork.
- **Termination reaches the direct child only** → `npx`, whose signal forwarding is unreliable, can orphan its descendants; combined with retry this could accumulate. Mitigated three ways: the retry budget is bounded (D5), `docker run` forwards signals to its container and a directly invoked binary is a single process, and documentation steers operators toward pinned binaries or `docker run --init --rm` over `npx`.
- **Child processes multiply with process count** → in a split topology every API and worker process holds one child per stdio server, including `web`-profile processes that never execute a tool. Not mechanized around (that would mean moving manifest authoring or building a supervisor); documented in `docs/scaling.md`.
- **Two MCP SDKs in one process** → version skew between the AI SDK client and the official transport could break the pairing on a future bump. Mitigated by pinning both and by the transport interface being small and stable; the AI SDK documents the combination. `BoundedStdioTransport` narrows this further for the exported functions it calls directly (`deserializeMessage`, `serializeMessage`, `getDefaultEnvironment` — a small, stable, public surface) but widens it for the transcribed behavior it does not call through the SDK at all: spawn options, the close() escalation ladder, and the stderr-PassThrough contract are copied, not imported, so an upstream behavior change there would silently stop being mirrored rather than fail loudly at a version bump. Mitigated the same way as the rest of this risk: both packages are pinned, and `mcp-stdio-server-client.test.ts`'s existing coverage (env allowlist, cwd, close ladder timing via task 2.7's analysis above) would need to be the thing that catches a transcription drift, since there is no compiler check for behavioral parity with an unexported implementation.
- **A stdio server is unsandboxed** → it runs as the llame user with llame's filesystem and network access. Not mitigated, and the operator-facing documentation says so plainly rather than implying a boundary that does not exist.
- **Stateful servers are shared across concurrent Runs** → one child per server per process means eight concurrent Runs drive one browser. Documented; per-Run instances would be a much larger design.
- **First launch can exceed the 30s connection deadline** → a cold `npx` install or a large image pull can outrun it, and a killed npm download leaves nothing cached, so the retry budget does not reliably converge. Not mitigated in code: a configurable deadline was considered and dropped as speculative configuration, since the operator remedy — pre-pull the image, pin and pre-install the package rather than `@latest` — is what the documentation recommends anyway and leaves the deployment better off. If a server with genuinely slow per-launch initialization appears, the knob can be added then; `connect()` and `discover()` already run on independent timers that merely share one constant, so splitting them later is a one-line change.

## Migration Plan

Additive and empty by default: an instance that configures no stdio entry behaves exactly as today. Configuration is restart-applied, like every other instance setting.

No new coordinated rollout section is needed. The existing MCP rollout contract already requires every API and worker process to share the same restarted configuration and secret inputs; a stdio entry adds the requirement that every such process can also execute the configured `command`, which matters when API and worker images differ.

Rollback is removing the entry and restarting, with the existing drain guidance for accepted Runs unchanged. No schema migration is involved.

## Open Questions

None blocking. Of the two implementation-time confirmations this document originally carried, the first is resolved: `StdioClientTransport` satisfies `MCPTransport` directly under `tsgo` despite `send`'s options parameter differing between the two interfaces, so no adapter is needed and D1's zero-custom-code conclusion holds (task 1.2). This finding is superseded by D1's revision above for the read-buffer piece specifically — `BoundedStdioTransport` replaces `StdioClientTransport` and deliberately does not nominally implement `MCPTransport` (its `JSONRPCMessage` type differs narrowly from the raw SDK's), relying on the same structural acceptance `createMCPClient` always gave `StdioClientTransport`. The finding stands as the reason no _adapter_ class was ever needed, which remains true. The second is now resolved too (task 2.7): it fits, and it does not scale with server count. `McpRuntimeService.shutdown` closes every client inside one `Promise.allSettled` raced against `SHUTDOWN_DEADLINE_MS`, so N servers tear down concurrently rather than in series. The worst case is therefore one ladder — `stdin.end()` + 2s + 2s = 4s — against a 5s budget, with `McpServerClient`'s own `CLOSE_DEADLINE_MS` also at 5s. No timing needed adjusting; had the closes been sequential, three stdio servers would have blown the budget. `BoundedStdioTransport` transcribes the same ladder, so this timing analysis is unchanged.
