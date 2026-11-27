# Review guide

This file owns reviewer judgment, for human and automated reviewers alike. It
says how to weigh a change; the rules it is weighed against live elsewhere:

- [CODING_STANDARDS.md](CODING_STANDARDS.md) owns diff shape.
- The `AGENTS.md` files from the repository root down to each changed file's
  directory own that file's conventions and traps. A violated rule there is a
  finding.
- The OpenSpec capability that owns the behavior owns what the change must do.
- [CONTRIBUTING.md](CONTRIBUTING.md) owns delivery: issues, stacks, records,
  and merge.

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
- The datastore enforces tenant isolation, and a missing identity fails closed.
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

- Stored history and queued work are durable contracts. A new replay
  transform, omission, or reordering of stored data requires a spec.
- A change to the meaning of server-authored data defines one API/worker
  revision boundary with rollout and rollback procedures.
- Work that can be retried is safe to repeat: a write-capable step has
  checkpoint or dedupe semantics before it executes.

### Existence and scope

- Features have an approved proposal. The change serves a reachable need and
  reuses repository/platform code where possible.
- Reject unrelated renames, formatting, comment churn, speculative typing, and
  drive-by refactors.
- One PR has one concern. Every file traces to a PR requirement. Review a stack
  layer against its parent, not only the aggregate.

### Ownership and contracts

- The change lives in the layer that owns it, as the documentation authority in
  [AGENTS.md](AGENTS.md#documentation-authority) and the nearest `AGENTS.md`
  assign it.
- Generated output is regenerated from its source, never edited by hand.
- Public contracts (APIs, wire and stream formats, configuration, defaults)
  are durable: a change to one is deliberate, documented, and specified.

### Tests and migrations

- A bug fix has a test that fails without it. Use the layer defined in
  [docs/development/testing.md](docs/development/testing.md); DB suites never
  skip silently.
- Reject tautologies: name an implementation mutation that leaves the test
  green. Tests assert observable behavior, not mock wiring.
- Tenant changes include datastore and app-layer negative tests.
- A migration or backfill that departs from the generated default explains
  itself where it is written.

### Records and dependencies

- Shipping records and feature finalization follow
  [CONTRIBUTING.md](CONTRIBUTING.md); no follow-up bookkeeping PR.
- Guidance-only changes do not require changeset or roadmap entries.
- Markdown lint, conventional commits, and the PR body contract pass.
- Before adding a dependency: use the platform, installed code, or a small owned
  implementation. If still needed, verify maintenance, license, weight, and
  workspace-catalog pinning. Use parent-scoped overrides with removal criteria;
  adopt majors at `.1` or later, one major per PR.

### PR evidence

- Layer scope follows CONTRIBUTING's [review budget](CONTRIBUTING.md#review-budget)
  and its self-review-before-ready / GitHub-review-after-ready checkpoints
  ([PR contract](CONTRIBUTING.md#pr-contract)); this guide owns the judgment
  applied within them.
- Rebase stacks; do not merge `master` into them. Confirm CI actually scheduled.
- Verification claims match commands run. Separate environment failures.
- Verify automated-review claims against code, installed packages, lockfiles,
  or primary docs.
- Every finding gets a disposition and originating-surface reply; resolve inline
  threads after disposition.

## Writing findings

Name the defect or violated rule, the input/state that triggers it, and whether
it blocks. A preference without a failure mode is not a finding. Do not restate
what CI already enforces: lint, formatting, dead code, duplication, workflow
linting, and action pinning all run as gates. Comment only on changed code, and
review the layer diff. Before asserting a version, an API behavior, or a
deprecation, check it against the lockfile or the installed package.

## Checklist

1. Merge question passes.
2. Trusted identity, datastore isolation, closed failure, negative test.
3. No secret or host-path disclosure.
4. Stored history and queued Runs remain durable.
5. The change should exist and contains no churn.
6. One concern; every file justified; owning layer used.
7. Every applicable `AGENTS.md` rule and the owning spec hold.
8. Public, default, and generated-code contracts hold.
9. Tests fail without the change and are non-tautological.
10. Changeset, roadmap, OpenSpec, commit, and dependency rules pass.
11. CI/review evidence is current and every thread is disposed.

Merge additionally requires terminal green CI, completed expected automated
reviews, no actionable unresolved feedback, and Leo's explicit permission.
