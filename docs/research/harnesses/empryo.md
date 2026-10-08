---
type: Reference
title: "Empryo (SoulForge)"
description: "Single-user graph-powered terminal and desktop coding agent whose public core carries a chat-surface daemon with pairing codes, deny-first approval policy and peer-uid socket auth."
tags: [harness, coding-agent, bun, approvals, messaging-surfaces]
status: draft
resource: "https://github.com/proxysoul/empryo/tree/28802a4f169abcc378032e0a4774bc162c12a00c"
generated:
  by: "claude-code/claude-opus-5-5"
  at: "2026-10-08"
observed:
  date: "2026-10-08"
  revision: "28802a4f169abcc378032e0a4774bc162c12a00c"
sources:
  - id: readme-license-l85-l95
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/README.md#L85-L95"
    title: "Public core versus private v3, and v3 usage terms"
  - id: license-l1-l20
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/LICENSE#L1-L20"
    title: "Business Source License 1.1 parameters"
  - id: hearth-daemon-l1-l10
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/daemon.ts#L1-L10"
    title: "HearthDaemon responsibilities"
  - id: hearth-types-l21-l43
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/types.ts#L21-L43"
    title: "ChatBinding and per-surface allowed identities"
  - id: hearth-pairing-l25-l88
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/pairing.ts#L25-L88"
    title: "Pairing registry: one-shot codes, TTL, lockout"
  - id: hearth-policy-l25-l66
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/policy.ts#L25-L66"
    title: "Deny-first glob policy over a normalized tool signature"
  - id: hearth-approvals-l13-l47
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/approvals.ts#L13-L47"
    title: "Pending-approval registry with a hard cap"
  - id: hearth-peer-auth-l1-l18
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/peer-auth.ts#L1-L18"
    title: "Unix-socket peer uid check, fail-open on quirks"
  - id: coordinator-l11-l67
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/core/coordination/WorkspaceCoordinator.ts#L11-L67"
    title: "Advisory per-path claims with idle and stale release"
  - id: session-save-l63-l131
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/core/sessions/manager.ts#L63-L131"
    title: "Serialized full-rewrite session save across two files"
  - id: working-state-l13-l25
    resource: "https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/core/compaction/working-state.ts#L13-L25"
    title: "Structured working state for compaction"
---

# Empryo (SoulForge)

- **Stack:** Bun, TypeScript, OpenTUI, Vercel AI SDK, SQLite; BUSL-1.1 public core (Apache-2.0 no later than 2030-03-15), proprietary v3 terms[^readme-license-l85-l95][^license-l1-l20]

**Status:** Source inspection only; nothing was run. The repository is the public
SoulForge v2 core and engine, not the current Empryo v3 product, so this
describes a superseded snapshot.[^readme-license-l85-l95] It is a single-user,
single-process coding agent with no tenant model, no queue and no
database-level isolation. Its value to llame is a handful of narrow mechanisms
in the `hearth` chat-surface daemon and the approval layer. Moderate confidence
that none should be adopted as code: the license forbids commercial embedding,
and the mechanisms are small enough to restate.

**Study**

1. **Chat-surface binding.** `HearthDaemon` owns a Unix permission socket,
   routes inbound Telegram and Discord messages to a per-chat workspace and
   resolves tool approvals through policy or a surface prompt.[^hearth-daemon-l1-l10]
   Each external chat resolves to a `ChatBinding` carrying `cwd`, mode,
   `autoApprove`, `autoDeny`, an extra read denylist, a daily token budget and
   a tab cap, and each surface holds an `allowed` identity list.[^hearth-types-l21-l43]
   The per-chat budget and tool-rule set are a concrete shape for llame's
   future channel adapters. Identity there is a config file, where llame
   needs authenticated tenant identity.
