---
name: iterative-review-refinement
description: Use when refining a design memo, research report, plan, RFC, technical spec, or analysis document after the initial draft is complete. Triggers before any commitment that makes errors expensive — opening a PR, starting implementation, briefing stakeholders, or archiving as canonical reference.
---

# Iterative Review Refinement

## Overview

**One reviewer is anecdote. Two parallel reviewers with independent defaults are signal. Convergence — not round count — is the stop condition.**

Documents that look right on first pass routinely contain factual errors, stale cross-references, and subtle logic gaps that a single careful read won't catch. The fix is not "read more carefully" — it's pressure-testing via independent reviewers, verifying each load-bearing finding against primary sources, and iterating until both reviewers stop finding substantive issues.

This is TDD for documents. The draft is production code. Reviewers are tests. Convergence is green.

## When to Use

- Finished initial draft of a design memo, research report, plan, RFC, analysis, or technical spec
- Document will inform load-bearing decisions or land in a PR
- Errors are costly to find later (after merge, after implementation starts, after stakeholders rely on it)
- You're tempted to ship after one read-through because "it looks right"

**Don't use for:**
- Scratch notes, single-paragraph comments, ephemeral text
- Documents already gated by mandatory human review with equivalent rigor
- Trivial fixes where review overhead exceeds value
- Code: use code-review skills instead (this is for prose deliverables)

## Core Loop

```
1. Draft vN exists, ready for adversarial review
       │
       ▼
2. Dispatch ≥2 INDEPENDENT reviewers in PARALLEL
   - Adversarial tool (e.g. Codex / dedicated review agent)
   - General-purpose subagent briefed with full context
       │
       ▼
3. Synthesize findings: dedupe across reviewers, classify P0 / P1 / P2
       │
       ▼
4. INDEPENDENTLY VERIFY each load-bearing finding against primary sources
   (do NOT trust the reviewer's assertion — check it yourself)
       │
       ▼
5. Apply verified fixes → bump version (vN → vN+1) → write revision-history entry
       │
       ▼
6. Converged?  ── no ──▶ back to step 2
                  │
                 yes
                  ▼
               ship
```

## Briefing the Reviewers

Reviewers default to thin context. Parallel reviewers regress to single-reviewer signal if both are briefed poorly. Brief each one explicitly:

- **Paste prior-round findings verbatim** so the new round doesn't re-flag already-fixed issues
- **Name files with full absolute or repo-relative paths** — don't make reviewers grep
- **For gitignored targets, drop `--base` flags** (some review tools bail on gitignored content otherwise)
- **Tell general-purpose agents to use the project runtime** (e.g. `uv run python3`, `bun run`) for arithmetic and code checks — not the global interpreter
- **State the document's purpose and load-bearing claims**: what decisions does it gate, what's already been verified, what's known to be uncertain
- **List the supporting artifacts** (e.g. `sources.jsonl`, `bibliography.bib`, companion notebooks) and ask reviewers to check consistency across them

A thin brief produces thin findings.

## Verify Before Fix

A reviewer pointing at a "bug" can be:
- **Right** → apply the fix
- **Wrong about the primary source** → cite back, don't apply, document the disagreement
- **Right about the symptom but wrong about the cause** → apply a different fix targeted at the actual cause

**Always verify load-bearing findings against primary sources before changing the document.** Especially:
- Version numbers, arXiv IDs, DOI strings, paper titles, author lists
- File paths, function names, API signatures, deprecation status
- Units, sign conventions, coordinate frames, axis orientations
- Numeric values, equation coefficients, table entries

Use WebFetch on the abstract page. Grep the repo. Run the snippet under the project runtime. Don't apply a fix because a reviewer asserted it confidently — reviewers (including AI agents) hallucinate.

## Convergence Criteria

**Converged** when ALL of:
- Both (≥2) reviewers ran this round
- Neither found new P0 or P1 issues
- Remaining items are P2 nits, stylistic preferences, or explicitly out-of-scope
- This round produced zero substantive content changes (or only formatting/wording)

**NOT converged** when ANY of:
- Only one reviewer ran this round
- The previous round produced substantive fixes — run at least one more round
- You stopped because of fatigue, time pressure, or an arbitrary round budget
- A finding was dismissed without verifying against primary sources

Convergence is empirical. It is not a budget.

## Revision Tracking

Bump version on every fix-and-redraft cycle (v9 → v10 → v11). Maintain a revision-history section inside the document:

```markdown
## Revision history

- **v11 (YYYY-MM-DD):** Fixed Marigo+2017 arXiv ID typo (1701.04915 → 1701.08510, PR review). Set izzard2004 repo_path to null (path didn't exist).
- **v10 (YYYY-MM-DD):** Reconciled residual framing to cell-coverage metric (was per-star). Corrected slope arithmetic (~47 K → ~135 K).
- **v9 (YYYY-MM-DD):** Initial draft.
```

This:
- Lets the next round's reviewers see what's been addressed (and not re-flag it)
- Creates an audit trail when stakeholders ask "why did this change?"
- Forces you to articulate each fix — vague entries reveal vague reasoning

## Keep Supporting Artifacts in Sync

If the main document references companion files (sources lists, bibliographies, claims/evidence ledgers, sample data, code snippets), **fix all copies in the same commit**. A reviewer that finds a stale reference in one file but not another correctly concludes you don't know which is authoritative — and the next round flags every other file too.

Run a grep for the changed token across the whole repo before committing the fix.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Codex found nothing this round, we're done" | One reviewer is one reviewer. Run the second before claiming convergence. |
| "I've done 3 rounds, that's enough" | Convergence is empirical. If round 3 produced substantive fixes, round 4 is required. |
| "The fix is obvious, I'll skip verification" | A meaningful fraction of "obvious" fixes apply the wrong patch to the right symptom. 60 seconds of verification beats an hour of rework. |
| "Reviewer said X is wrong, so X is wrong" | Verify against the primary source. Reviewers hallucinate, misread, and reason from stale training data. |
| "The supporting files are nits, I'll batch them later" | Stale references in supporting files invite next-round flags on already-fixed issues. Fix all copies in the same commit. |
| "I disagree with the finding, so I'm dropping it" | Document the disagreement WITH the primary-source citation that supports your position. Silent dismissal looks like sloppiness in the next round. |
| "It's already good enough" | If independent reviewers are still finding load-bearing issues, it isn't. |
| "Round-tripping with the reviewer is overkill for this doc" | If you're tempted to skip, the doc probably wasn't important enough to write down in the first place. Either skip the doc or run the loop. |

## Red Flags — Not Converged

- Ran only one reviewer this round
- Applied a fix without checking the primary source
- Called convergence after a round that produced substantive changes
- Reviewer flagged a stale cross-reference you "already fixed" — you only fixed one copy
- Bumped the version but didn't write a revision-history entry
- Reviewers contradict each other and you picked the one you agreed with without independent verification
- Only cosmetic changes between the last two rounds (possible Goodhart — verify the underlying claims are still sound)
- You stopped because you ran out of energy

Any of these means: not converged. Continue the loop.

## What "Good" Looks Like

A successfully refined document leaves a trail:

1. ≥2 review rounds, each with ≥2 independent reviewers
2. A revision history with one entry per cycle, naming the specific fixes
3. Verified primary-source citations for every load-bearing change
4. Supporting artifacts (bibliographies, sources lists, code references) consistent across the repo
5. A final round that produced zero substantive changes
6. Reviewers' remaining findings are P2 nits or explicit non-goals — documented, not silently dropped

If you can't point to all six, you're not done yet.
