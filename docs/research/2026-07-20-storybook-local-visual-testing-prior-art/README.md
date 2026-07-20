# Storybook-local visual testing prior art

## Executive Summary

No surveyed project satisfies the requested combination: local capture and storage, baselines adjacent to story sources, exact-candidate approval, and Chromatic-style Storybook status and review integration. The official Chromatic addon supplies the best Storybook interaction contract, but it is a client for a private capture, diff, baseline, and review backend. Its open-source package invokes the Chromatic client and consumes remote GraphQL records and image URLs rather than performing visual testing locally [1].

The strongest implementation path is therefore a repo-local Storybook addon built from selected prior-art patterns, not a wrapper around one existing tool. Use Storybook's native manager panel, toolbar, experimental test-provider, and status store as the UX boundary [1][8][9]. Use Playwright directly for deterministic capture [10]. Use Creevey's artifact and approval semantics: committed baseline separate from ephemeral candidate/diff artifacts, and approval atomically promotes the exact candidate that was reviewed [3]. Use adjacent `__screenshots__` placement demonstrated by Storybook Addon Playwright, but replace its broad Storybook 8-era framework and unsafe unconstrained filesystem assumptions with a small Storybook 10-specific package [6].

Loki and Lost Pixel remain useful engine references, especially around Storybook discovery, Docker reproducibility, and CLI/CI workflows, but neither provides the in-Storybook product experience required here [4][5]. The direct `storybook-visual-regression` addon has the correct UI location but the wrong protocol and approval semantics: it combines multiple transports and performs a new capture when approving instead of promoting the reviewed candidate [2]. reg-suit reinforces the correct separation of expected, actual, and diff artifacts plus explicit new/changed/deleted result classes [7].

Recommendation, confidence high: build `@workspace/storybook-addon-visual-tests` as a compiled package with one typed manager-to-Node protocol, Storybook-index source mapping, Playwright capture, committed source-adjacent baselines, gitignored candidates/diffs, and exact-candidate approval. Start with functional Storybook-native UI. Visual polish and advanced comparison modes can follow without changing the protocol.

## Introduction

This research asks which existing visual-regression systems provide reusable architecture for llame's Storybook 10.5 setup. The target is deliberately narrower than a hosted Chromatic replacement: it is local-first, repository-backed, source-adjacent, and Storybook-first. A successful design must capture stories from the running Storybook, execute their rendered states reliably, compare them with committed baselines, surface status in Storybook, show baseline/candidate/diff images, and approve exactly what the reviewer inspected.

The comparison covers ten primary sources: seven open-source repositories and the official Storybook and Playwright documentation [1]-[10]. Repository claims were checked against librarian-managed checkouts at fixed SHAs where implementation detail was material. The review prioritizes architecture, data integrity, determinism, Storybook compatibility, and extraction potential. Hosted collaboration, billing, cloud browser fleets, and pixel-identical Safari parity are out of scope.

Two assumptions shape the recommendation. First, approved baseline PNGs are committed, while candidate and diff artifacts are stored near them but ignored by Git. Second, UI fidelity is secondary to integration fidelity: status propagation, review identity, filesystem semantics, and rerun behavior must be correct before the panel is polished.

## Main Analysis

## Finding 1: Chromatic defines the UX contract, not the local engine

The official addon is the strongest reference for how visual testing should feel inside Storybook. It registers a Visual Tests panel, uses Storybook's test-provider and status stores, runs tests from Storybook, annotates changed stories in the sidebar, and supports baseline/latest/diff/focus viewing plus per-story and batch acceptance [1][9]. Storybook's addon architecture explicitly separates manager UI, preview annotations, and preset/server behavior, which is the correct package anatomy for an extractable implementation [8].

The open-source boundary is decisive. The addon requires a Chromatic project and user token, invokes `chromatic/node`, and consumes the Chromatic GraphQL API. Build results include remotely computed capture, baseline, diff, and focus image URLs [1]. The CLI's snapshot phase polls a remote build; the repository does not contain the capture fleet, baseline resolver, image comparison service, or review datastore. A local implementation cannot be produced by changing a storage path or replacing authentication.

The reusable parts are the manager interaction model and Storybook status integration. The cloud-specific authentication, project linking, billing, sharing, branch-build selection, and GraphQL layer should be removed. Emulating the complete GraphQL schema would preserve more upstream code but would add a fake service boundary and generated-schema maintenance without improving local behavior. A small local view model is the more durable choice.

## Finding 2: the direct Storybook addon is useful negative prior art

