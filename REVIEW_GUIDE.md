# REVIEW_GUIDE.md

How a change to llame is reviewed. This is the shared standard for human and
automated reviewers alike — [`.coderabbit.yaml`](.coderabbit.yaml) points the
automated reviewer at this file. Reviewers may differ in the depth they add, but
every section applies to every reviewer: no one assumes a finding is somebody
else's to report.

[CONTRIBUTING.md](CONTRIBUTING.md) governs the _process_ — issue, OpenSpec
proposal, stacked PRs, verification gates, merge permission.
[CODING_STANDARDS.md](CODING_STANDARDS.md) governs what an acceptable _diff_
looks like. This file governs the _judgement_ applied on top of both.

## The merge question

> Does this change solve a real llame problem, in the layer that owns it, with a
> contained user-visible contract, without weakening tenant isolation or the
> durability of a Run — and is it the smallest correct version of itself?

Everything below is a way of answering that question. A change that fails it
does not merge, however clean the code is.

## Review priorities

Apply in this order. A later concern never overrides an earlier one.

1. **Tenant isolation and security.** llame is multi-tenant and self-hosted; a
   cross-tenant leak is unrecoverable for an operator who cannot roll their
   users' data back.
2. **Durability and correctness of persisted history.** A Run that loses work,
   or a message rewrite that corrupts stored conversation history, is the second
   unrecoverable class.
3. **Product fit and contract containment.** Is this the right surface, and does
   it commit us to something we cannot change?
4. **Maintainability.** Complexity, duplication, conventions.
5. **Performance.** Real, measured, on a hot path.

The hot paths are Run acceptance, the tool-calling loop, worker execution,
compaction, and search. Cost there is paid per message, per user, forever.

---

## 1. Security

Treat as attacker-controlled: request bodies, params, query strings, headers,
cookies, model output, tool results, MCP server responses, knowledge-space file
contents, and any owner-authored text that reaches a prompt.

Ask on every change that touches data, auth, tenancy, identity, secrets, or an
externally reachable surface:

- **Where does authorization identity come from?** It must come only from a
  trusted authenticated source. A value the caller can set — a body field, a
  header, a path id used as a scope — is never a scope. Reject any query
  filtered by client-supplied ownership.
- **Is isolation enforced in the datastore, not only in app code?** Every
  tenant-bearing table needs a policy _and_ `FORCE ROW LEVEL SECURITY`, and the
  request path must actually set `app.current_user_id`. App-layer checks alone
  are a single point of failure. See
  [`apps/api/src/db/AGENTS.md`](apps/api/src/db/AGENTS.md).
- **Does it fail closed?** Absent identity, absent scope, an unavailable
  capability, an errored inspector — all must deny. Fail-open anywhere in an
  authorization path is a blocking finding regardless of how unlikely the branch
  looks.
- **Is a new reachable surface guarded today?** If the guard does not exist yet,
  gate or omit the surface. A code comment, a TODO, or a follow-up issue is not
  a mitigation.
- **Do secrets stay secret?** Never commit, log, print, echo, or return
  credentials, keys, tokens, resolved `{env:…}`/`{path:…}` values, MCP session
  ids, or host filesystem paths. They must not reach diagnostics, error
  messages, model context, owner-visible receipts, or the public model catalog.
- **Is untrusted content framed as data?** Tool results, MCP output, and
  cross-chat digests enter model context as data, never as instruction. Where
  the framing is carried by prompt text rather than structure, say so explicitly
  rather than implying enforcement.

Recurring themes worth checking by name: a new endpoint without a negative
cross-tenant test; a migration that adds a tenant-bearing table without `FORCE`;
a `SECURITY DEFINER` function that returns content instead of identifiers; a
wildcard MCP allowlist entry on a server that is not wholly read-only; a
write-capable tool without checkpoint-or-dedupe semantics (queue retries restart
the tool loop from step one).

**Security is an acceptance criterion, not a follow-up.** Any change in this
territory states its isolation and threat considerations up front and ships a
negative test. Reviewers reject "we'll add the test after."

Do not, however, manufacture findings from audit noise. A theoretical issue on a
path that cannot be reached, or a dependency advisory that does not apply to how
the dependency is used, is worth a note — not a block.

## 2. Durability and persisted history

