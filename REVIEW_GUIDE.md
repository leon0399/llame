# Review guide

This file owns reviewer judgment. [CONTRIBUTING.md](CONTRIBUTING.md) owns
delivery; [CODING_STANDARDS.md](CODING_STANDARDS.md) owns diff shape.
`.coderabbit.yaml` points here, so every section applies to human and automated
reviewers.

## Merge question

> Does the change solve a real llame problem in the owning layer, expose a
> contained contract, preserve tenant isolation and Run durability, and remain
> the smallest correct version?

Review in this order: security; persisted-history durability; product fit;
maintainability; measured hot-path performance. Later concerns never override
earlier ones. Hot paths are Run acceptance, tool execution, workers, compaction,
and search.

## Blocking review checks

### Security

- Treat request data, cookies, model/tool/MCP output, knowledge files, and
  prompt-bound owner text as untrusted.
- Authorization identity comes only from authentication. Caller-supplied IDs
  locate resources; they never define ownership.
- Tenant tables have policies plus `FORCE ROW LEVEL SECURITY`; request paths set
  `app.current_user_id`; missing identity fails closed.
- Guard a new reachable surface now or omit it.
- Credentials, resolved secrets, tokens, MCP sessions, and host paths stay out
  of code, logs, errors, model context, receipts, and public responses.
- Prompt-bound external content is framed as data. Do not claim prompt text is
  structural enforcement.
- Data/auth/tenancy changes include threat analysis and a cross-tenant negative
  test.

Do not block on unreachable theories or irrelevant advisories; name the actual
path and failure.

### Durable history and Runs

- Preserve `messages.parts`, stored order, and stored context-item text. New
  replay transforms or omissions require a spec.
- Every Run stays on pg-boss; `RunExecutionService` remains HTTP-independent.
- Changes to server-authored data semantics define one API/worker revision
  boundary with rollout and rollback procedures.
- Write-capable tools require checkpoint or dedupe semantics before execution;
  queue recovery may repeat a tool call.

### Existence and scope

- Features have an approved proposal. The change serves a reachable need and
  reuses repository/platform code where possible.
- Reject unrelated renames, formatting, comment churn, speculative typing, and
  drive-by refactors.
- One PR has one concern. Every file traces to a PR requirement. Review a stack
  layer against its parent, not only the aggregate.

### Ownership and contracts

- `apps/api` alone owns DB access. Queue primitives serve Runs, search workers,
  and session cleanup; `chats/` dispatches without queue knowledge.
- OpenSpec owns capability behavior; `SPEC.md` architecture; `docs/` runbooks;
  closest `AGENTS.md` commands and traps.
- Shared primitives live in `packages/ui`; app compositions in the app.
- Never edit generated clients or OpenAPI output by hand.
- APIs use resources and standard verbs. Structured bodies/queries use DTOs;
  scalar route parameters use pipes. JSON responses use explicit allowlists;
  streams document their transport contract. Defaults are durable contracts;
  provider data sharing defaults off and states retroactivity plus
  non-erasability together. Config errors fail boot with the bad path.
- Unimplemented UI is a visible disabled placeholder, never hidden or clickable
  without behavior. Do not add noisy per-request or per-token logs.
- TypeScript remains the only web/API/worker language.

### Tests and migrations

- A bug fix has a test that fails without it. Use the layer defined in
  [docs/testing.md](docs/testing.md); DB suites never skip silently.
- Reject tautologies: name an implementation mutation that leaves the test
  green. Tests assert observable behavior, not mock wiring.
- Tenant changes include datastore and app-layer negative tests.
- Generate migrations by default. Manual steps explain themselves in the SQL
  header. Check forced RLS, backfill `NO FORCE` windows, `SECURITY DEFINER`
  ownership, and journal ordering. See
  [apps/api/src/db/AGENTS.md](apps/api/src/db/AGENTS.md).

### Records and dependencies

- Shipping records and feature finalization follow
  [CONTRIBUTING.md](CONTRIBUTING.md); no follow-up bookkeeping PR.
- Guidance-only changes do not require changelog or roadmap entries.
- Markdown lint, conventional commits, and the PR body contract pass.
- Before adding a dependency: use the platform, installed code, or a small owned
  implementation. If still needed, verify maintenance, license, weight, and
  workspace-catalog pinning. Use parent-scoped overrides with removal criteria;
  adopt majors at `.1` or later, one major per PR.

### PR evidence

- Rebase stacks; do not merge `master` into them. Confirm CI actually scheduled.
- Verification claims match commands run. Separate environment failures.
- Verify automated-review claims against code, installed packages, lockfiles,
  or primary docs.
- Every finding gets a disposition and originating-surface reply; resolve inline
  threads after disposition.

## Writing findings

Name the defect or violated rule, the input/state that triggers it, and whether
it blocks. A preference without a failure mode is not a finding. Do not restate
lint output. Review the layer diff.

## Checklist

1. Merge question passes.
2. Trusted identity, forced datastore isolation, closed failure, negative test.
3. No secret or host-path disclosure.
4. Stored history and queued Runs remain durable.
5. The change should exist and contains no churn.
6. One concern; every file justified; owning layer used.
7. API/default/generated-code contracts hold.
8. Tests fail without the change and are non-tautological.
9. Migration exceptions and backfill windows are documented.
10. Changelog, roadmap, OpenSpec, commit, and dependency rules pass.
11. CI/review evidence is current and every thread is disposed.

Merge additionally requires terminal green CI, completed expected automated
reviews, no actionable unresolved feedback, and Leo's explicit permission.
