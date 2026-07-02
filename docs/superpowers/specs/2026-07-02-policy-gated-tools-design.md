# Policy-gated tool availability — wiring #45 into the tool loop

## Objective

Make roadmap guiding principle #3 real for tools: **"a tool is available only
if effective policy allows it; deny overrides allow."** Today the tool
pre-filter consults only a hardcoded `SAFE_BUILTIN_TOOL_NAMES` allowlist; the
v0.3 policy engine (#45, `PolicyService`) — built explicitly to gate "every
tool/connector/model as those capabilities land" (its own docstring) — is never
called. This connects them: an admin can now DENY a tool (even a safe one) or
ALLOW a non-safe one, per user/chat scope, with each decision audited.

This is integration, not a new subsystem: no new storage, reuses `PolicyService`
+ the existing pre-filter seam.

## Design

### Three-way pre-filter (was: boolean allowlist-or-policy)

`resolveAvailableTools(candidates, decide)` where `decide(tool) →
'allow' | 'deny' | 'unset'`:

- `'deny'`  → excluded. **Deny overrides everything**, including the safe
  allowlist (an admin can revoke `get_current_time`).
- `'allow'` → included, even a non-safe tool (explicit grant).
- `'unset'` → fall back to `SAFE_BUILTIN_TOOL_NAMES` (today's default). No
  policy configured ⇒ safe tools available, exactly as now.

`decide` defaults to `() => 'unset'` so callers that omit it get today's
safe-allowlist behavior. NOTE: the change from `boolean` to the 3-way union IS
a behavior change (deny can now override the safe allowlist), so the existing
`tools.spec.ts` assertions that passed boolean callbacks and asserted "safe
tools always win" must be rewritten to the verdict enum — a guard site the
implementation must touch, not a free default.

### Mapping a PolicyDecision → decide (in run-execution, before the stream)

For each `BUILTIN_TOOLS` entry, `PolicyService.checkWithin(tx, { userId,
chatId, action: 'tool.invoke', resourceType: 'tool', resourceId: tool.name })`
returns `{ effect, approval, matched }`. Map:

| effect | approval | matched has deny | → decide |
|--------|----------|------------------|----------|
| allow  | null / `auto_allow_readonly` / `auto_allow_low_risk` | — | **allow** — these are allows that NEVER ask (rank 1–2); honor the grant |
| allow  | `ask_once_*` / `always_ask` / `admin_only` (rank ≥ 3) | — | **deny** — demands human approval, but no approval FLOW exists yet → fail closed |
| deny   | —        | yes              | deny (explicit) |
| deny   | —        | no (default deny)| unset (→ safe allowlist) |

The approval split is load-bearing (both reviewers): `auto_allow_*` are NOT
"approval demanded" — collapsing all non-null approvals to deny would silently
drop an admin's explicit low-friction grant. `requiresHumanApproval(approval)`
(exported from `policy-eval.ts`, threshold `rank ≥ ask_once_per_project`) is the
single source of truth.

Distinguishing explicit deny from default-deny: `effect==='deny'` with a
`matched` entry whose `effect==='deny'` is a real deny; `matched` empty is the
engine's default-deny (no policy) → `unset`.

**Error contract (fail closed):** if `checkWithin` throws (DB error/timeout),
the gate maps EVERY tool to `'deny'` for that turn (→ empty tool set, the turn
completes answer-only). It must NEVER catch-and-default-to-`'unset'` — that
would silently un-revoke a deny on a safe built-in. Deny-on-error is strictly
more restrictive, never less.

### Where & when

Computed ONCE per turn, BEFORE `streamText`, inside a single `runAs`
transaction (the checks are the only mid-turn policy DB work; there is none
mid-STREAM — consistent with the earlier "resolve tools before the stream, not
per-call" decision that keeps the process's single Postgres connection free
during generation). `checkWithin` audits each decision in that transaction —
the intended governance trace ("what tools were available and why", per
agents-best-practices observability). N checks per turn (N = built-in count,
currently 2); a batch evaluator that fetches the scope policies once is the
scale follow-up, noted not built.

### Scope

Pass `userId` + `chatId`, not `orgUnitId`. The precise invariant (adversarial
review — the earlier "chats have no org context" was imprecise): user→org
MEMBERSHIP already exists and is already wired through `PolicyService.checkWithin`
via `orgUnitId`. Two things make omitting it safe TODAY: (a) there is no
authoring surface (no `PoliciesController`) to create an `org_unit`-scoped
`tool.invoke` policy, and (b) a chat derives no org path (no `chats.orgUnitId`),
so there's no org context to pass. **Follow-up trigger:** whoever ships an admin
policy-authoring endpoint (plausibly before v0.5's chat↔project linkage) MUST
also wire `orgUnitId` into this gate, or an org-scope tool-deny would be
silently ignored. Consistent with the config resolver, which likewise uses
user+chat only today.

### Wiring

- `ChatsModule` imports `PoliciesModule` (exports `PolicyService`).
- `RunExecutionService` gains `PolicyService` (constructor). The
  `run-execution-tools.integration.spec` construction gains a real
  `PolicyService(tenantDb)`.

## Testability

- Unit (`resolveAvailableTools`): the 3-way matrix — deny excludes a safe tool;
  allow includes a non-safe tool; unset → safe-allowlist; default `() =>
  'unset'` preserves current behavior.
- Integration (real DB + `PolicyService` + `PoliciesRepository`): seed a
  user-scope DENY policy for `tool.invoke`/`search_conversations` → the resolved
  set for that user excludes it while `get_current_time` remains; seed an ALLOW
  for a synthetic non-safe tool name → included; an allow WITH approval → still
  excluded. Proves deny-overrides + grant + approval-fail-closed against the
  real engine.
- Existing tool-loop/persistence/e2e stay green: with no policies seeded, every
  tool resolves `unset` → the safe allowlist → today's behavior.

## Non-goals (named)

- The approval FLOW (pause/resume for `ask_*` levels) — approval-demanding
  tools are EXCLUDED for now, not paused. Building the flow is a distinct
  change.
- Org-scope tool policies (need chat→project/org context, v0.5).
- Batch policy evaluation (per-tool `checkWithin` for the MVP's 2 tools).
- Gating models/connectors by policy (same seam, later).

## Revision history

- **v2 (2026-07-02):** Round-1 review (verifier + adversarial, both
  not-converged — both confirmed the IMPLEMENTATION correct; the spec was the
  drift). Fixes: (P1) split the approval row — `auto_allow_*` (rank 1–2, never
  ask) → allow, only `ask_*`/`always_ask`/`admin_only` (rank ≥ 3) → deny, via
  the exported `requiresHumanApproval`; the earlier "any non-null approval →
  deny" would have silently dropped an admin's low-friction grant. (P1) noted
  the `tools.spec.ts` boolean-callback assertions must be rewritten to the
  verdict enum (a real guard site, not a free default). (P1) restated the scope
  invariant as two-part (no authoring surface AND no chat→org derivation; the
  missing dimension is user-org membership, already wired through
  PolicyService) with an explicit follow-up trigger. (P1) added the fail-closed
  ERROR CONTRACT: on a checkWithin failure, deny every tool (empty set,
  answer-only) — never catch-to-`unset`. Deny-overrides + explicit/default-deny
  disambiguation confirmed correct by both. Implementation built to v2 and
  verified: 3 policy-gated integration cases green + a fail-closed unit test.
- **v1 (2026-07-02):** Initial.