- **`messages.parts` is the durable application/UI history.** Prior
  model-bearing parts and their stored order are preserved by default.
  Sanitize, render, and order application-authored content _before_ persistence,
  not during replay. A new application-owned replay transform or omission must
  be specified, never introduced silently.
- **Stored text is the replay authority** for context items. Replay must not be
  gated on current producer knowledge or rebuilt from metadata.
- **Every chat run goes through the pg-boss queue.** There is no inline
  request-thread mode. Reject anything that executes a run on the HTTP thread or
  couples `RunExecutionService` to HTTP.
- **A schema change that alters what server-authored data means is a
  coordinated API/worker revision boundary**, not a schema-only change. The PR
  must state the rollout order and the rollback path. See the Rollout section of
  [`apps/api/AGENTS.md`](apps/api/AGENTS.md).

## 3. First-pass triage — should this exist?

Before reviewing the code, decide whether the change belongs at all:

- Does it serve an issue with acceptance criteria, and does a feature change
  have an approved OpenSpec proposal behind it? Implementation without that
  approval is rejected on process, not on merit.
- Is it fixing a real, reachable problem, or a hypothetical one?
- Does it duplicate something the repo already does? Prior art in-repo beats a
  new implementation; an installed dependency beats a new one.
- Would doing nothing be acceptable?

Reject churn: renames without a consumer, reformatting outside the touched
region, comment rewrites, speculative type gymnastics, and "while I was in here"
refactors. These inflate the diff, hide the real change, and break `git blame`
for no gain.

## 4. Scope discipline

One PR, one concern, describable in one sentence. In a stack, each layer is
independently reviewable against its immediate parent.

The test: for every file in the diff, can you say which sentence of the PR
description required touching it? A file that fails that test comes out.

Regression risk scales with code _touched_, not code added. Prefer an isolated
new unit over a change threaded through shared paths, even at the cost of some
duplication.

## 5. Architecture — put it in the owning layer

- `apps/api` is the sole database owner. `apps/web` holds no connection and
  reads or writes only through the API (SPEC.md §22.0). A DB import in `web` is
  an automatic reject.
- Queue primitives are consumed by `runs/`, search workers, and session cleanup.
  `chats/` dispatches through `RunDispatchService` and never sees queue names
  or payloads.
- Normative capability behavior belongs in `openspec/specs`, not in an
  `AGENTS.md` and not in a code comment. Cross-cutting architecture belongs in
  `SPEC.md`. Operator runbooks belong in `docs/`.
- Shared UI primitives live in `packages/ui`; app-wired compositions live in the
  app. Generated shadcn primitives are vendored — compose around them rather
  than editing them.
- Generated code (`apps/web/lib/api/generated/`, `apps/api/openapi.json`) is
  never hand-edited. The generator input is the thing to change.
- TypeScript only across web/api/worker — no second backend language
  (SPEC.md §23).

## 6. Product and API surface

- Model the HTTP API as resources plus standard verbs. `PATCH /resource/:id`,
  not RPC verb handles like `/chats/:id/rename`.
- Structured request bodies and queries use class-validator DTOs; scalar route
  parameters use pipes. JSON endpoints return explicit response allowlists;
  streaming endpoints document their transport contract.
- **Defaults are hard to change.** A new default is a contract with every
  existing self-hoster. Anything that shares user data with a provider defaults
  to off, and the consent contract states its retroactivity and its
  non-erasability together.
- Configuration errors fail boot naming the bad path. No silent fallbacks.
- Unimplemented UI renders as a disabled placeholder — never hidden, never a
  dead click.
- Output discipline: no new noisy logs on a per-request or per-token path.

## 7. Tests

- The change proves the behavior it claims. A bug fix ships a test that fails
  without the fix.
- The test sits at the right level: `docs/testing.md` is the contract.
  Component behavior belongs in a Storybook story's play function, not a jsdom
  render test. DB-backed suites go in `*.integration.test.ts` and fail loudly
  rather than skipping when Postgres is absent.
- Tenancy changes ship a negative test proving cross-tenant access is denied.
- **Tautological tests considered harmful, and are a blocking finding.** Reject
  a test that asserts a mock returns what it configured, recomputes the expected
  value with the implementation's own expression, asserts only
  `toHaveBeenCalled()` where the behavior is what the call produces, or
  snapshots current output with no independent notion of correct. When a test
  looks tautological, say which change to the implementation would leave it
  green — that is the whole argument.
