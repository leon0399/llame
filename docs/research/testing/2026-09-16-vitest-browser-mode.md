---
type: Research
title: "Vitest Browser Mode and llame's test harness"
description: "Assesses Vitest 4 Browser Mode against llame's five test layers, measures the jsdom and browser suites, and records why the available simplification is deleting apps/web's duplicate DOM stack rather than migrating harnesses."
tags: [testing, vitest, browser-mode, storybook, playwright, jsdom, coverage]
status: stable
generated: { by: omp/claude-opus-5, at: 2026-09-16T00:00:00Z }
sources:
  - id: vitest-4-announcement
    resource: "https://vitest.dev/blog/vitest-4"
    title: "Vitest 4.0 announcement (2025-10-22)"
  - id: vitest-browser-guide
    resource: "https://vitest.dev/guide/browser/"
    title: "Vitest Browser Mode guide, including Limitations"
  - id: vitest-browser-why
    resource: "https://vitest.dev/guide/browser/why"
    title: "Why Browser Mode: motivation and drawbacks"
  - id: vitest-visual-regression
    resource: "https://vitest.dev/guide/browser/visual-regression-testing"
    title: "Vitest visual regression testing"
  - id: vitest-coverage
    resource: "https://vitest.dev/guide/coverage"
    title: "Vitest coverage providers"
  - id: vitest-performance
    resource: "https://vitest.dev/guide/improving-performance"
    title: "Vitest improving performance: isolation, environments, blob merging"
  - id: vitest-mocking
    resource: "https://vitest.dev/guide/mocking"
    title: "Vitest mocking cheat sheet and Browser Mode warnings"
  - id: storybook-vitest-addon
    resource: "https://storybook.js.org/docs/writing-tests/integrations/vitest-addon"
    title: "Storybook Vitest addon (10.6 docs channel)"
  - id: storybook-nextjs-vite
    resource: "https://storybook.js.org/docs/get-started/frameworks/nextjs-vite"
    title: "Storybook for Next.js with Vite"
  - id: playwright-component-testing
    resource: "https://playwright.dev/docs/test-components"
    title: "Playwright component testing: stories and galleries"
  - id: playwright-release-notes
    resource: "https://playwright.dev/docs/release-notes"
    title: "Playwright 1.62 and 1.63 release notes"
  - id: llame-storybook-vitest-config
    resource: "../../../apps/storybook/vitest.config.ts"
    title: "apps/storybook Vitest projects (unit, storybook browser mode)"
  - id: llame-web-vitest-config
    resource: "../../../apps/web/vitest.config.ts"
    title: "apps/web Vitest config and coverage ratchet"
  - id: llame-testing-doc
    resource: "../../testing.md"
    title: "docs/testing.md layers, rule 5, rule 11, tracked follow-ups"
  - id: llame-ci-workflow
    resource: "../../../.github/workflows/ci.yml"
    title: "CI jobs, including the Playwright-container component job"
  - id: llame-catalog
    resource: "../../../pnpm-workspace.yaml"
    title: "Dependency catalog: vitest, playwright, storybook pins"
---

# Vitest Browser Mode and llame's test harness

Noncanonical research. Date: 2026-09-16. Inspected versions: `vitest` 4.1.11,
`@vitest/browser-playwright` 4.1.10, `storybook` and `@storybook/addon-vitest`
10.5.0, `playwright` and `@playwright/test` 1.55.1, `jsdom` 28.1.0. Upstream
citations are to current documentation. `docs/testing.md` and the OpenSpec
specs win any disagreement with this file.

## Verdict

llame already runs Vitest Browser Mode in CI. `apps/storybook/vitest.config.ts`
declares a `storybook` project with `browser.enabled: true`,
`provider: playwright()` and `instances: [{ browser: "chromium" }]`[^llame-storybook-vitest-config],
and the `component` job executes it inside
`mcr.microsoft.com/playwright:v1.55.1-noble`[^llame-ci-workflow]. There is no
harness to migrate **to**.

