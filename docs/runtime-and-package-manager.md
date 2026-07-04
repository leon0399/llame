# Runtime & package manager: Node + pnpm (decision, 2026-07)

llame runs on **Node ≥ 22.12 with pnpm 10.x**. A structured evaluation of
switching to Bun (as package manager, runtime, and/or test runner) concluded:
**stay**, and revisit only when the trigger conditions below flip. This
records the reasoning so the question isn't relitigated from scratch.

## Why not Bun today

Evaluated against this stack specifically (Nest 11 + Express 5, postgres.js,
pg-boss, Next 16 + Turbopack, Playwright, Sentry), mid-2026:

1. **`node:async_hooks`** — Bun's own docs mark usage "strongly discouraged"
   and V8 promise hooks are not called. Request-scoped context is
   load-bearing here (per-request RLS `app.current_user_id`, OTel-based
   Sentry server SDK). This is the hard disqualifier: it intersects the
   tenancy security model, not just DX.
2. **`node:worker_threads`** — documented option gaps plus open stability
   issues; the durable-run worker (#50) is the next major build-out and
   should not sit on the runtime's weakest module.
3. **NestJS has no first-party Bun support** (nestjs/nest#15764 open), a live
   decorator-metadata regression existed at evaluation time
   (oven-sh/bun#27575), and no public production Nest-on-Bun deployment was
   found. midday — the flagship all-Bun TypeScript SaaS — chose Hono, not Nest.
4. **Next 16 + Turbopack under the Bun runtime** had open Fast-Refresh
   rebuild storms (vercel/next.js#89530) and a hard runtime warning against
   Cache Components (#87630); Vercel's Bun runtime is beta.
5. **Playwright cannot run under Bun** (multi-worker instability is the
   Playwright team's own named blocker, microsoft/playwright#27139), and
   `bun test` breaks on workspace mocking — which describes the api suite.
6. **SIGTERM handling has a bug history** in Bun — the api's shutdown-hook
   drain (postgres.js pool, pg-boss) depends on correct signal delivery.
7. **The performance profile doesn't fit.** Bun's wins are cold start and
   install speed. `apps/api` is a long-running, Postgres/LLM-bound SSE
   server — the regime where V8's tiered JIT and mature GC win and benchmark
   gaps collapse to single digits. Installs (~10s warm) and warm builds
   (FULL TURBO, sub-second) are not bottlenecks.

Bun-as-package-manager-only (Node stays the runtime) is viable and supported
by Turborepo, but buys only a few seconds per install against a lockfile
migration, CI/Nix rework, the loss of `pnpm deploy`/`pnpm patch` (no Bun
equivalents), and isolated installs being months old (rocky 1.3.0 launch,
stabilized over ~4 point releases).

## Revisit triggers

Reopen the question when **all of the hard ones** hold:

- [ ] Bun's `node:async_hooks` docs no longer discourage use (hard)
- [ ] NestJS ships first-party Bun support (hard)
- [ ] Playwright's Bun multi-worker blocker is closed (hard)
- [ ] A credible production Nest-on-Bun deployment exists (soft)
- [ ] Turbopack-under-Bun issue cluster is resolved (soft)

Realistic first adoption if triggers land: a **new adjunct service** (e.g. a
messaging-channel gateway on Hono/`Bun.serve`) — never an in-place migration
of `apps/api`.

## pnpm specifics (what we use and why)

- **`catalog:`** in `pnpm-workspace.yaml` — one shared version per dependency
  used by 2+ workspaces. Add new shared deps to the catalog, not per-package.
- **`allowBuilds`** — the reviewed allow/deny list for install scripts
  (successor to `onlyBuiltDependencies`; the only mechanism in pnpm 11).
  Every entry is a decision; unlisted packages are blocked.
- **`enableGlobalVirtualStore` is deliberately off** — it would make
  per-worktree installs near-instant for the multi-agent worktree workflow
  (https://pnpm.io/git-worktrees), but tsgo resolves through the
  global-store realpaths and `@types` identities split, failing the web
  typecheck on identical dependency versions. Revisit when tsgo/TS support
  the layout.
- Keep pnpm current on the 10.x line — security patches (lockfile
  path-traversal hardening, env-var-expansion restriction) land there, which
  matters for a BYOK-secrets repo. pnpm 11 migration is deliberately
  deferred; `allowBuilds` already matches its config surface.