`mjbeswick/storybook-visual-regression` demonstrates that local Playwright execution can be initiated from a Storybook toolbar and reviewed in a Storybook panel [2]. That placement is correct. Its implementation, however, combines a spawned JSON-RPC CLI, a sidecar HTTP server, direct manager RPC, Storybook channel events, and an SSE fallback. The preview iframe participates in transport despite not being the authority for capture or persistence [2]. This is excess machinery for a single-process local addon.

More importantly, its update action starts a fresh update-mode run rather than promoting the candidate displayed to the reviewer. The resulting baseline can therefore differ from the reviewed artifact if the story is nondeterministic or changes between review and update [2]. That violates the central integrity invariant of visual approval. Its result payload also omits a baseline path, so the panel cannot provide the complete baseline/candidate/diff triad [2].

The package targets Storybook 8 development dependencies, lacks a useful Storybook peer range, stores artifacts under a central title-derived hierarchy, and does not use Storybook's test-provider/status model [2]. It should be mined for small UI and orchestration ideas, not adopted or forked as the implementation base.

## Finding 3: Creevey has the correct local review semantics

Creevey provides the best engine and approval model among the surveyed tools. It stores committed reference images separately from ephemeral report artifacts. Comparison materializes expected, actual, and diff images for review. Approval copies the exact selected actual artifact into the baseline directory and updates the result state; it does not recapture [3]. This is the semantic contract llame should preserve.

Its typed protocol is also a useful model. The client and server exchange start, stop, status, approve, approve-all, and incremental result updates over one connection [3]. The review application supports multiple comparison modes, retries, filtering, counts, keyboard flow, and named images [3]. The first release does not need all of that UI, but the backend result must already carry stable candidate identity and URLs for baseline, candidate, and diff. Otherwise later UI polish would require a data-model migration.

Creevey is not a drop-in solution. Its review application runs separately rather than inside Storybook, it does not use Storybook's test-provider/status integration, and it derives baseline paths from story titles rather than the real source import path [3]. It is closer to Storybook 10 than older alternatives but still uses internal Storybook modules. The right move is to borrow its state and approval semantics while retaining Chromatic's in-Storybook placement.

## Finding 4: capture and storage should be smaller than existing addons

Storybook Addon Playwright proves the requested Cypress-style locality: it stores screenshots in `__screenshots__` beside the story file [6]. It also builds story URLs with args and globals, waits for Storybook render completion and fonts, supports browser selection, and captures via Playwright [6]. These are useful concrete patterns.

The package itself is too broad for llame. It targets Storybook 8, brings a large UI and state stack, exposes action recording and editing beyond the requirement, and relies on a substantial dependency graph. Its filesystem helpers resolve caller-provided paths without the source-root confinement needed for a mutation endpoint. Borrow the adjacent path convention and readiness logic, not the package.

Playwright already exposes the deterministic primitives needed here: animation disabling, hidden carets, full-page capture, masks, fixed scaling, injected capture CSS, and PNG output [10]. A focused capture runner can pin locale, timezone, color scheme, reduced motion, viewport, device scale factor, and browser revision. It should wait for Storybook's render completion, `document.fonts.ready`, and two animation frames before applying screenshot-time animation suppression. Story `play` functions run as part of Storybook rendering and therefore become part of the captured state.

The storage identity must not depend on display titles. It should combine the normalized story source path, Storybook story ID, browser key, viewport or mode key, and capture schema version. Storybook's live index exposes the source import path, which allows baselines to live next to the actual `.stories.*` file. Path resolution must canonicalize and verify the result remains beneath configured story roots before any read, write, rename, or delete.

## Finding 5: CLI-focused engines still contribute important constraints

Lost Pixel offers first-class enumeration of stories from built or running Storybooks and separates its open-source engine from its hosted review platform [4]. Loki is purpose-built for Storybook and recommends Chrome in Docker to make results independent of developer operating systems [5]. Both reinforce that capture reproducibility is an environment problem, not only an image-diff setting. Neither supplies the required Storybook-native review and status experience, so wrapping either would still leave most of the product boundary to build.

reg-suit contributes a useful artifact pipeline. It stages actual, expected, and diff directories, reports changed, new, deleted, and passed items separately, supports pixel/rate thresholds and anti-alias behavior, and parallelizes comparison [7]. llame should use the same conceptual states even if the files are source-adjacent rather than centralized. A deleted baseline is not the same as a passed test; a new story with no baseline is a reviewable addition, not an error.

These tools also expose the main failure mode: allowing each developer's host rendering stack to define committed baselines. The initial local-first implementation can run interactively on the host, but CI must define the authoritative environment. Baseline acceptance from a different OS/browser revision must be visibly identified or rejected when metadata does not match. Otherwise the repository becomes a font-rendering churn machine.

## Synthesis & Insights

