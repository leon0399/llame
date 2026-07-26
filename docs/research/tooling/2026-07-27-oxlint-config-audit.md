# oxlint config audit — llame monorepo

**Date:** 2026-07-27 · **oxlint:** 1.72.0 (catalog) · **Status:** noncanonical report, nothing applied

Scope: read the oxlint [nested-config](https://oxc.rs/docs/guide/usage/linter/nested-config.html)
and [config](https://oxc.rs/docs/guide/usage/linter/config.html) docs, audit llame's four
`.oxlintrc.json` files against them, and quantify what changing them would actually buy.

All numbers below are from real runs against the working tree at `ae2611af`. Method notes and the
one result that contradicts the obvious recommendation are in §7.

---

## 0. Lead finding — the `settings` example you asked about is a net negative here

The config you quoted:

```json
{
  "settings": {
    "next": { "rootDir": "apps/dashboard/" },
    "react": { "linkComponents": [{ "name": "Link", "linkAttribute": "to" }] },
    "jsx-a11y": { "components": { "Link": "a", "Button": "button" } }
  }
}
```

`jsx-a11y.components` maps a component name to a DOM element so a11y rules treat
`<Link>` like `<a>`. That mapping assumes the **children of the mapped component are the
element's content** — which is true for Radix `asChild` and for plain JSX wrappers.

llame migrated `packages/ui` to Base UI, which uses the **`render` prop** instead
(`packages/ui/src/components/button.tsx:46` documents this). The pattern throughout `apps/web` is:

```tsx
<SidebarMenuButton render={<Link href={item.href} />}>
  <item.icon />
  <span>{item.label}</span> {/* ← the accessible content lives HERE */}
</SidebarMenuButton>
```

The `<Link>` is **self-closing**. Map `Link: "a"` and jsx-a11y sees an anchor with no children.

Measured on `apps/web`:

| config                                              | findings | new findings | verified false positives |
| --------------------------------------------------- | -------: | -----------: | -----------------------: |
| `jsx-a11y` plugin, no `settings`                    |       15 |            — |                        — |
| \+ `components: { Link: "a", Button: "button", … }` |       42 |           27 |              **26 / 27** |

All 10 new `anchor-has-content` hits are `render={<Link … />}` — verified line by line, including
the two multi-line forms at `app/(chat)/components/chat-list-sidebar/index.tsx:48` and
`chat-item.tsx:175`. All 6 `control-has-associated-label` hits derived from
`Button`/`SidebarMenuButton` are `render={<Button … />}` inside a Base UI trigger whose children
carry the label (`components/font-switcher.tsx:43`, `app/(chat)/components/model-selector.tsx:87`,
`app/(chat)/settings/page.tsx:98`, `app/shell/app-sidebar/app-sidebar-user.tsx:56`, …); the
remaining 10 control hits share file:line with the anchor hits.

**The one true positive** — worth fixing regardless of what you decide about oxlint — is
`app/(admin)/admin/organizations/components/org-unit-dialogs.tsx:133`, surfaced by mapping
`Label: "label"`: a `<Label>Type</Label>` labels a grid of `<button type="button">` toggles with no
programmatic association. `htmlFor` is the wrong fix here; it wants `role="group"` +
`aria-labelledby`, or a `<fieldset>`/`<legend>`. One real finding does not justify carrying 26 false
ones in the lint gate.

**Recommendation: enable the `jsx-a11y` plugin, do _not_ set `settings.jsx-a11y.components`.**
`polymorphicPropName` doesn't rescue this either — it resolves a _string_ prop (`as="h3"`), not a
JSX-element prop. Revisit only if oxlint learns Base UI's `render`.

`settings.react.linkComponents` changed nothing in this repo (no `react` rule that consumes it is
currently enabled). `settings.next.rootDir`: **unverified — do not adopt on my say-so.** I got zero
`nextjs/*` findings with and without it, `apps/web` is App Router with no `pages/`, and the only
consumer (`nextjs/no-html-link-for-pages`) never fired. The value in your example is also
cwd-relative in a way that would resolve to `apps/web/apps/web` when oxlint runs from the workspace,
which is how llame runs it.

---

## 1. Structural fact that inverts the usual monorepo advice

From the nested-config docs, **confirmed empirically** (§7.3):

> Only `rules`, `plugins`, and `overrides` can be extended.

So the natural "hoist shared config to a root `.oxlintrc.json` and `extends` it" plan **cannot carry
`settings`, `env`, `categories`, or `ignorePatterns`**. Each package that needs `settings` must
declare its own copy. Test: a base config declaring `settings.jsx-a11y.components` plus the plugin
list, extended by `apps/web` → plugins inherited (jsx-a11y rules fired), settings silently dropped
(0 `anchor-has-content`).

What a shared base _can_ usefully carry:

- **`plugins`** — the four configs currently duplicate `["typescript","unicorn","oxc","react"]`.
- **`rules`** — `react/rules-of-hooks` + `react/exhaustive-deps` are copy-pasted three times.
- **`overrides`** — mergeable, and this is the fix for the stories noise in §3.

One trap if you do this: an extending config that **omits** `plugins` re-adds the default plugin set
on top of the base's list. To inherit _exactly_ the base's plugins, the child must write
`"plugins": []`. (Verified — the extends test used `"plugins": []` and got precisely the base list.)

Second trap: `options.typeAware` and `options.typeCheck` are **root-config-only**; oxlint errors if
they appear in a nested config. Today `apps/api/.oxlintrc.json` _is_ the root config because
`pnpm --filter api lint` runs with cwd `apps/api`. Introduce a repo-root `.oxlintrc.json` **and**
ever run oxlint from the repo root, and api's config becomes nested → hard error. Keep per-workspace
invocation, or keep `typeAware` out of any file that could become nested.

Third: turbo's `lint: {}` task has no `inputs`. A repo-root shared config is outside every package,
so it must go in `turbo.json`'s `globalDependencies` (next to `.node-version`) or lint caches go
stale when the shared rules change.

---

## 2. Highest-severity finding, unrelated to settings: api lint is warning-blind

```jsonc
// apps/api/package.json
"lint": "oxlint --fix",          // ← no --deny-warnings
```

`apps/web`, `packages/ui`, `apps/storybook` all use `oxlint --deny-warnings`. `apps/api` does not,
and `lefthook.yml` runs a bare `pnpm --filter api exec oxlint` for the pre-commit gate. So in both
CI and pre-commit, api's two `warn`-severity rules **can never fail anything**:

- `typescript/no-floating-promises` — unawaited promise in a NestJS service or the pg-boss worker
- `typescript/no-unsafe-argument`

Both are exactly the class of bug that matters in a durable-run worker. api is currently clean
(0 findings, type-aware confirmed engaged at ~6.9 s vs 0.5 s without), so promoting them to `error`
or adding `--deny-warnings` costs nothing today.

Separately and less urgently: `--fix` in the CI `lint` task means CI runs a **mutating** command
whose output turbo caches. It works, but the lint task is no longer a pure check. `lefthook.yml`
already documents "lint jobs are check-only (no --fix): a hook must never mutate files behind the
committer's back" — the same argument applies to CI. Suggest `lint: "oxlint --deny-warnings"` and
`lint:fix: "oxlint --fix"`, matching the other three workspaces.

---

## 3. `overrides` is unused, and it's the fix for the a11y noise problem

No config uses `overrides`. Enabling `jsx-a11y` on `packages/ui` yields 43 findings — but **39 of
them are in `*.stories.tsx`** (illustrative markup like `sidebar.stories.tsx:1281`,
`scroll-area.stories.tsx:106`). Only 4 are in shipped components:

| file                                 | rule                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `src/components/label.tsx:21`        | `label-has-associated-control`                        |
| `src/components/spinner.tsx:18`      | `prefer-tag-over-role` (`role="status"` → `<output>`) |
| `src/components/button-group.tsx:42` | `prefer-tag-over-role` (`role="group"`)               |
| `src/components/field.tsx:103`       | `prefer-tag-over-role` (`role="group"`)               |

An `overrides` entry relaxing `jsx-a11y` on `**/*.stories.tsx` turns "43 findings, mostly noise,
nobody enables it" into "4 real findings, gate it at error." Same shape applies to `**/*.test.*`
and `e2e/**`.

`overrides` also enables the per-directory plugin/env split that `env: { node: true, browser: true }`
currently papers over — `apps/web` declares both globals for every file, so a `document` reference
in a server component or `process` in a client component won't be caught by env alone.

---

## 4. Missing plugins, with measured value

Category effects are isolated from plugin effects here (see §7.2 — this matters, the raw numbers
are misleading otherwise). All counts below are **`correctness` only**, the categories llame
already runs.

| plugin                          | where          |                                                                                                  real catches | noise to disable                           |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------: | ------------------------------------------ |
| **`jsx-a11y`**                  | web, ui        |                                                     web 15, ui 4 (+39 stories); storybook 0 (only 4 TS files) | — (do not add `settings`)                  |
| **`jest`**                      | api            | 29: `no-conditional-expect` ×18, `no-standalone-expect` ×6, `require-to-throw-message` ×4, `expect-expect` ×1 | triage first                               |
| **`vitest`**                    | web, storybook |                                                                 2: `valid-expect`, `require-to-throw-message` | `require-mock-type-parameters` (125) → off |
| **`import`**                    | all            |                                                                                   2 `import/namespace` in web | —                                          |
| `promise`, `node`, `react-perf` | —              |                                                                                            0 at `correctness` | —                                          |

`apps/api` sets `env: { jest: true }` but never lists `plugins`, so it gets the default set
(`react`, `unicorn`, `typescript`, `oxc`) and **no jest rules run at all** — the env flag only
declares globals. Same shape for vitest in `apps/web`/`apps/storybook`.

`jest/no-conditional-expect` ×18 is worth a look on its own: conditional assertions in api tests can
silently assert nothing.

---

## 5. Coverage gap: `e2e/` and root-level files are linted by nothing

There is no repo-root `.oxlintrc.json`, and every lint invocation is `pnpm --filter <ws>`. So
**12 files under `e2e/`** — including `fixtures.ts` (the worker-scoped auth fixture),
`db-server.ts`, `model-server.ts`, `run-after-ready.ts` — plus `playwright.config.ts` are
never linted. These are the files that spawn Postgres containers and stub model servers; they're
also the ones nobody reviews closely.

Cheapest fix that doesn't disturb the nested-config story: a root `.oxlintrc.json` scoped by
`overrides`/`ignorePatterns` to root-level paths, plus a root `lint` script — but see §1 on
`globalDependencies` and the `typeAware` nesting trap before adding one.

---

## 6. Smaller items

- **`categories` drift.** api sets `correctness: "error"`; the other three rely on the default
  `correctness: "warn"` + `--deny-warnings`. Same effective outcome, two mechanisms. Pick one.
- **`options.maxWarnings`** exists and is unused — a way to ratchet down `warn`-severity debt
  instead of the all-or-nothing `--deny-warnings`.
- **`settings.react.version`** unset. Low value; oxlint infers, and llame is uniformly React 19.
- **`$schema` paths** (`./node_modules/oxlint/configuration_schema.json`) resolve per workspace and
  are correct today — but break if you ever hoist to a root-only oxlint install.
- **`jsPlugins`** (alpha) would allow `eslint-plugin-storybook` / `eslint-plugin-playwright`.
  Not recommended yet: alpha, and reserved names (`react`, `jsx-a11y`, `nextjs`, …) need a custom
  `name`, which is a footgun in a shared base config.

---

## 7. Method, and where the obvious answer was wrong

**7.1 — Numbers validated without `--config`.** `--config` disables nested lookup and re-anchors
relative resolution. I re-ran the headline `apps/web` jsx-a11y config by temporarily placing it at
`apps/web/.oxlintrc.json` and invoking bare `oxlint`: identical 15 findings, identical rule
breakdown. The file was restored from a backup and `git status` verified clean.

**7.2 — The 957-finding scare was category-gated, not plugin-gated.** A first "max" run with
`suspicious` + `perf` categories produced 957 `react/react-in-jsx-scope` (spurious under React 19's
JSX transform), 191 `react-perf/*`, and 7 `eslint/no-shadow`. Re-running the _same plugin set_ at
`correctness` only dropped all of them to zero. So the correct claim is **not** "adding plugins is
noisy" — it's **"don't turn on `suspicious`/`pedantic`/`perf` wholesale without a disable list."**
The plugin recommendations in §4 are safe as stated.

**7.3 — `extends` inheritance tested, not assumed.** Base config with `plugins` + `settings`,
child with `"plugins": []` + `extends`. Plugins inherited exactly (jsx-a11y rules fired, no default
plugins re-added). Settings dropped (0 `anchor-has-content` where the direct-settings run produced
10). Both temp files removed, tree verified clean.

**7.4 — Not verified.** `settings.next.rootDir` (never exercised — §0). Whether the 6
`jsx-a11y/no-autofocus` hits in `apps/web` are intentional (dialogs legitimately autofocus; likely
per-site `// oxlint-disable-next-line` rather than a global off). The 4 `prefer-tag-over-role`
and 1 `role-has-required-aria-props` hits are read as plausible-but-untriaged, not confirmed bugs.

---

## 8. Prioritized

1. **`apps/api`: add `--deny-warnings`, split `lint` / `lint:fix`.** Zero-cost today, closes the
   floating-promise hole in the worker path. (§2)
2. **Enable `jsx-a11y` in web and ui — plugin only, no `settings`.** 19 real findings.
   (`apps/storybook` measured at 0 — it holds 4 TS files and no JSX of its own; add it for
   symmetry if you go the shared-base route, not for findings.)
   (§0, §4)
3. **Add an `overrides` entry relaxing a11y/lint on `**/\*.stories.tsx`and tests.** Turns ui's 43
into 4 and makes gating at`error` realistic. (§3)
4. **Add `jest` to api and `vitest` to web/storybook** (with `vitest/require-mock-type-parameters`
   off). 31 findings, `no-conditional-expect` ×18 worth triaging. (§4)
5. **Lint `e2e/` and root-level files.** Currently a blind spot over container/fixture code. (§5)
6. **Then, optionally, a shared base config for `plugins` + `rules` + `overrides`** — knowing
   `settings`/`env`/`categories` won't come along, `"plugins": []` is mandatory in children, and
   turbo `globalDependencies` needs updating. (§1)
7. **Skip:** `settings.jsx-a11y.components`, `settings.react.linkComponents`,
   `settings.next.rootDir`, `jsPlugins`, blanket `suspicious`/`pedantic`/`perf`.

Confidence: **high** on §0, §1, §2, §3, §4, §5 (all measured). **Low** on `next.rootDir`
(unexercised). **Unknown** on whether the 27 false positives would survive a future oxlint release
that understands Base UI's `render` prop.