- Tests assert on behavior at a real seam, not on mocks threaded through the
  interior. A test that would pass against a broken implementation is not
  coverage.
- No silently skipped suite, and no assertion weakened to make a flake pass.

## 8. Migrations

- Generated by `drizzle-kit` by default. A hand-authored step records its
  rationale in the migration's own `.sql` header.
- Check the four recurring traps: hand-appended `FORCE ROW LEVEL SECURITY`, the
  `NO FORCE` window every data backfill needs, the `SECURITY DEFINER` ownership
  lifecycle (never `CREATE OR REPLACE` after provisioning), and journal `when`
  ordering.
- A backfill without a `NO FORCE` window silently no-ops. Look for it every
  time.

## 9. Documentation and records

- A shipped product or behavior change updates `CHANGELOG.md` in the same PR
  and removes its `ROADMAP.md` entry if it had one. Guidance-only edits are
  exempt.
- A feature change ends its stack with OpenSpec sync and archive.
- Product-owned Markdown passes `pnpm lint:markdown` without new inline
  disables.
- Conventional commit subjects (`feat(api):`, `fix(web):`, `docs(spec):`).
- PR bodies name the issue, the layer's single concern, its position in the
  stack, and verification actually run. `Closes #N` only on the layer that
  genuinely completes the issue. No `Test plan` section.

## 10. Dependencies

Before accepting a new dependency, ask in order: does the platform do it; does
an installed dependency already do it (check its types and docs before assuming
it does not); can a few lines we understand do it. A new dependency is code we
ship without reading.

If one is genuinely warranted: it is maintained, its license is compatible, its
transitive weight is proportionate, and it is pinned through the workspace
catalog. `pnpm.overrides` is only for a permanently stuck parent, scoped to that
parent, with a stated removal condition.

Major versions are adopted at `x.y.1` or later, never `.0`, one PR per version.

## 11. PR hygiene

- Rebase rather than merge `master` into a stack branch. A stacked PR conflicting
  with its base receives **zero** CI runs and looks calm rather than red —
  confirm checks actually scheduled.
- Verification claims must be real. Never state that a build, suite, or CI
  surface passed when only a narrower command ran. Record environment failures
  separately from repository defects.
- Resolve every review thread with a disposition — fixed, or rejected with
  concrete evidence. Silence is not resolution.
- Independently verify factual claims from automated reviewers before acting on
  them, especially version numbers, API behavior, and deprecation status. Most
  such findings are model knowledge-cutoff artifacts; check the installed
  package, the lockfile, or primary documentation.

## 12. How feedback is written

- Name the bug, or name the specific documented rule that is violated. "This
  could be cleaner" is not a review comment.
- Say what breaks and under which input or state. A finding without a failure
  scenario is a preference.
- Distinguish blocking from optional explicitly. Do not bury a blocking finding
  in a list of nits.
- Do not restate what a linter already enforces. `oxlint` (with type-aware rules
  on `tsgo`), `prettier`, `ast-grep`, and `markdownlint-cli2` run in CI; a
  comment duplicating them is noise.
- Review the layer's own diff, not only the top-of-stack aggregate.

---

## Reviewer's checklist

1. Does it answer the merge question? (top)
2. Identity from a trusted source; datastore-level isolation; fails closed;
   negative test present. (§1)
3. Secrets, host paths, and resolved tokens absent from logs, errors, model
   context, and owner-visible output. (§1)
4. Persisted history preserved; runs stay on the queue; any revision boundary
   states its rollout and rollback. (§2)
5. The change should exist at all, and carries no churn. (§3)
6. One concern; every file justified by the description. (§4)
7. Logic sits in the layer that owns it; nothing generated is hand-edited. (§5)
8. Resource-shaped API, DTO plus explicit response type, safe default. (§6)
9. Tests fail without the fix, at the right level, no silent skips. (§7)
10. Migration exceptions documented in the `.sql` header; backfill windows
    present. (§8)
11. Changelog, roadmap, OpenSpec, and commit conventions. (§9)
12. No unjustified dependency. (§10)
13. Verification claims are true and CI actually ran. (§11)

**Mergeable** means: the checklist passes, required CI is terminal and green,
every expected automated reviewer has completed, no actionable thread is
unresolved — and Leo has explicitly approved the merge. No contributor or agent
merges without that permission.
