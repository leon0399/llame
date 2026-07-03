# Usage & cost dashboard

## Objective

llame is BYOK — the whole pitch is "bring your own key," which means users pay
per token and CARE about spend. Per-turn usage/cost is already persisted
(`messages.usage` = `TurnTelemetry` with `inputTokens`/`outputTokens`/
`totalTokens`/`costUsd`/`model`) and shown per message, but there's no way to see
the TOTAL: how much have I spent, on which models, over time. Add a usage
dashboard that aggregates what's already stored. Completes the per-turn-usage
feature (per-turn → aggregate); read-only and safe (no new write path, no RLS
relaxation).

## Design

### Backend

- `UsageRepository.summary(userId, days)` (a dedicated class + `MeUsageController`)
  — aggregate `messages.usage` over the user's assistant turns. Owner-scoped:
  JOIN `chats` on `owner_user_id = userId` (seatbelt) on top of RLS — so it can
  never sum another tenant's turns (and the sharing `messages_public_read`
  policy, gated on `current_user=''`, never applies under `runAs(userId)`). Only
  rows with a non-null `usage` (assistant turns) count. ALL THREE shapes below
  are windowed to the same `days` (one shared predicate) for a consistent view;
  a `SET LOCAL statement_timeout = 5000` caps the unindexed jsonb scan:
  - `total`: summed `inputTokens`/`outputTokens`/`totalTokens`, summed `costUsd`
    (where non-null), and counts of turns WITH vs WITHOUT a known cost (so the
    UI can say "estimate; N turns' cost unknown").
  - `byModel`: grouped by `usage->>'model'` (+ provider) — tokens + cost.
  - `byDay`: grouped by `date(created_at)`, last `days` (default 30) — tokens +
    cost, for a trend.
  Uses `usage->>'field'` jsonb extraction cast to `::numeric` for EVERY field
  (never `::int` — which would ERROR on a float / abort the whole user's
  aggregation); an absent field → null → COALESCE 0 / excluded from the cost
  FILTER. `byDay` buckets by UTC date (`created_at AT TIME ZONE 'UTC'`).
- `GET /api/v1/me/usage?days=30` → `UsageSummaryResponse` (DTO: `days` 1..365).
  Owner-scoped `runAs`. Explicit response type (code-first OpenAPI).

### Web

- A `UsageSection` in Settings: a headline (total estimated cost + total tokens),
  a per-model table (model · tokens · cost), and a compact last-N-days list (or
  minimal CSS bars — no chart dependency). Cost is labelled an ESTIMATE (it comes
  from a built-in price table); if any turns have unknown cost, a one-line note.
  A `me/usage` service (query hook).

## Cost is an estimate (honest framing)

`costUsd` is a server-side estimate from a small built-in price table (BYOK keys
mean llame can't see the provider's actual invoice), and is null for a model not
in the table. The dashboard says "estimated," sums only known costs, and reports
the unknown-cost turn count — it never implies an authoritative bill.

It also structurally UNDERCOUNTS (disclosed in the UI: "excludes regenerated and
cancelled turns, may run lower than your bill"): (1) a regenerated reply
hard-deletes the superseded turn, so its real spend is gone from the DB; (2) a
cancelled/errored turn writes `usage:null` → zeroed, even though the provider may
have billed partial output before the abort. Both understate the true bill;
capturing them would need retained-usage-on-delete + partial-abort accounting,
out of scope for v1.

## Testability

- RLS/aggregation integration: a user's summary sums ONLY their own turns —
  another user's turns (incl. a PUBLIC chat's) are excluded; a null-cost turn is
  counted in `turnsWithUnknownCost` but not in the cost sum; tokens/cost sum
  correctly; `byModel`/`byDay` group correctly; user (non-usage) turns ignored.
- API: the endpoint maps rows → DTO; `days` bounded; unauth rejected.
- Web: the usage service (URL/params); a cost/number formatter unit.

## Non-goals (named)

- Compaction-call cost (`compactions.usage`) — a minor, infrequent cost, omitted
  from v1 (a named follow-up; the turns are the dominant spend). Per-chat usage
  breakdown; budgets/alerts on spend; CSV export; real provider-invoice
  reconciliation (impossible under BYOK); a charting library.

## Revision history

- **v2 (2026-07-03):** Round-1 review. Both reviewers confirmed the core is
  correct (jsonb field names match camelCase, no cross-tenant leak — the sharing
  policy's `current_user=''` gate holds under `runAs`, costUsd `numeric` is
  lossless). Doc corrected to match the shipped code: `::numeric` for ALL fields
  (not `int` — the adversarial P0, a query-abort risk the code already avoided);
  a dedicated `UsageRepository`/`MeUsageController` (not `MessagesRepository`);
  all three aggregates windowed by `days` (not just `byDay`); UTC + 5s timeout
  stated. Added the structural-undercount disclosure (regenerate-deleted +
  cancelled-turn spend) — surfaced in the UI. Regenerate double-count was
  refuted (hard-delete, no inflation).
- **v1 (2026-07-03):** Initial.