The evidence converges on a four-layer package. A Storybook manager layer owns toolbar, panel, test-provider registration, sidebar status, and review commands. A Node integration layer runs inside the Storybook dev server and exposes one typed same-origin protocol. A capture/diff layer owns Playwright, deterministic context creation, render readiness, PNG comparison, and incremental results. A storage layer maps Storybook index entries to confined source-adjacent paths and performs atomic candidate promotion.

The core invariant is stronger than "update snapshots": approval must atomically promote the content-addressed candidate identified by the displayed result. The command should include run ID, story key, environment key, and candidate hash. The server verifies those still match before replacing the baseline. If any differ, approval fails closed and asks for a rerun. This prevents the recapture bug seen in the direct addon [2] and preserves Creevey's correct semantics [3].

The protocol should be designed for the mature UI even if the first panel is plain. Each result needs status, story identity, source identity, environment identity, baseline URL/hash, candidate URL/hash, diff URL/metrics, timestamps, and capture error. This is enough for baseline/latest toggles, overlay, spotlight or slider later, without coupling the engine to a particular React composition.

## Limitations & Caveats

The study did not execute every candidate against llame's Storybook 10.5 runtime. Compatibility conclusions are based on package metadata and imports, so runtime breakage confidence is moderate where a package only declares Storybook 8. The recommended implementation avoids that risk by targeting llame's pinned Storybook version directly.

No open-source project supplies Chromatic's standardized multi-browser cloud fleet or branch-aware baseline graph. Local Playwright WebKit is not pixel-equivalent to macOS Safari. The package can support multiple Playwright engines, but reproducible committed baselines require an explicitly controlled environment.

Storybook test-provider and status APIs remain experimental/internal in the current ecosystem. The addon package should isolate those imports behind a thin compatibility module and pin Storybook compatibility rather than pretending the API is stable.

## Recommendations

1. Build a new compiled workspace package rather than adopt or fork an existing addon wholesale.
2. Preserve Chromatic's Storybook-native workflow: run current/all, incremental sidebar status, results panel, rerun, exact-candidate accept, and batch accept after single-item semantics are proven.
3. Use Playwright directly; use one configured browser initially or an explicit environment matrix, never silent host-dependent baselines.
4. Commit only baseline PNGs and a small stable metadata record. Gitignore adjacent run artifacts containing candidate, diff, and transient result metadata.
5. Resolve storage from Storybook's source import path, confine all mutations to configured story roots, and promote candidates with atomic rename plus hash verification.
6. Keep result data rich enough for baseline/latest/diff review even if the initial UI is intentionally plain.
7. Add CI as the authoritative non-interactive runner using the same engine and result schema as the Storybook panel.

## Bibliography

[1] Chromatic (2026). [Visual Tests Addon for Storybook](https://github.com/chromaui/addon-visual-tests).

[2] M. Beswick (2026). [Storybook Visual Regression](https://github.com/mjbeswick/storybook-visual-regression).

[3] Creevey contributors (2026). [Creevey](https://github.com/creevey/creevey).

[4] Lost Pixel contributors (2026). [Lost Pixel](https://github.com/lost-pixel/lost-pixel).

[5] Loki contributors (2026). [Loki: Visual Regression Testing for Storybook](https://github.com/oblador/loki).

[6] storybook-addon-playwright contributors (2026). [Storybook Addon Playwright](https://github.com/ccpu/storybook-addon-playwright).

[7] reg-viz contributors (2026). [reg-suit](https://github.com/reg-viz/reg-suit).

[8] Storybook (2026). [Write an addon](https://storybook.js.org/docs/addons/writing-addons).

[9] Storybook (2026). [Visual tests](https://storybook.js.org/docs/8/writing-tests/visual-testing).

[10] Microsoft (2026). [Playwright `page.screenshot`](https://playwright.dev/docs/api/class-page#page-screenshot).

## Methodology Appendix

Research was conducted on 2026-07-20. External repository code was inspected only from librarian-managed cached checkouts. Material repository claims were anchored to these SHAs: Chromatic addon `391ab35097ca7bdf3b3fc0cd6a10941eba78d7cc`, Storybook Visual Regression `41f02be57c6d6db5d493528e42afaf0eadebd4de`, Creevey `3466f377f7d163628215059249718ad9ba1861ed`, and Storybook Addon Playwright `8cfdf5e2788a52c77d9f421d8195864abefa7bc9`. Official documentation was used for Storybook addon anatomy, target visual-testing behavior, and Playwright screenshot capabilities.

The initial outline treated capture engines and review addons as peers. Evidence changed that structure: the decisive distinction is between engine correctness, approval semantics, and Storybook integration. The final synthesis therefore combines patterns rather than ranking one tool as a winner. Claims were cross-checked against at least one implementation and one independent workflow or official-documentation source where possible. Evidence and source registries are retained in the associated research run artifacts.
