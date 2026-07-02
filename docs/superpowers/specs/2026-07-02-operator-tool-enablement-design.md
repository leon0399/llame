# Operator tool enablement — make agent memory (and future non-safe tools) usable

## Objective

Close the gap flagged last iteration: `remember` (write_internal) is correctly
default-DENY, but there is NO operator control to enable it, so the memory
subsystem is dormant and unreachable. Give the operator a safe, instance-level
switch to enable non-safe built-in tools — `TOOLS_ENABLED` — composing with the
policy gate (deny still overrides per-scope). Setting `TOOLS_ENABLED=remember`
lights up agent memory.

## Why an instance config toggle, not a policy-authoring endpoint

A per-user policy-authoring API would let a user self-GRANT capabilities — a
privilege-management surface that, for a governance-first multi-tenant platform,
is genuinely a "who may grant what" design (escalation risk once a dangerous
tool exists). That deserves its own iteration. An **instance env toggle** is the
right minimal control now: it is the OPERATOR's single instance-wide decision
(like `OPENAI_API_KEY` or `RUN_MAX_STEPS`), no user self-service, no escalation
surface. Open WebUI uses exactly this shape (memory is a feature flag, on when
the operator enables it). It reuses the config resolver (#46) and composes with
the policy gate (#45) rather than adding a third availability mechanism.

## Design (v2 — read env DIRECTLY, not the merged config)

### Where the enabled set comes from — the security-critical choice

`TOOLS_ENABLED` (comma-separated tool names) is read **directly from env** via
`ConfigService`, at the gate, in `run-execution` — NOT routed through the config
resolver / merged snapshot. This is load-bearing (both reviewers): `configs_write`
RLS already lets a USER write their own user-scope config row, and the resolver
replaces arrays whole, so honoring a merged `tools.enabled` would let a user
self-enable a tool the operator never enabled — the exact self-grant this
design exists to avoid. Env is operator-only; a user cannot set it. So the
enabled set is instance-only by construction, no provenance-tagging needed.

Parsing: split on `,`, trim, drop empty entries → `Set`. An unrecognized/typo'd
name simply matches no tool (silent, fail-safe no-op — no operator-facing
validation; `TOOLS_ENABLED=remeber` just leaves memory off).

### Gate integration (compose with policy, don't bypass it)

In `run-execution.resolveToolVerdicts`, after each tool's policy verdict, apply
enablement as an **instance-scope allow that a policy deny still overrides**,
via the pure `applyEnablement(verdict, tool, enabledTools)`:

```
verdict = toolVerdict(policyDecision)          // 'allow' | 'deny' | 'unset'
if verdict === 'unset'
   && enabledTools.has(tool.name)
   && ENV_ENABLABLE_RISK_CLASSES.has(tool.riskClass):
    verdict = 'allow'
```

- A policy `'deny'` still wins (deny-overrides — enable instance-wide, deny one user).
- A policy `'allow'` is unchanged (an explicit grant needs no enablement).
- `'unset'` + enabled + env-enablable risk class → available; else falls to the
  safe allowlist (read-only tools), exactly as today.
- **Risk-class guard (verifier P1):** env enablement grants WITHOUT approval-
  gating (unlike a policy `allow`, which carries approval levels). So it is
  restricted to `read_only`/`compute_only`/`search_only`/`write_local`/
  `write_internal` — a `write_external`/`destructive` tool can NEVER be enabled
  by a bare env toggle; it requires an explicit policy `allow`. `remember`
  (`write_internal`) qualifies.

### Effect

`TOOLS_ENABLED=remember` → `remember` is available (deny-overridable). Memory is
operable, operator-controlled, fail-closed by default. `recall` is already
default-available (read-only); with `remember` enabled, the full memory loop
works.

## Testability

- Unit: `snapshotEnabledTools` parses the snapshot section (strings only,
  ignores junk); the instance layer maps `TOOLS_ENABLED` env → `config.tools.
  enabled`; `applyEnablement` — unset+enabled→allow, deny stays deny, allow
  stays allow, unset+not-enabled stays unset.
- Integration (real DB + policy engine): with `remember` in the enabled set,
  the resolved tool set for a user includes `remember`; a user-scope DENY
  policy on `remember` overrides the enablement (excluded). Extends the
  policy-gated integration suite.
- Existing suites green: `TOOLS_ENABLED` unset → no `tools` config → memory
  stays default-deny → today's behavior unchanged.

## Non-goals (named)

- A per-user/HTTP policy-authoring surface (the escalation-sensitive general
  case — its own iteration; the roadmap's "admin HTTP surfaces").
- Per-scope tool enablement UX beyond the config resolver's existing merge.
- Enabling any genuinely risky tool — the risk-class guard makes
  `write_external`/`destructive` STRUCTURALLY non-env-enablable (they require an
  explicit policy allow, which carries approval-gating). `TOOLS_ENABLED` is for
  low/own-scope tools only.
- Per-scope (user/chat/org) tool enablement — that requires a config/policy
  authoring surface with proper admin gating, its own iteration.

## Revision history

- **v2 (2026-07-02):** Round-1 review (verifier + adversarial, both
  not-converged, both landing the SAME P0). Fixes: **read `TOOLS_ENABLED` from
  env DIRECTLY, not the merged config snapshot** — `configs_write` RLS lets a
  user write their own user-scope config, so a merged `tools.enabled` would be a
  user self-grant (the v1 config-resolver approach was the escalation vector both
  reviewers found). Env is operator-only. Added the **risk-class guard**
  (verifier P1): env enablement grants without approval-gating, so it's
  restricted to low/own-scope risk classes — a `destructive`/`write_external`
  tool can't be env-enabled. Noted env-parse fail-safe (unknown name = no-op).
  Deny-overrides + explicit-allow composition confirmed correct by both.
  Implementation built to v2; helpers unit-tested (parse + the 3-way + guard).
- **v1 (2026-07-02):** Initial.
