---
type: Reference
title: "Happy"
description: "MIT mobile, web, and legacy CLI clients plus a relay, with encrypted session bodies and the desktop harness in a separate repository."
resource: "https://github.com/slopus/happy/tree/10c605bfdb22c0889c79df7c20982bc2da931e9d"
tags: [harness, mobile, relay, encryption, peer-executor]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "10c605bfdb22c0889c79df7c20982bc2da931e9d"
sources:
  - id: happy-license
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/LICENSE#L1-L3"
    title: "MIT License heading"
  - id: happy-split
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/README.md#L42-L55"
    title: "This repo is the mobile app, original CLI, and relay; desktop is separate"
  - id: happy-agent-line
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/README.md#L69"
    title: "happy-agent in this repo is remote session control, not the Happy Agent runtime"
  - id: happy-cli
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/README.md#L50-L64"
    title: "happy claude and happy codex; multi-model work points at the desktop app"
  - id: happy-wire
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-wire/README.md#L7-L9"
    title: "Legacy and new payloads travel inside encrypted session messages"
  - id: happy-forward
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-server/sources/app/api/socket/sessionSubscribeHandler.spec.ts#L190-L192"
    title: "The socket test forwards an encrypted content container"
  - id: happy-vendor
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-server/sources/app/api/routes/connectRoutes.ts#L291"
    title: "The server decrypts a stored vendor token"
  - id: happy-sandbox-default
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-cli/src/persistence.ts#L18-L19"
    title: "Sandbox enabled defaults to false"
  - id: happy-sandbox-bypass
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-cli/src/claude/utils/permissionMode.ts#L120-L131"
    title: "An enabled sandbox forces bypassPermissions"
  - id: happy-run-claude
    resource: "https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-cli/src/claude/runClaude.ts#L104-L114"
    title: "runClaude skips Claude permission prompts when the sandbox is on"
---

# Happy

- **Stack:** This repository is the Expo mobile and web client, the original CLI, and the relay (`happy-server`, `happy-wire`). MIT.[^happy-license] Desktop and the Happy Agent runtime are other repositories, named in the README and not cloned here.[^happy-split] The [tierroom board](https://my-tierroom.party/agents/happy) and [happy.engineering](https://happy.engineering/) are live pages and are not pinned.

Happy continues coding-agent sessions from a phone. The original CLI wraps Claude Code and Codex (`happy claude`, `happy codex`). The README sends multi-model sessions and teams to the desktop app.[^happy-cli] Source inspection of this repo only; nothing was run. Board claims about the desktop harness, subagents, and team servers are about code that is not in this tree.

**Study**

1. **The phone is a client of a session the CLI already started.** `happy-app` is the mobile and web client. `happy-cli` is the original terminal wrapper. `happy-agent` in this repo is remote session control for that CLI, and the README says it is not the Happy Agent runtime.[^happy-agent-line] The repo table points the desktop runtime at `slopus/happy-agent`.[^happy-split] Execution stays with the coding CLI on the machine that launched it. That is the [Surface versus executor](../../../VISION.md#local-capability-is-not-a-thin-client) split, for a product whose first-party terminal is a wrapper rather than the owner of the run log.
2. **Session bodies on the wire are encrypted containers.** `happy-wire` says both legacy and new formats travel inside encrypted session messages.[^happy-wire] A server test has the phone emit `message: 'ciphertext'`. The daemon is expected to see that string wrapped as `{ t: 'encrypted', c: 'ciphertext' }`.[^happy-forward] The same server decrypts stored vendor tokens with `decryptString` on a path under the user id.[^happy-vendor] Encryption of the session body and server-held vendor tokens are different stores.
3. **Turning the CLI sandbox on forces Claude prompts off.** `SandboxConfigSchema.enabled` defaults to false.[^happy-sandbox-default] `applySandboxPermissionPolicy` returns `bypassPermissions` whenever the sandbox is enabled.[^happy-sandbox-bypass] `runClaude` then sets `dangerouslySkipPermissions` when that mode is bypass or yolo, when the sandbox is enabled, or when the argv already contains `--dangerously-skip-permissions`.[^happy-run-claude] The board's "sandboxed actions" line does not say this. The desktop harness in `slopus/happy-desktop` was not cloned.[^happy-split]

**llame fit**

- Moderate: item 1, as a remote steering client. llame's Android horizon is a local-capable surface plus remote steering, and it is [later than the Node](../../../ROADMAP.md#after-personal-synchronization). Happy's CLI does not become that Node: it wraps a peer CLI.
- Moderate: item 2's choice to forward ciphertext session bodies. Vendor-token decryption on the server is the limit of that claim.
- Low: the legacy CLI's `happy claude` / `happy codex` entrypoints, until the desktop tree is read.
- Avoid: item 3 as a confinement pattern. A sandbox flag that also sets `bypassPermissions` drops the peer's own approval prompts. llame's [sandbox failure must not become native execution](../../../VISION.md#execution-follows-intent-and-capability), and a sandbox that disables the ask is a different hole.

**Caution:** `HANDY_MASTER_SECRET` is named in the server package notes as the master secret for auth and encryption. This pass did not trace which session fields that key can open. The original CLI is the terminal in this repo; the README treats the desktop app as where new multi-model work goes.[^happy-cli] The `@anthropic-ai/sandbox-runtime` package itself was not read.

[^happy-license]: [MIT License heading](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/LICENSE#L1-L3)

[^happy-split]: [This repo is the mobile app, original CLI, and relay; desktop is separate](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/README.md#L42-L55)

[^happy-agent-line]: [happy-agent in this repo is remote session control, not the Happy Agent runtime](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/README.md#L69)

[^happy-cli]: [happy claude and happy codex; multi-model work points at the desktop app](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/README.md#L50-L64)

[^happy-wire]: [Legacy and new payloads travel inside encrypted session messages](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-wire/README.md#L7-L9)

[^happy-forward]: [The socket test forwards an encrypted content container](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-server/sources/app/api/socket/sessionSubscribeHandler.spec.ts#L190-L192)

[^happy-vendor]: [The server decrypts a stored vendor token](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-server/sources/app/api/routes/connectRoutes.ts#L291)

[^happy-sandbox-default]: [Sandbox enabled defaults to false](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-cli/src/persistence.ts#L18-L19)

[^happy-sandbox-bypass]: [An enabled sandbox forces bypassPermissions](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-cli/src/claude/utils/permissionMode.ts#L120-L131)

[^happy-run-claude]: [runClaude skips Claude permission prompts when the sandbox is on](https://github.com/slopus/happy/blob/10c605bfdb22c0889c79df7c20982bc2da931e9d/packages/happy-cli/src/claude/runClaude.ts#L104-L114)
