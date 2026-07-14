# GitHub Copilot Memory — exploration notes (2026-07-05)

Sources: [official docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory), [GitHub engineering blog "Building an agentic memory system for GitHub Copilot"](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/), [changelog 2026-05-26](https://github.blog/changelog/2026-05-26-copilot-memory-has-more-controls-for-deletion-scope-and-the-copilot-cli/), [copilot-cli#1443](https://github.com/github/copilot-cli/issues/1443), plus a direct probe of Copilot CLI 1.0.68 (`copilot -p ... --enable-memory`; tools are **server-side runtime tools**, not in the CLI bundle — confirmed by bundle grep).

## Scope model (public preview, all paid plans)

Two scopes, hard-split:

| Scope                                                                                           | Visibility                                  | Usable where                          | Created by                       | Managed by                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Repository-level facts** (conventions, architecture decisions, build commands, project rules) | all users with repo access + memory enabled | **only** operations on that same repo | only users with **write access** | repo owners can review/delete; repo admins can disable per-repo                                                   |
| **User-level preferences** (stated/implied personal workflow prefs)                             | that user only                              | across all repos                      | the user's own interactions      | user views/deletes; org/enterprise admin can export/delete (Business/Enterprise); owned by the **billing entity** |

Cross-feature: facts learned by cloud agent are used by code review and CLI (CLI applies only initiating-user's memories; code review uses repo facts only). Opt-in per user; admins gate via policy.

## The tools (from CLI probe — reconstructed, CLI declined verbatim dump)

- **`store_memory`**: `subject` (short), `fact`, `citations` (references to supporting code/source — mandatory), `reason` (why remember — mandatory), `scope` (user | repository).
- **`vote_memory`**: `fact` (exact), `direction` (`upvote` | `downvote`), `reason` (mandatory), optional `scope`.

Policy given to the agent (paraphrased from its hidden instructions): store only durable cross-task facts; never ephemeral/sensitive/secret; **check for duplicates first — vote instead of re-storing**; upvote when verified useful/correct, downvote when wrong/stale/contradicted; user scope only for the current user's prefs; citations + reasoning always required. The store_memory permission prompt tells the user which scope the entry will land in (changelog 2026-05-26). "Forget X" in chat → down-votes the memory + points user to the deletion surface.

## Lifecycle — the notable engineering

1. **Citations + recall-time validation.** Repo facts are stored with citations to specific code locations. At recall, the agent verifies citations against the _current branch_; only validated facts are used. If code contradicts the memory or citations dangle → agent stores a corrected version; if citations check out and the memory helped → agent re-stores/upvotes to refresh it.
2. **Decay = 28-day unused TTL**, timer reset on validated use. No scored decay curve, no Ebbinghaus — shipped forgetting is a dead-simple usage-clock.
3. **Storage is server-side**, injected as a `<repository_memories>` block into the system prompt each session (copilot-cli#1443) — i.e., eager injection of the whole (small) validated fact set, same L0/L1 shape as everyone else.
4. **Evaluation** (engineering blog): agents populated memory organically over historical tasks with deliberately over-represented noise (abandoned/unmerged branches); result **+3% precision / +4% recall** in Copilot code review. Adversarial test: seeded contradicting memories with irrelevant/nonexistent citations — agents "consistently verified citations, discovered contradictions, and updated incorrect memories."

## Relevance to llame (delta vs CROSS-REPORT.md)

Copilot Memory independently confirms the cross-report's core choices — two scopes with container-style inheritance, small validated fact set eagerly injected, write-gating by role, user-visible deletion. Four things it _adds_:

1. **`vote_memory` is the missing write path for our signal columns.** The cross-report schema has `confirmations`/`contradictions` but only consolidation writes them. Copilot's move: make voting an **agent tool used during normal work** — recall → use → up/downvote with a reason. Signal collection becomes free and continuous instead of batch-only. llame should plan `memory_vote` as an agent tool alongside `memory_store`/`memory_search`, feeding the same columns (+ an audit row: who/what voted, when, why — fits the provenance model).
2. **Citations as first-class, plural, and _verified at recall_.** Stronger than our single `origin_chat_id`/`origin_run_id`: a memory can cite multiple sources (messages, wiki notes, artifacts), and staleness is handled by _validation at read time_ against current state, not only by bi-temporal invalidation at write time. Bi-temporal catches contradictions the system observed; citation-verification catches drift it never observed (wiki note edited, artifact deleted). Cheap llame version: `memory_citations` table (memory_id → cited entity ref), verify-on-recall deferred but the data model ready. Their adversarial result is also the best empirical evidence yet that citation verification blunts memory poisoning — directly relevant to the MINJA-class risk in the main report.
3. **Shipped decay is a usage-TTL, not a formula.** The biggest production memory system on earth forgets via "unused for 28 days → delete, validated use resets the clock." Strong support for the cross-report's signals-first stance — and a hint that `support_weight` v1 could be even simpler than the sketched formula: `last_validated_use_at` + TTL, with scoring only as retrieval ranking.
4. **Vote-don't-duplicate as the dedupe primitive.** Consolidation's dedupe step gets a cleaner contract: on encountering an existing equivalent fact, vote it up (refresh) instead of inserting — reinforcement and dedupe become the same operation.

One caveat: the +3/+4pp eval is GitHub's own, unreproduced, on code review specifically — treat as directional, not as proof memory lifts task quality generally (the field-wide caveat from the main report stands).

## CLI probe log

- `copilot -p` without `--enable-memory`: store/vote tools absent; system prompt still references `store_memory` (session_store_sql "preferred over store_memory" note) — memory disabled by default in prompt mode, `--enable-memory` flag enables.
- Tools are not in the nix-store CLI bundle (only changelog.json mentions) → delivered server-side per session ("runtime-tools" namespace).
