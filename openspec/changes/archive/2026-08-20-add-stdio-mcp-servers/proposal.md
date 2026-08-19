## Why

Operator-configured MCP tools ship today over Streamable HTTP only, so every MCP server llame can use must already expose an HTTP endpoint. A large part of the ecosystem — including an operator's own local scripts and most community filesystem, sqlite, and notes servers — ships stdio only. Reaching those today means running and supervising a bridge process (`mcpo`, `supergateway`) per server, which is supervision cost multiplied by server count for no capability gain.

stdio is currently a documented refusal rather than an unimplemented feature: the spec rejects it at schema validation, and SPEC/VISION list it as a deliberate deferral. This change reverses that decision for the self-hosted, admin-configured deployment llame targets, where the operator already has server access and authors the config file by hand.

## What Changes

- `mcpServers` entries accept a second transport variant, `{ type: "stdio", command, args?, env?, cwd? }`, alongside today's `http` / `streamable-http` entries. `type` stays explicit and the entry stays strict-closed.
- `{env:…}` / `{path:…}` interpolation becomes valid in `command`, `args[]`, and `env` values. No `${VAR}` alias is introduced — the file keeps one interpolation syntax.
- The child environment is **exactly** the declared `env` map merged over the MCP SDK's small fixed base allowlist (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER` on POSIX, which the library copies so a child can find its executable). Beyond those six, llame passes none of its own environment through, so a credential llame holds does not reach a child unless the entry declares it. This is what keeps redaction possible: only values llame resolved can be stripped from a server's diagnostic output.
- The resolved value of every `{env:…}` / `{path:…}` token in `command`, `args`, or `env` joins the protected-value set; literal text does not. Interpolation is how an operator declares a value sensitive. This deliberately differs from the header rule, which protects every value regardless of origin — args and env legitimately carry flags and paths, and protected values are substring-matched across tool traffic.
- A stdio server's `stderr` is captured, bounded, sanitized against protected values, and logged with its server id — never inherited into llame's own stderr.
- A stdio server that fails to start or dies is retried a bounded number of times and then settles as unavailable, with one cold retry riding the existing catalog-refresh tick. Shipped HTTP reconnect behavior is unchanged.
- The negotiated protocol revision is gated after connect, so a stdio server negotiating a revision llame excludes stays unavailable rather than being used.
- `@modelcontextprotocol/sdk` becomes a direct, pinned runtime dependency of `apps/api` for its `StdioClientTransport`, passed to the existing AI SDK client as a custom transport instance.
- Documented refusals are reversed in `openspec/specs/mcp-tools/spec.md`, `SPEC.md`, `VISION.md`, `llame.config.schema.json`, `config-loader.test.ts`, `docs/mcp-tools.md`, `apps/api/AGENTS.md`, `README.md`, and `CHANGELOG.md`.

Not changing: the authorization model. Tool ids, the exact/wildcard allowlist, drift handling, receipts, snapshots, and the operator read-only attestation are transport-independent and stay as they are. Write, send, delete, execute, financial, and administrative MCP tools remain prohibited. No policy or capability engine arrives with this change (#133 is untouched).

## Capabilities

### New Capabilities

None. This extends two shipped capabilities rather than introducing one.

### Modified Capabilities

- `mcp-tools`: the transport requirement stops excluding stdio and gains stdio's process lifecycle (spawn, bounded retry, teardown), its diagnostic-output handling, and its secret sources.
- `instance-config`: the `mcpServers` entry shape becomes a `type`-discriminated union with a stdio variant, and interpolation extends to the new fields.
- `tool-calling`: the requirement governing what an MCP tool may reach describes only remote execution and operator-configured headers, so it is generalized to both transports — including that a local server runs with the llame process's own host privileges.

## Impact

- **`apps/api/src/mcp/`** — a stdio client path alongside `mcp-server-client.ts`'s HTTP path, reusing `declaration-admission`, `protected-values`, `tool-id`, and `mcp-failure-policy` unchanged. `mcp-runtime.service.ts` gains the stdio lifecycle and bounded-retry states.
- **`apps/api/src/instance-config/`** — `llame-config.ts` types, `llame.config.schema.json`, and `config-loader.ts` validation and interpolation.
- **Dependencies** — `@modelcontextprotocol/sdk` promoted from a transitive `shadcn` dependency to a direct pinned dependency of `apps/api`.
- **Operational surface** — an instance now spawns and supervises child processes. In the default co-located topology that is one child per configured stdio server; in a split topology every API and worker process holds its own, including `web`-profile processes, because the API needs a live catalog to author a Run's availability manifest. This is documented in `docs/scaling.md`, not mechanized around.
- **Accepted limitations, documented rather than solved** — the MCP SDK's read buffer is unbounded, and teardown signals the direct child only, so a `command` that spawns a process tree (notably `npx`) can orphan descendants; documentation steers operators toward pinned binaries or `docker run --init --rm`. stdio is unsupported on Windows.
- **Security posture** — a configured stdio server executes on the llame host as the llame user, with llame's filesystem and network access. There is no sandbox. Configuring one is a trust decision equivalent to installing software on that host, and the documentation says so plainly.
- **Provenance** — `docs/research/tool-harness/2026-08-12-mcp-stdio.md`.
