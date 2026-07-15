# Documentation authority synchronization plan

> **For agentic workers:** Execute the tasks in order. Keep the canonical documents coherent as one system. Do not commit or push without Leo's explicit request.

**Goal:** Give every durable product claim one canonical owner and remove the stale omnibus specification.

**Architecture:** Keep the stable top-level document paths, but narrow each document to one responsibility. Replace `SPEC.md` in place with a compact current-system contract and link detailed behavior to focused OpenSpec specifications, code-generated API documentation, and schema sources.

**Format:** Markdown, OpenSpec capability specs, generated OpenAPI, and repository source links.

**Status:** Completed on 2026-07-15; left uncommitted pending Leo's next instruction.

---

## Authority contract

| Surface                            | Sole responsibility                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `README.md`                        | Current product overview, shipped baseline, and quickstart                                 |
| `VISION.md`                        | North-star thesis, target users, product loop, principles, horizons, and non-goals         |
| `ROADMAP.md`                       | Forward-only sequence and exit gates; GitHub owns issue status and implementation detail   |
| `SPEC.md`                          | Current cross-cutting architecture, enforced invariants, and links to narrower authorities |
| `openspec/specs/**`                | Normative shipped capability behavior                                                      |
| `openspec/changes/**`              | Proposed deltas and archived implementation records                                        |
| `CHANGELOG.md`                     | Shipped chronology                                                                         |
| `docs/research/**` and dated plans | Noncanonical evidence, uncertainty, decisions, and implementation provenance               |
| `AGENTS.md` files                  | Contributor and runtime instructions                                                       |

## Chunk 1: Canonical documents

### Task 1: Rewrite the canonical document set

**Files:**

- Modify: `README.md`
- Modify: `VISION.md`
- Modify: `ROADMAP.md`
- Modify: `SPEC.md`

- [x] Rewrite `README.md` as the current product overview and quickstart. Separate shipped behavior from direction.
- [x] Rewrite `VISION.md` around the personal-first thesis, compounding context/action loop, durable product bets, horizons, and explicit deferrals.
- [x] Rewrite `ROADMAP.md` as a forward-only execution sequence: v0.6 remote MCP, v0.7 runnable personal knowledge agent, and issue-backed deferred backlog. Link to `VISION.md` instead of duplicating unsequenced horizons. GitHub issues own task status and implementation detail.
- [x] Replace the 3,072-line `SPEC.md` with a **100–150-line** current architecture and authority index.
- [x] Exclude capability schemas, dependency-version snapshots, roadmap content, research surveys, exhaustive API/data-model inventories, and speculative architecture from `SPEC.md`.
- [x] Preserve required legacy section anchors only as concise current-contract headings or redirects to the actual authority. Do not retain obsolete content merely to satisfy a link.
- [x] Verify that no future inventory is presented as shipped behavior and no shipped capability remains in `ROADMAP.md`.

## Chunk 2: Dependent documentation

### Task 2: Repair references and historical status

**Files:**

- Modify: `AGENTS.md`
- Modify: `apps/api/AGENTS.md`
- Modify: `docs/research/product-vision/2026-07-15-working-synthesis/report.md`
- Modify: `docs/superpowers/plans/2026-07-15-minimal-runnable-agent-slices.md`
- Modify: `CHANGELOG.md`
- Modify if required by the inbound-reference audit: active Markdown files, OpenSpec capability specs, and source comments that cite removed `SPEC.md` semantics
- Inspect: `CLAUDE.local.md`

- [x] Encode the document authority map in root contributor guidance and remove stale worker/SPEC claims.
- [x] Correct the API guide's worker and API-contract references without changing operational guidance.
- [x] Mark research and earlier plans as noncanonical provenance whose promoted decisions now live in the canonical documents and GitHub.
- [x] Add a dated changelog entry for the documentation-system rewrite.
- [x] Repair or explicitly retain local-only references in `CLAUDE.local.md`; do not silently leave dead section links.
- [x] Audit every repository reference to `SPEC.md` or `SPEC §`. Update active references whose meaning moved. Historical changelog and archived-change references may remain historical; redirect anchors may preserve valid active links.

## Chunk 3: Verification and review

### Task 3: Prove the documents agree

- [x] Run Prettier over only the changed Markdown files, then run `pnpm exec prettier --check <changed-markdown-files>`; expect exit 0.
- [x] Run `lines=$(wc -l < SPEC.md); test "$lines" -ge 100 && test "$lines" -le 150`; expect exit 0.
- [x] Run `git diff --check`; expect exit 0.
- [x] Validate every relative Markdown link in changed files resolves to an existing repository path or anchor; expect zero broken links.
- [x] Search canonical and contributor documents for the removed stale claims: proof-of-concept status, worker in progress, web BFF, Knowledge-before-MCP ordering, and imported-Markdown-as-authority; expect zero results except explicit historical or exclusion language.
- [x] Search active inbound `SPEC.md`/`SPEC §` references and inspect every result against the replacement anchors or new authority; expect zero references to removed semantics.
- [x] Compare the roadmap's active issues and dependency order with the live GitHub state.
- [x] Review the complete diff for duplicated ownership, speculative commitments, and unrelated edits.
- [x] Leave the work uncommitted unless Leo explicitly requests a commit.