2. **Pairing.** A 6-character code from `randomBytes` over an alphabet without
   `0/O/I/1`, bound to a surface and external chat, single use, with a TTL and a
   5-failure, 10-minute lockout per surface and chat.[^hearth-pairing-l25-l88] The
   registry is an in-memory `Map`, so a restart drops outstanding codes and
   lockouts; llame would need these rows in RLS-governed storage.
3. **Approval policy.** Rules match `toolName(firstStringArg)` with whitespace
   collapsed, deny rules run before allow rules, and no match means ask.[^hearth-policy-l25-l66]
   The normalization exists because a doubled space would otherwise slip past
   a `git push --force*` rule. The signature uses only the first string
   argument, so a rule cannot constrain a second argument such as `cwd`.
4. **Approval backpressure.** Pending approvals are capped at 256 and overflow
   denies the new request instead of evicting older waiters; each approval
   resolves at most once.[^hearth-approvals-l13-l47] The map is process memory, so a
   restart loses every pending approval, which llame's durable Runs must not.
5. **Local-socket hardening.** The socket is `0600` and additionally checks the
   peer effective uid through `SO_PEERCRED` or `getpeereid`.[^hearth-peer-auth-l1-l18]
   The module fails open on some platform quirks and names socket permissions
   as the primary defense, so the uid check is defense in depth only.
6. **Parallel-agent coordination.** An advisory per-path claim table releases
   claims 5 s after a tab goes idle and after 5 min regardless, and sweeps leaked
   agents at 15 min.[^coordinator-l11-l67] Advisory claims admit lost updates;
   llame's native `write` uses durable mutation fencing instead.
7. **Context shaping.** Compaction keeps a structured working state (task, plan,
   files, decisions, failures, discoveries, environment, user requirements)
   rather than a free-text summary.[^working-state-l13-l25] The field set is a
   usable checklist for what llame's compaction prefix should preserve.

**llame fit**

- Moderate: items 2 and 4 as design input for channel adapters, once llame has them.
- Low: item 6; llame has mutation fencing and permission groups already.
- None: persistence and execution. Sessions are rewritten whole to
  `meta.json` and `messages.jsonl` through two renames under a per-session
  promise chain, added after a documented interleaving bug.[^session-save-l63-l131]
  There is no resumable stream, no job queue and no tenant boundary.

**Caution:** BUSL-1.1 does not allow offering the work on a paid, hosted or
embedded basis, and the v3 license adds a broader ban on third-party access
through a commercial product.[^license-l1-l20] Treat the code as read-only
reference. The README benchmarks are vendor claims and were not reproduced.

[^readme-license-l85-l95]: [Public core versus private v3, and v3 usage terms](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/README.md#L85-L95)

[^license-l1-l20]: [Business Source License 1.1 parameters](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/LICENSE#L1-L20)

[^hearth-daemon-l1-l10]: [HearthDaemon responsibilities](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/daemon.ts#L1-L10)

[^hearth-types-l21-l43]: [ChatBinding and per-surface allowed identities](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/types.ts#L21-L43)

[^hearth-pairing-l25-l88]: [Pairing registry: one-shot codes, TTL, lockout](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/pairing.ts#L25-L88)

[^hearth-policy-l25-l66]: [Deny-first glob policy over a normalized tool signature](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/policy.ts#L25-L66)

[^hearth-approvals-l13-l47]: [Pending-approval registry with a hard cap](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/approvals.ts#L13-L47)

[^hearth-peer-auth-l1-l18]: [Unix-socket peer uid check, fail-open on quirks](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/hearth/peer-auth.ts#L1-L18)

[^coordinator-l11-l67]: [Advisory per-path claims with idle and stale release](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/core/coordination/WorkspaceCoordinator.ts#L11-L67)

[^session-save-l63-l131]: [Serialized full-rewrite session save across two files](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/core/sessions/manager.ts#L63-L131)

[^working-state-l13-l25]: [Structured working state for compaction](https://github.com/proxysoul/empryo/blob/28802a4f169abcc378032e0a4774bc162c12a00c/src/core/compaction/working-state.ts#L13-L25)
