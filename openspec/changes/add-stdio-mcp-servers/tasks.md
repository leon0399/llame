## 0. Stack shape

This change ships as a stack of four implementation PRs on top of the planning commits already on `feature/mcp-stdio`. Read bottom to top; each layer merges before the one above it.

```
(master) <- planning <- client <- runtime <- config <- docs
```

| layer      | concern                                                   | reachable by an operator?                     |
| ---------- | --------------------------------------------------------- | --------------------------------------------- |
| `planning` | research doc + this OpenSpec change (already committed)   | no                                            |
| `client`   | the stdio MCP client module and its unit tests            | no — nothing constructs it                    |
| `runtime`  | lifecycle, bounded retry, shutdown                        | no — no config can express a stdio server yet |
| `config`   | schema, types, loader, interpolation                      | **yes — this layer opens the surface**        |
| `docs`     | operator docs, refusal reversals, e2e, final verification | yes                                           |

**Why config is near the top rather than the bottom.** It is the only layer that changes what an operator can write. Landing it first would accept a `type: "stdio"` entry that the runtime would then hand to an HTTP client factory as `{ url: undefined }`. Ordering it above `runtime` means the surface opens exactly when the machinery behind it is complete, with no compatibility shim to add and later delete.

Each layer must be independently mergeable: green tests, no dead references, no half-open surface.

## 1. Layer `client` — stdio MCP client

Depends on: nothing. Merges as a fully tested, unwired module.