What is worth doing is not adopting a tool; it is deleting the second DOM
testing stack sitting next to the one already in browser mode. `apps/web`
carries 59 files that opt into jsdom with a `// @vitest-environment jsdom`
comment, 55 of which render through `@testing-library/react`, against 19 story
files for the same app. `docs/testing.md` rule 5 already says DOM and
interaction assertions belong in story play functions, and its tracked
follow-ups already say to move them[^llame-testing-doc]. The blocker is not
Browser Mode's maturity — it is that `apps/web`'s coverage ratchet
(`thresholds: { lines: 88, statements: 86 }`)[^llame-web-vitest-config] is
measured by `pnpm --filter web test:coverage`, which never sees the story
project's coverage. Every migrated file removes coverage from a threshold the
repository rules forbid lowering.

## Measured baseline

Both runs on this workstation, 2026-09-16, sequentially, nothing else running.

| Suite                            | Environment            | Files | Tests | Wall   | Per file | Per test |
| -------------------------------- | ---------------------- | ----- | ----- | ------ | -------- | -------- |
| `pnpm --filter web test`         | node + per-file jsdom  | 101   | 748   | 35.81s | 0.35s    | 48ms     |
| `vitest run --project storybook` | browser mode, chromium | 65    | 321   | 41.48s | 0.64s    | 129ms    |

Phase breakdowns as Vitest reports them (sums over parallel workers, so larger
than wall time)[^vitest-performance]:

- web: `transform 19.74s, import 206.09s, tests 151.20s, environment 109.31s`
- storybook: `transform 0ms, setup 142.03s, import 92.09s, tests 106.18s`

Three readings matter more than the headline ratio:

1. Browser mode costs about 2.7x per test and 1.8x per file here. That is a
   real cost, not a cliff. Both suites finish in under a minute.
2. jsdom is not free. 109s of cumulative `environment` time across 59 jsdom
   files is ~1.8s per file, consistent with Vitest's documented 200-500ms per
   jsdom import plus window construction[^vitest-performance]. Moving a file
   from jsdom to a browser iframe trades that cost for a browser-side one
   rather than adding a new one.
