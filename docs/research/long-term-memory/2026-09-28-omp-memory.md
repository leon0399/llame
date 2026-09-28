# OMP memory: local pipeline, Mnemopi and a live installation

Surveyed 2026-09-28. Noncanonical: evidence and transfer ideas, not a decision.

Source is pinned to the installed release, oh-my-pi `v18.2.10`
([`da58b16f`](https://github.com/can1357/oh-my-pi/tree/da58b16f424273605795435a6753778f422baff3)).
Live observations come from one workstation running that binary with
`memory.backend: local`, `autolearn.enabled: true` and `autolearn.autoContinue: true`,
read through a read-only SQLite handle on `~/.omp/agent/agent.db` and the files under
`~/.omp/agent/memories/`. Nothing was modified or re-run.

## Summary

OMP's default memory (`local`) is two independent channels that never block a turn:

1. **Offline distillation.** At startup, a background job extracts each idle past
   session into a raw memory, then a second model consolidates them into
   `MEMORY.md`, a short `memory_summary.md` and generated skill playbooks.
2. **In-loop capture.** The `learn` tool appends explicit lessons to `learned.md`;
   with `autoContinue`, a detached agent is asked to capture lessons after a
   tool-heavy turn.

Both surface in the next session as one capped `Memory Guidance` block, frozen for
the session so it does not churn the prompt-cache prefix. The design is cheap and
unobtrusive. On this machine, its measured weakness is coverage: the extractor
saw a median 1.8% of each session, and about 73% of captured lessons never reach
the prompt.

```text
session JSONL ──(startup, idle ≥12h)──▶ stage 1 (default role) ──▶ agent.db stage1_outputs
                                                                        │ dirties global:<cwd>
learn / auto-capture ──▶ learned.md                                     ▼
        │                                         phase 2 (smol role, lease + heartbeat)
        │                                            ├─ MEMORY.md
        │                                            ├─ memory_summary.md
        │                                            └─ skills/<name>/SKILL.md
        └──────────────┬─────────────────────────────┘
                       ▼
        next session: summary + lessons ≤ 5,000 approx tokens → system prompt
```

## Mechanics

**M1 — Scope is the literal working directory.** The memory root is
`memories/<cwd with separators replaced by ->` wrapped in `--…--`
([index.ts L1292–L1293, L1434–L1436](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L1434-L1436)).
POSIX paths are not normalized; Windows paths are only lowercased
([storage.ts L55–L64](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/storage.ts#L55-L64)).
The Hindsight backend, by contrast, folds every linked worktree to the primary
checkout root ([docs/memory.md L148](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/docs/memory.md#L148)).

**M2 — Gating.** The pipeline runs only for the top-level, persisted session
(`taskDepth === 0` plus a session file) and never for subagents
([index.ts L133–L151](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L133-L151)).
Stage 1 considers sessions idle for at least 12 hours and younger than 30 days,
and excludes the active one.

**M3 — Queue, leases and watermarks in SQLite.** `agent.db` holds `threads`,
`stage1_outputs` and a composite-key `jobs` table with owner token, lease,
retry counter, input watermark and last-success watermark
([storage.ts L67–L109](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/storage.ts#L67-L109)).
A session is re-extracted only when its file mtime passes the stored
`source_updated_at`. A job that fails three times becomes terminal until the
session file changes again, and a "no durable signal" answer completes the job
and deletes any old output
([storage.ts L319–L408](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/storage.ts#L319-L408)).
Phase 2 claims only `global:<current cwd>`
([index.ts L489–L507](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L489-L507)).

**M4 — Stage 1 sees the bookends of a session.** All system, user and assistant
messages pass the filter, including stored thinking blocks. Tool results pass only
for `bash`, `eval`, `read` and `grep` and only under 32,000 characters
([index.ts L719–L731](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L719-L731)).
The kept messages are serialized to one JSON string and cut to
`min(phase1InputTokenLimit = 4000, 0.7 × context)` approximate tokens
([index.ts L770–L781](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L770-L781)).
The cut keeps the first 60% and last 40% of the character budget
([index.ts L1236–L1243](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L1236-L1243)):
at the default, 9,600 characters of the opening and 6,400 of the ending. The
prompt asks for strict JSON with `rollout_summary`, `rollout_slug` and
`raw_memory`, keeping "constraints, decisions, workflows, pitfalls, resolved
failures" and dropping "transient chatter"
([stage_one_system.md](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/prompts/memories/stage_one_system.md)).
Output is secret-redacted before it is stored.

**M5 — Phase 2 rebuilds from raw memories.** Rollout summaries become
`rollout_summaries/<thread>-<slug>.md` and `raw_memories.md` is regenerated. The
consolidator gets them truncated to about 20,000 and 12,000 tokens, with an
8,192-token answer budget
([index.ts L918–L938](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L918-L938)).
It returns `memory_md`, `memory_summary` and `skills[]`; skills it omits are
pruned from disk, and outputs are redacted
([index.ts L952–L1040](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L952-L1040)).
A lease with a 30-second heartbeat prevents two processes from consolidating the
same scope; losing ownership aborts the write
([index.ts L555–L599](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L555-L599)).
The previous `MEMORY.md` is not an input.

**M6 — Injection is capped, shared and frozen.** The summary is truncated first;
lessons get whatever remains of `summaryInjectionTokenLimit` (5,000 approximate
tokens at 4 characters per token), cut with the same 60/40 head–tail rule
([index.ts L211–L231](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L211-L231)).
The block itself tells the model that memory is heuristic, that repo state and
user instructions win, and that memory alone is never proof
([read-path.md](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/prompts/memories/read-path.md)).
The snapshot is cached per session: `learn` writes never refresh it, so a lesson
appears from the next session on. Only phase-2 completion triggers a refresh of
the summary and a prompt rebuild
([index.ts L268–L352](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L268-L352)).

**M7 — `learn` and auto-capture.** A lesson is stored as
`- <content> _(context: …)_`, content up to 2,000 and context up to 400
characters, sanitized and redacted. Dedupe drops only exact-duplicate lines;
the newest goes first and the file keeps 100 entries
([index.ts L1304–L1410](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memories/index.ts#L1304-L1410)).
The controller counts tool calls per turn and, with `autoContinue`, starts a
detached capture agent after a non-aborted turn with at least 5 tool calls,
outside plan mode and goal loops
([controller.ts L69–L150](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/autolearn/controller.ts#L69-L150)).
That agent gets a copy of the messages, only the `learn` and `manage_skill` tools,
and a fresh prompt-cache session
([sdk.ts L1232–L1307](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/sdk.ts#L1232-L1307)).
`manage_skill` writes `~/.omp/agent/managed-skills/<name>/SKILL.md`, which
authored skills always override, and rejects symlinks and hard links
([managed-skills.ts L99–L175](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/autolearn/managed-skills.ts#L99-L175)).

**M8 — `memory://`.** `memory://root` resolves to the current scope's summary.
Subpaths are decoded and realpath-checked against the root to block traversal and
symlink escape
([memory-protocol.ts L137–L201](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/internal-urls/memory-protocol.ts#L137-L201)).
Generated skills under `memory://root/skills/` are not listed in the session's
skill index; the model reaches them only by following the read-path instruction.

## Live observations

**O1 — This session triggered its own consolidation.** The session began at
19:27:47 local time. In the same second, stage 1 re-claimed a refused job; at
19:28:00 it extracted the previous day's research session, which had just crossed
the 12-hour idle gate; at 19:28:56 phase 2 rewrote `MEMORY.md`,
`memory_summary.md` and three skills. The consolidation watermark equals that
session's `updated_at` (`1790549733`). One later session was still pending under
the idle gate.

**O2 — The extractor saw a median 1.8% of each session.** Serializing the
persistable messages of the 42 tracked sessions the way stage 1 does gives a
median of 908k characters against a 16,000-character window. Coverage ranged down
to 0.11%, and only 3 sessions fit whole. In a sampled window about 3,100 of the
16,000 characters were provider signatures, and more went to timing and
`contextSnapshot` metadata. The summaries were still accurate for this workflow,
because the opening prompt states the task and the ending shows how it closed;
whatever was learned in the middle of a session is invisible to this channel.

**O3 — Three sessions were refused by the extraction model.** Stage 1 uses the
`default` role, here an Anthropic Opus model. Three sessions of 402k to 805k
serialized characters ended with `Refusal (reasoning_extraction): … reverse
engineering or duplicating model outputs` after exhausting retries; their opening
prompts were ordinary CI and pnpm tasks. 39 of the 42 sessions contain stored
thinking blocks, which stage 1 forwards unchanged. Moderate confidence that
forwarding another turn's reasoning to an Anthropic model with an "extract"
instruction is the trigger; the classifier is not deterministic across inputs of
the same kind. Those sessions stay out of memory until their files change. No
setting moves stage 1 off the `default` role: a `memory` role exists, but only
the Mnemopi backend reads it, and this is unchanged through `v18.4.2`
([model-roles.ts L64](https://github.com/can1357/oh-my-pi/blob/8ce7e959b9c33ee5443311a34b53d1a8986c0b34/packages/coding-agent/src/config/model-roles.ts#L64)).
Upstream tracks the same refusal class for compaction and primary turns
([#12854](https://github.com/can1357/oh-my-pi/issues/12854),
[#10407](https://github.com/can1357/oh-my-pi/issues/10407)), not for memory.

**O4 — Worktrees fragment memory.** `agent.db` holds 18 consolidation scopes:
4 done and 14 pending at watermark 0. The pending scopes are mostly llame
worktrees that have not started omp since their sessions went idle. Their raw
memories exist but never merge into the main checkout's `MEMORY.md`.

**O5 — Most captured lessons never reach the prompt.** `learned.md` holds 49
lessons, about 69.7k characters or 17.4k approximate tokens. After the 877-character
summary, lessons get about 19.1k characters, roughly 27%. The 60/40 cut keeps the
newest and the oldest lessons and drops the middle, which is visible as
`...[truncated]...` inside this session's own system prompt. Three lessons restate
the same PR #1001 conventions and two restate the same workspace-entry stack
lessons in different words, so exact-line dedupe keeps all of them. Moderate
confidence the paraphrases come from repeated auto-captures over the same
long-session history.

**O6 — The consolidated output is good.** The current `MEMORY.md` is a 10 KB,
well-sectioned document of repository conventions, delivery rules and durable
technical findings, with an explicit "current source beats this document"
caution. Generated skills are short, concrete playbooks such as a safe Git WIP
restore sequence.

## Documentation and code disagreements

- **D1** — `/memory sync` is documented as running consolidation now; both
  command paths only enqueue, and local work waits for the next startup
  ([local-backend.ts L30–L37](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memory-backend/local-backend.ts#L30-L37)).
- **D2** — "Injected at session start" omits that the pipeline is asynchronous:
  the first prompt can carry the previous summary and is rebuilt when phase 2
  finishes (M6), which also changes the system-prompt prefix mid-session.
- **D3** — The consolidation prompt says "preserve useful prior themes", but the
  prior `MEMORY.md` is never supplied (M5). Continuity depends on the raw memories
  still being in the 30-day, 200-extraction window.
- **D4** — `docs/settings.md` describes a passive next-turn reminder when
  `autoContinue` is off; the controller removed that message
  ([settings.md L706–L709](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/docs/settings.md#L706-L709)).

## Mnemopi backend

Source only: this workstation runs `local`, so nothing in this section was
observed running. Two further read-only subagent passes traced the OMP wrapper
and the `@oh-my-pi/pi-mnemopi` package, and the claims about dormant code and
`reflect` were spot-checked directly.

Mnemopi is the retrieval design. Instead of injecting one consolidated document,
it stores transcript slices and facts in SQLite and recalls a ranked handful for
each query.

|                   | `local`                                                  | Mnemopi                                                |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Enters the prompt | consolidated summary and lessons, same for every session | up to 8 memories recalled for the session's first turn |
| Model calls       | stage 1 per idle session, phase 2 per scope, at startup  | fact extraction per retained slice                     |
| Consolidation     | model-written `MEMORY.md` and skills                     | deterministic concatenation into episodes              |
| Tools             | `learn`                                                  | `recall`, `retain`, `reflect`, `memory_edit`, `learn`  |
| Embeddings        | none                                                     | local fastembed in a child process                     |

**N1 — Storage and scope.** The shared database is
`memories/mnemopi/mnemopi.db`. The default `per-project` scope writes a sibling
bank named from the working directory's basename plus a hash of its absolute
path, so worktrees split here too; `per-project-tagged` writes locally and recalls
the project and global banks together
([config.ts L92–L177](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/config.ts#L92-L177)).

**N2 — Three row kinds.** `working_memory` holds transcript slices with TTL
(`valid_until`), `consolidated_at`, `superseded_by`, importance and veracity.
`episodic_memory` holds sleep summaries with a degradation tier. `facts` holds
subject–predicate–object rows with confidence and the source memory id. Each has
an FTS5 mirror
([schema.ts L58–L238](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/beam/schema.ts#L58-L238)).
Embeddings are float arrays serialized as JSON and stamped with their model
([helpers.ts L802–L823](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/beam/helpers.ts#L802-L823)).

**N3 — Automatic writes.** At `agent_end`, at most every 4 user turns, the
not-yet-retained transcript suffix becomes one working row at importance 0.65. The
stored row keeps user and assistant text; embedding and FTS use a marker-free
projection, and fact extraction sees user text only
([state.ts L514–L566](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/state.ts#L514-L566)).
Identical content in the same session merges; nothing scores importance
automatically. `retain` and `learn` write facts at 0.75
([memory-retain.ts](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/tools/memory-retain.ts)).

**N4 — The only model work is fact extraction.** Mnemopi resolves the `memory`
role, which inherits `tiny` and then `smol`, and asks for JSON facts, at most 5
per category. Without a model it falls back to phrase heuristics such as "my name
is" and first-person always/never instructions
([backend.ts L528–L655](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/backend.ts#L528-L655),
[extraction.ts L372–L468](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/extraction.ts#L372-L468)).
Because extraction input is user text, the reasoning-block refusal in O3 cannot
arise on this path.

**N5 — Recall enters on the first turn.** The query is the latest prompt plus the
three previous user-bounded turns, capped at 4,000 characters. Up to 8 results,
within about 5,000 tokens, are framed as background context, staged, committed
onto the base prompt and cached for later rebuilds
([state.ts L474–L511](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/state.ts#L474-L511),
[session-tools.ts L1801–L1849](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/session/session-tools.ts#L1801-L1849)).
Compaction receives a fresh recall. Later turns reach memory only through tools.

**N6 — Scoring.** An episode scores
`max(0.5·dense + 0.3·fts + 0.2·importance, 0.8·lexical)`; working rows use a
keyword-weighted blend. Both are multiplied by `0.7 + 0.3·exp(−age/72h)`, a
half-life of about 50 hours with a floor, so age never costs more than 30%.
Episode tiers multiply by 1, 0.85 and 0.7; veracity multiplies stated content by
1, unknown by 0.8, inferred by 0.7, imported by 0.6 and tool-derived by 0.5
([recall.ts L721–L780](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/beam/recall.ts#L721-L780)).
Recall then applies query-intent weights, MMR with λ = 0.7 over token Jaccard,
and a natural-date parser that boosts time-matched rows for queries such as
"3 weeks ago"
([recall.ts L1049–L1072](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/beam/recall.ts#L1049-L1072),
[temporal-parser.ts L173–L320](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/temporal-parser.ts#L173-L320)).

**N7 — Sleep is deterministic.** Working rows older than half the 24-hour TTL are
grouped by source, joined with `|`, passed through `aaakEncode` and stored as one
episode at importance 0.6 with `llm_used: false`; the sources are marked
consolidated, not deleted
([consolidate.ts L975–L1078](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/beam/consolidate.ts#L975-L1078)).
`aaakEncode` is a phrase-abbreviation table tuned for assistant facts ("User
prefers " becomes "PREF "), so on coding transcripts an episode is close to a
plain concatenation. Episodes shrink to 800 characters at 30 days and to a
300-character key signal at 180 days
([consolidate.ts L853–L910](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/beam/consolidate.ts#L853-L910)).
Startup runs the age-gated pass, `/memory enqueue` runs it across sessions, and a
normal exit only drains pending writes for 1.5 seconds.

**N8 — Edits and invalidation.** `memory_edit` updates or forgets working rows and
invalidates working or episodic rows by stamping `valid_until` and
`superseded_by`, which recall then excludes; facts are read-only. Recall previews
clip at 500 characters, and the tool prompts require `read memory://<id>` for the
full row before an update
([state.ts L328–L376](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/state.ts#L328-L376)).
Every write passes through `redact.ts`.

**N9 — Embeddings.** The default is `BAAI/bge-base-en-v1.5` (768 dimensions), or
`intfloat/multilingual-e5-large` (1024). fastembed downloads and runs the model in
a child process; initialization has no timeout, a request times out after 120
seconds, and any failure degrades recall to FTS and lexical scoring
([embed-client.ts L83–L143](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/embed-client.ts#L83-L143)).

**N10 — Much of the package is dormant in OMP.** OMP calls the linear
`recallEnhanced` directly
([state.ts L389–L412](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/mnemopi/state.ts#L389-L412)).
The `polyphonicRecall` and `enhancedRecall` settings are forwarded to
`configureRecallFeatures`, but only the orchestrator and query cache read those
flags, and nothing on OMP's path calls either
([orchestrator.ts L44–L56](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/mnemopi/src/core/orchestrator.ts#L44-L56)).
Four-voice polyphonic recall with reciprocal-rank fusion, the tiered query cache,
the typed-memory classifier, SHMR and the Bayesian `VeracityConsolidator` are
therefore unreachable. Intent weighting and MMR are always on. `reflect` recalls
and formats; it makes no synthesis call
([memory-reflect.ts L44–L59](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/tools/memory-reflect.ts#L44-L59)).

Documentation disagreements specific to Mnemopi:

- **D5** — The settings table says `polyphonicRecall` and `enhancedRecall` enable
  their features; neither changes OMP's recall path (N10).
- **D6** — The guide calls `reflect` synthesis and describes LLM-backed
  consolidation; `reflect` is recall plus formatting and sleep is deterministic
  (N7, N10)
  ([mnemosyne-memory-backend.md L35–L91](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/docs/mnemosyne-memory-backend.md#L35-L91)).
- **D7** — `/memory queue` is listed generically, but Mnemopi supplies no queue
  preview, and `providers.memoryModel` is a legacy key migrated into the `memory`
  role.

## Other backends

Selecting a backend is exclusive
([resolve.ts](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/memory-backend/resolve.ts)).
**Hindsight** is a remote bank: recall on the first turn under a generation check
against races, retention every three user turns, server-side "mental models", and
recall framed as background rather than instructions. **Sharpshooter** extracts
a delta from each user prompt with exact-quote evidence, then admits it into
`architecture.md`, `product.md` or `style.md` only for a regression, a subtle
constraint or a repeated correction, capped at 120 lines per file
([consolidate.ts L99–L174](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/sharpshooter/consolidate.ts#L99-L174)).
One gap: `redact.ts` covers AWS, GitHub, npm, Slack, Google and JWT shapes plus
keyword-delimited runs, but the Hindsight `learn` path and managed-skill bodies
bypass it
([learn.ts L94–L97](https://github.com/can1357/oh-my-pi/blob/da58b16f424273605795435a6753778f422baff3/packages/coding-agent/src/tools/learn.ts#L94-L97)).

## Transfer to llame

- **T1 — The two-channel split fits llame's direction.** Batch distillation after
  a chat goes idle, plus an explicit capture tool, matches the "self-improving
  context through recoverable writes" goal in [VISION.md](../../../VISION.md).
  OMP's `jobs` table with lease, heartbeat and watermark maps directly onto a
  pg-boss job keyed by chat, with the watermark on the chat's last message.
- **T2 — Freeze the injected snapshot per Chat.** OMP's per-session cache is the
  same answer llame reached for the recency digest: bind once, never churn the
  cached prefix on a write. D2 shows the cost of breaking that rule.
- **T3 — Do not copy the extraction window.** Extract from compaction
  checkpoints or bounded segments of stored `messages.parts`, not a head–tail cut
  of serialized JSON. Strip reasoning parts, provider signatures and receipts
  before extraction; O3 shows reasoning parts can make the provider refuse.
- **T4 — Budget lessons explicitly.** A shared cap filled summary-first silently
  drops lessons (O5). Consolidate lessons with the summary, or dedupe
  semantically before injection, and record which items were omitted.
- **T5 — Scope by identity, not path.** llame scopes by owner and Project, so the
  worktree fragmentation in O4 does not arise; keep it that way when agent
  Workspaces arrive.
- **T6 — Friction gating is the most transferable filter.** Sharpshooter admits a
  decision only with quoted evidence and a regression or repeated correction.
  That keeps an owner-visible Knowledge write rare and reviewable.
- **T7 — Egress is the multi-tenant cost.** Every stage-1 call sends a whole
  transcript excerpt to a model. In llame that must be an owner opt-in on an
  accepted provider, as with `shareRecentChats`.
- **T8 — Take Mnemopi's scoring terms, not its working tier.** llame already
  stores transcripts durably and searches them with pgvector and `pg_trgm`, so a
  second copy of transcript slices adds nothing. The terms worth testing in
  `search_conversations` ranking are the floored recency multiplier, MMR
  diversity, and a source multiplier that ranks tool-derived text below what the
  owner stated, which also lowers the weight of injected tool output.
- **T9 — Facts need provenance and invalidation.** Mnemopi's fact rows carry the
  source memory id, and invalidation stamps `valid_until` and `superseded_by`
  instead of deleting. That is the shape recoverable Knowledge writes need.
  Extracting from user text only avoids reasoning refusals and keeps assistant
  guesses out of memory, at the cost of facts the assistant discovered.

## Method and limits

Source claims are from reading `v18.2.10` with five read-only subagent passes and
direct spot checks of the cited ranges. Live numbers come from one workstation's
database and files; stage-1 coverage was recomputed with a Python port of the
filter and 60/40 truncation, not by instrumenting OMP. The refusal cause in O3 is
inferred, not reproduced. Mnemopi was not run, so its recall quality is unknown.
No model quality or cost measurement was made.