- [ ] 1.1 Add `@modelcontextprotocol/sdk` to `pnpm-workspace.yaml`'s catalog at the version already resolved in the lockfile, and depend on it from `apps/api/package.json` via `catalog:`
- [ ] 1.2 Confirm `StdioClientTransport` satisfies the AI SDK's `MCPTransport` under `pnpm --filter api typecheck` (the `send` options parameter differs between the two interfaces); if it does not, write the minimal adapter and record why in `design.md` D1
- [ ] 1.3 Confirm the transport's `stdin.end()` → 2s → SIGTERM → 2s → SIGKILL ladder fits `SHUTDOWN_DEADLINE_MS` with several servers closing concurrently; if it does not, adjust the shutdown budget and note it in `design.md` D1
- [ ] 1.4 Declare the narrow structural accessor type for reading the negotiated `protocolVersion` off a transport instance (no `as unknown as T`, #268)
- [ ] 1.5 Add a stdio fixture MCP server as a plain `.mjs` script next to `mcp-test-fixture.ts` — it is spawned by a bare `node`, so it cannot be `.ts` (vitest compiles through swc in-process, the child does not)
- [ ] 1.6 Add failing tests for a stdio client against that fixture: connect, discover, execute a tool, and close
- [ ] 1.7 Add failing tests for the child environment, seeding the parent env explicitly rather than assuming it: a defined base-allowlist variable (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`) IS inherited when undeclared; an allowlist variable the parent does not define is absent rather than synthesized; a declared value overrides an inherited one; and a variable outside that allowlist (assert with a real llame credential name such as `POSTGRES_URL`) is absent from the child unless declared
- [ ] 1.8 Add failing tests that, **given a protected-value set**, the client sanitizes those values out of tool results and errors and refuses a call whose arguments contain one — the derivation of that set from interpolation belongs to the `config` layer
- [ ] 1.9 Add failing tests for diagnostic capture: output written before initialization is retained, a protected value written to the child's diagnostic stream is redacted (including when split across two stream chunks), a non-protected value is not redacted, and retention is bounded. `apps/api/src/mcp/` has no logger today, so this is the module's first operator-facing diagnostic — use the repo's NestJS `new Logger(ClassName.name)` convention rather than inventing a channel
- [ ] 1.10 Add a failing test that a server negotiating `2024-11-05` (inside the library's supported set, outside llame's) becomes unavailable with the protocol-unsupported reason and its child is stopped
- [ ] 1.11 Add a failing test that the post-parse discovery limits still bound a stdio server (tool count, per-declaration size, schema depth, retained catalog, page count, deadline) even though the pre-parse byte bound does not apply
- [ ] 1.12 Add a failing regression test that shell metacharacters in `command` and `args` stay literal — no expansion, substitution, redirection, or chained command — since non-shell execution is a stated security property with no other guard
- [ ] 1.13 Implement the stdio client: construct `StdioClientTransport` with `command`/`args`/`env`/`cwd` and `stderr: 'pipe'`, attach the bounded sanitized diagnostic reader before `start()`, pass the instance to `createMCPClient`, gate the negotiated revision after connect
- [ ] 1.14 Join the shared post-connect half unchanged — `declaration-admission`, `protected-values`, `tool-id`, `mcp-failure-policy`, discovery paging and budgets, executor wrapping
- [ ] 1.15 Layer gate: `pnpm --filter api test`, `lint`, and `typecheck` pass

## 2. Layer `runtime` — lifecycle, retry, shutdown

Depends on: `client`. Still unreachable from configuration — tests construct stdio definitions directly.

- [ ] 2.1 **Blocked on a decision (design.md D5):** settled stdio servers currently have no recovery trigger, because the catalog refresh is scheduled only for _ready_ servers. Choose between extending the existing refresher to settled records, dropping automatic cold recovery, or adding a separate recovery timer — then rewrite the stdio retry requirement in `specs/mcp-tools/spec.md` to match before implementing anything else in this layer
- [ ] 2.2 Add failing tests for bounded retry: repeated launch failure settles as unavailable after the attempt budget; a settled server recovers by whichever trigger 2.1 selects; a connected child exiting withdraws tools immediately while retaining remembered exact ids
- [ ] 2.3 Add a failing test that remote reconnect behavior is unchanged by this change
- [ ] 2.4 Make `McpRuntimeServerDefinition` a discriminated union and dispatch the client factory on it, keeping one record type, state machine, catalog publication, and refresh scheduler for both transports
- [ ] 2.5 Implement bounded retry (5 attempts, 1s doubling) settling to the existing unavailable disclosure with no new `ToolUnavailableReason`, plus the recovery trigger from 2.1 — stdio only
- [ ] 2.6 Ensure shutdown stops every launched child within the bounded deadline and that an unresponsive server cannot delay it
- [ ] 2.7 Layer gate: `pnpm --filter api test` and `test:integration` pass; remote-transport suites unchanged

## 3. Layer `config` — the operator surface

Depends on: `runtime`. **Merging this layer makes stdio configurable**, so nothing here may land before the two layers below.

- [ ] 3.1 Add failing `config-loader` tests for the stdio variant: a minimal entry loads; `type` is required; `command` must be non-empty; `args` elements must be strings; `env` names must be non-empty; unknown fields fail; a remote field on a stdio entry fails and a stdio field on a remote entry fails; `cwd` loads
- [ ] 3.2 Add failing tests for interpolation in `command`, `args[]`, and `env` values, including that `${…}` stays literal text and that a failed interpolation names the path without printing any resolved or partial value
- [ ] 3.3 Add a failing test that server-name rules (1–56 chars, no `__`, unique key) apply identically to a stdio entry
- [ ] 3.4 Replace the `config-loader.test.ts` case asserting stdio is rejected with one asserting legacy SSE and unknown `type` values are still rejected
- [ ] 3.5 Extend the interpolation helper to report each substituted token's resolved value, not only the resolved string, so a partially interpolated field contributes the secret rather than the whole field
- [ ] 3.6 Add failing tests for the protected-value derivation across all three fields: an interpolated secret in `command`, `args`, or `env` enters the protected-value set; literal text in each of those three fields does not; a field mixing literal text with a token contributes only the token's resolved value
- [ ] 3.7 Make `McpServerConfig` in `llame-config.ts` a `type`-discriminated union with the stdio variant
- [ ] 3.8 Extend `llame.config.schema.json`: add the `mcpStdioServerEntry` definition, discriminate `mcpServers` entries on `type`, and rewrite the `type` description that currently asserts no stdio
- [ ] 3.9 Wire stdio-field interpolation and validation through `config-loader.ts`, and map a stdio entry to its runtime definition in `mcp-runtime.module.ts`, so the tests from 3.1–3.6 pass
- [ ] 3.10 Add an integration test spanning the seam this stack deliberately split: a configured stdio entry whose interpolated secret is redacted from that server's diagnostic output and from a tool result
- [ ] 3.11 Layer gate: `pnpm --filter api test` and `test:integration` pass

## 4. Layer `docs` — operator documentation, refusal reversals, acceptance

Depends on: `config`. Different reviewer audience; no production code.

- [ ] 4.1 `docs/mcp-tools.md`: retitle away from "Remote MCP tools", add a stdio configuration section with the `env`-declaration idiom for `docker run -e VAR`, document the explicit-environment rule and why it exists, the diagnostic-output policy, the interpolation-marks-a-secret rule with both of its documented consequences (a low-entropy interpolated value can refuse tool calls and redact results; an inlined literal secret is not protected), bounded retry, the pinned-version guidance over `npx @latest`, the unsandboxed-execution warning, and the tree-termination limitation; update the two no-stdio statements and the protocol troubleshooting row
- [ ] 4.2 `docs/scaling.md`: record that every process holding an MCP catalog — including `web`-profile API processes — runs one child process per configured stdio server
- [ ] 4.3 `SPEC.md` §99: replace "stdio do not ship" with the shipped two-transport statement
- [ ] 4.4 `VISION.md:156`: remove local stdio MCP processes from the deliberate deferrals
- [ ] 4.5 `apps/api/AGENTS.md`: extend the Remote MCP tools section with the stdio entry shape, the explicit-environment rule, and the retry difference from HTTP
- [ ] 4.6 `README.md`: document the stdio entry alongside the remote one and soften "`.mcp.json`-compatible" to "`.mcp.json`-shaped"
- [ ] 4.7 `CHANGELOG.md`: add the dated entry
- [ ] 4.8 `apps/api/llame.config.json.example`: add a commented stdio entry
- [ ] 4.9 Add a stdio fixture MCP server script under `e2e/support/`, alongside the existing HTTP fixture rather than replacing it
- [ ] 4.10 Add an E2E case configuring the stdio fixture in `llame.config.e2e.json`, allowlisting one of its tools, and driving a Run that executes it
- [ ] 4.11 Add an integration case proving a stdio server's failure isolates to its own tools, leaving native tools and answer-only Runs working
- [ ] 4.12 Final gate: `pnpm --filter api test` and `test:integration`; `pnpm --filter api lint`, `typecheck`, and `pnpm format:check`; `pnpm test:e2e -- e2e/web/chat/mcp-tool.spec.ts` for both transports; `openspec validate add-stdio-mcp-servers --strict`
- [ ] 4.13 Manually verify one real stdio server end to end — configure it, allowlist one read-only tool, execute it in a chat, confirm history replay, and confirm no declared secret appears in logs, run events, or the receipt