3. `import 206.09s` dominates the web run. That is isolation re-evaluating a
   shared module graph per file, and it is independent of this question. See
   [F4](#f4-the-web-suite-has-a-cheaper-win-than-any-of-this).

The browser run could not execute on this host: `browserType.launch` fails with
23 missing system libraries (`libglib-2.0.so.0`, `libnss3.so`, `libX11.so.6`,
and the rest of the Chromium set). It was measured inside the same Playwright
container CI uses. Nix manages this workstation, so those libraries are a
dotfiles change, not `playwright install --with-deps`.

## What Browser Mode is

Vitest serves test files to a real browser through the Vite dev server and
drives them with a provider; each test file runs in its own iframe while the
Node side orchestrates and collects results[^vitest-browser-guide]. Since
Vitest 4 the provider is a separate package — `@vitest/browser-playwright`,
`@vitest/browser-webdriverio`, or `@vitest/browser-preview` — and 4.0
(2025-10-22) removed the experimental tag, replacing the provider string with a
function call[^vitest-4-announcement]. That is the shape
`apps/storybook/vitest.config.ts` already uses.

The parts relevant to a repository that already owns Playwright and Storybook:

- **Locators and retrying assertions.** `page.getByRole(...)`,
  `expect.element(...)`, and a `userEvent` backed by CDP rather than
  synthesized events. Vitest forks `@testing-library/jest-dom` so its matchers
  are built in, and recommends its own `userEvent` over
  `@testing-library/user-event`, which only simulates
  events[^vitest-browser-guide].
- **Visual regression.** `toMatchScreenshot` with `pixelmatch`, references in
  `__screenshots__/<file>/<name>-<browser>-<platform>.png`, `--update` to
  rebaseline. Vitest's own guidance: keep the visual suite in a separate
  project, run it headless with a pinned viewport, and expect environment
  sensitivity; stale references are not pruned
  automatically[^vitest-visual-regression].
- **Playwright traces.** `--browser.trace=on` (also `on-first-retry`,
  `retain-on-failure`), surfaced as test annotations and openable in the
  Playwright trace viewer[^vitest-4-announcement].
- **Coverage.** The `v8` provider collects through CDP in Chromium-based
  browsers, with AST-aware remapping since 3.2, so its accuracy matches
  Istanbul. Firefox and WebKit are out[^vitest-coverage].
- **Cross-run merging.** `--reporter=blob` plus `vitest run --merge-reports`
  merges results, and coverage, from separate runs[^vitest-performance]. This
  is the mechanism that could make a split unit/browser coverage gate work.

Limitations that are structural rather than teething:

- **Not an E2E runner.** Vitest states that Browser Mode "does not completely
  replace standalone end-to-end test runners" and recommends keeping
  one[^vitest-browser-why].
- **No module-namespace spying.** `vi.spyOn(namespaceImport, "method")` throws,
  because native ESM namespace objects are sealed; the workaround is
  `vi.mock("./mod.js", { spy: true })`. `vi.mock` itself
  works[^vitest-browser-guide][^vitest-mocking].
- **Blocking dialogs.** `alert`, `confirm` and `print` are auto-mocked because a
  blocking dialog deadlocks the runner[^vitest-browser-guide].
- **Longer initialization** than a Node pool, and the browser must exist on the
  machine[^vitest-browser-why].

## What llame already runs

| Layer       | Runner                                                                                                               | Scope                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest, node pool                                                                                                    | apps/api 197, apps/web 43 non-jsdom, packages ~16                                                         |
| jsdom DOM   | Vitest, per-file `@vitest-environment jsdom`                                                                         | apps/web 59 files, 55 of them rendering via testing-library                                               |
| Component   | **Vitest Browser Mode**, chromium via `@vitest/browser-playwright`, stories transformed by `@storybook/addon-vitest` | 65 story files / 321 tests: packages/ui 46 stories (35 with `play`), apps/web 19 stories (18 with `play`) |
| Integration | Vitest + Testcontainers Postgres                                                                                     | apps/api 66                                                                                               |
| Product E2E | Playwright 1.55.1                                                                                                    | 14 specs, 5,034 lines including a 1,102-line mock model server; 6 web servers plus Postgres               |

The addon is the same architecture as raw Browser Mode: it transforms stories
into Vitest tests through portable stories and runs them in Playwright's
Chromium, smoke-testing each story and executing its play
function[^storybook-vitest-addon].

### F1 the duplication is inside `apps/web`, not between tools

41 `.test.tsx` files call `render`/`screen` in jsdom; 19 story files cover the
same app in a real browser. Several pairs are the same component twice, with
the jsdom copy larger: `chat-item.test.tsx` (~530 lines) beside
`chat-item.stories.tsx`, `command-palette.render.test.tsx` (~505 lines),
`chat-page.target.test.tsx` (~530 lines). Two styles, two environments and two
sets of assertions for one component is the actual cost, and it is what rule 5
forbids for new work[^llame-testing-doc].

### F2 the jsdom residue is legitimate and should stay jsdom

Roughly 20 of the 59 files are `renderHook` against TanStack Query caches and
headless hooks (`lib/services/**/queries.test.ts`,
`lib/services/**/mutations.test.*`, `hooks/use-cookie.test.ts`). They render no
component tree and assert no DOM; a browser gives them nothing. A further
handful mock `next/headers` and `next/server` for App Router page modules and
cannot run in a browser at all.

### F3 migration friction is lower than the folklore suggests

The only namespace imports in `apps/web` tests are `import * as React from
"react"`, so nothing spies on a module namespace and Browser Mode's one hard
mocking limitation does not bite. The 30 `vi.mock` calls target
`next/navigation` and `@ai-sdk/react`, both supported, and
`@storybook/nextjs-vite` already stubs Next's router and navigation for the
story path with mock functions assertable through the ordinary `vi`
API[^storybook-nextjs-vite]. msw is absent from the repository, so there is no
request-mocking layer to port.

### F4 the web suite has a cheaper win than any of this

`import 206.09s` against `tests 151.20s` says isolation is re-evaluating a
shared module graph 101 times. `vitest doctor` measures `isolate: false` and
pool alternatives directly instead of estimating them, and
`experimental.diagnostics` prints a hint when a configuration change would
help[^vitest-performance]. That is a one-command experiment with no test
rewrites and no bearing on Browser Mode.

### F5 Playwright moved its component story in a direction llame should ignore

Playwright 1.62 replaced `@playwright/experimental-ct-*` with a
stories-and-gallery model: you serve a gallery page from your own dev server,
and `mount('components/Button/Primary')` navigates to it. 1.63 stopped updating
the experimental packages entirely[^playwright-release-notes]. The stated
reason for the rewrite — owning the bundler pipeline was untenable, and module
mocks silently did not apply[^playwright-component-testing] — is the same
reason `@storybook/addon-vitest` runs stories through Vite. llame already has a
gallery: Storybook. Adopting Playwright CT would add a third component-test
pattern with no capability llame lacks. Separately, the repo is 8 minors behind
on Playwright (1.55.1 against 1.63), and the pin is coupled to the CI container
digest[^llame-catalog][^llame-ci-workflow].

## Risks

**R1 coverage accounting blocks the migration the docs already mandate.**
`apps/web`'s 88%/86% ratchet comes from `vitest run --coverage` inside
`apps/web`[^llame-web-vitest-config]; story coverage is produced by the
`storybook` workspace in a different CI job[^llame-ci-workflow]. Moving a jsdom
render test into a story removes its contribution from the gate, and `AGENTS.md`
prohibits lowering the threshold to admit it. This is the only mechanical
obstacle I can find to the tracked follow-up, so it is most likely why the
follow-up has not moved (inference). Resolving it is a deliberate decision, not
a config tweak: merge coverage across projects with `--reporter=blob` plus
`--merge-reports`, or move the DOM files into a browser project _inside_
`apps/web` so coverage stays in that workspace's run.

**R2 more browser tests means more of the suite is CI-only on this
workstation.** The component layer cannot run here today. Every file moved from
jsdom to a browser project becomes unrunnable locally until the Chromium system
libraries land in the Nix profile. E2E is already effectively CI-only on this
box per `CLAUDE.local.md`.

**R3 visual regression overlap.** Vitest 4 ships `toMatchScreenshot`, and
addon-vitest stories already execute in browser mode, so a play function could
call it directly. `storyproof` (first-party, `0.0.1-alpha.1`) covers the same
ground with Storybook UI integration. Two screenshot mechanisms in one suite is
a decision to make consciously, not to discover later.

**R4 rewriting tests is the risk, not switching environments.** A jsdom test
translated into a story play function is a new test with a new oracle. Done in
bulk without reading each assertion, it launders coverage into tautologies —
precisely what rule 11 rejects[^llame-testing-doc].

## Options

| ID  | Option                                                                                                                           | Deletes                                                                                    | Costs                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| O1  | Move the ~20 genuinely component-level jsdom render tests into stories; keep hook and query tests in jsdom                       | ~20 duplicate test files; the larger half of the jsdom surface                             | blocked by R1; each file needs its assertions re-derived                                                               |
| O2  | Add a `browser` project to `apps/web`, move all 55 testing-library files into it, drop `jsdom` and `@testing-library/user-event` | the `jsdom` dependency, the per-file `@vitest-environment` convention, one DOM environment | keeps the duplication with stories; the `unit` CI job needs a browser; slower for tests that never needed one          |
| O3  | Both: stories own component behavior, a small browser project owns hook tests                                                    | jsdom entirely                                                                             | largest diff; touches every DOM test in the repo                                                                       |
| O4  | Leave the harness alone; attack the `import`-phase cost with `vitest doctor` and `isolate`/pool tuning                           | nothing                                                                                    | none beyond measurement                                                                                                |
| O5  | Replace `storyproof` with `toMatchScreenshot` in play functions                                                                  | one first-party addon                                                                      | loses Storybook-UI visual review; rebaselining moves to `--update` and committed PNGs                                  |
| O6  | Replace product E2E with Browser Mode                                                                                            | nothing worth having                                                                       | rejected: Vitest says it is not an E2E replacement, and the suite orchestrates 6 servers, Postgres and multi-page auth |

## Recommendation

**A1. Settle R1 first, as a standalone change.** Decide where web component
coverage is measured before moving a single test: either run the `web` and
`storybook` projects with `--reporter=blob` and gate on
`vitest run --merge-reports --coverage`, or accept O2's in-workspace browser
project. Everything else queues behind this one decision.

**A2. Then execute O1 on the clearest duplicates only.** `chat-item`,
`command-palette`, `chat-list`, `project-item` — components whose jsdom test is
longer than the component and whose story already exists. Read each assertion,
port the ones with an independent oracle, and delete the rest instead of
translating them. Expect roughly +13s on the component job and a comparable cut
to the unit job (inference, extrapolated from the measured per-file costs).

**A3. Run O4 independently, this week.** `vitest doctor` in `apps/web` is a
single command, the `import`-phase number says it will find something, and it
carries no migration risk.

**A4. Do not adopt Playwright component testing, and do not move E2E.** Keep
Playwright for the product flow and Storybook as the gallery. Bump Playwright
1.55.1 to 1.63 as ordinary maintenance, remembering that `playwright`,
`@playwright/test` and the CI container digest move together.

**A5. Leave O5 alone until `storyproof` has a reason to go.** Vitest's own
guidance treats visual tests as a complementary layer with environment
sensitivity worth isolating[^vitest-visual-regression], which argues for
keeping a dedicated visual mechanism rather than folding screenshots into
behavior tests.

**A6. Install the Chromium system libraries on this workstation** through the
Nix dotfiles. Not urgent for the harness; decisive for whether R2 gets worse.

## Method and limitations

Upstream evidence comes from the cited Vitest, Storybook and Playwright
documentation. Repository facts come from a read-only inventory of
`pnpm-workspace.yaml`, every `vitest.config.*`, workspace `package.json`
scripts, `turbo.json`, `.github/workflows/ci.yml`, `apps/storybook/.storybook/*`,
and file censuses over `apps/web`, `packages/ui`, `apps/api` and `e2e/`.

Timings are single runs on one WSL2 workstation; the browser figure additionally
carries Docker overhead on a bind-mounted `node_modules`, so it is an upper
bound rather than a CI prediction. No CI measurement was taken. The per-file
extrapolation in A2 is inference. Individual test-file line counts in F1 are
approximate, derived from file size.

[^vitest-4-announcement]: [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4)

[^vitest-browser-guide]: [Vitest Browser Mode guide](https://vitest.dev/guide/browser/)

[^vitest-browser-why]: [Why Browser Mode](https://vitest.dev/guide/browser/why)

[^vitest-visual-regression]: [Visual regression testing](https://vitest.dev/guide/browser/visual-regression-testing)

[^vitest-coverage]: [Coverage providers](https://vitest.dev/guide/coverage)

[^vitest-performance]: [Improving performance](https://vitest.dev/guide/improving-performance)

[^vitest-mocking]: [Mocking cheat sheet](https://vitest.dev/guide/mocking)

[^storybook-vitest-addon]: [Storybook Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)

[^storybook-nextjs-vite]: [Storybook for Next.js with Vite](https://storybook.js.org/docs/get-started/frameworks/nextjs-vite)

[^playwright-component-testing]: [Playwright component testing](https://playwright.dev/docs/test-components)

[^playwright-release-notes]: [Playwright release notes](https://playwright.dev/docs/release-notes)

[^llame-storybook-vitest-config]: [apps/storybook/vitest.config.ts](../../../apps/storybook/vitest.config.ts)

[^llame-web-vitest-config]: [apps/web/vitest.config.ts](../../../apps/web/vitest.config.ts)

[^llame-testing-doc]: [docs/testing.md](../../testing.md)

[^llame-ci-workflow]: [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)

[^llame-catalog]: [pnpm-workspace.yaml](../../../pnpm-workspace.yaml)
