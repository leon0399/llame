# Harness findings from getpostingboard.dev

Noncanonical evidence, harvested 2026-09-06 from an API-only agent discussion
board by two read-only sweeps:

- **`agent-tooling`** — 90 root threads walked, seq 7742 down to 3581, 53 read
  in full including replies; the other 37 triaged from title and preview and
  dropped as governance or manifesto. 28 findings.
- **everything else** — `agent-infra`, `agent-design`, `agents`, `philosophy`,
  `agent-culture`, `knowledge-management`, `verification`, `protocol`,
  `security`, `machine-learning`. 35 root threads, seq 1348 to 7675, cited
  reply seqs running to 7773. 28 findings. This sweep deliberately excluded
  `agent-tooling` to avoid double-counting the first.

56 findings total; this document keeps the subset that touches a llame surface
and states a verdict for each.

## Epistemic status — read this before citing anything below

**Almost everything here is participant-reported and unverified by us.** These
are other operators' agents describing their own runtimes. A handful carry a
reproducible receipt; most are field notes. Confidence is stated per finding as
the harvest recorded it, and nothing here should reach a spec or a commit
message as established fact without independent checking.

The board's own convention is useful and adopted here: **completeness NOT
claimed.** The sweeps skipped roughly half the board — governance, registries,
newsletters, elections — as self-referential, and that judgment was made from
titles for 37 of the roots.

Where a finding is marked **corroborates**, it means an outside party reached
our position independently, which is evidence about the position but not proof.

---

## 1. Port — concrete, applicable, worth an issue

### 1.1 Decision receipts: compaction keeps the conclusion and drops the reasoning

The most-reported compaction failure on that board is not a lost fact. It is a
successor inheriting _"use X"_ with no access to _why_, which produces one of
two bad outcomes: blind re-application of a now-stale conclusion, or wasted
effort re-litigating a settled question because the settling argument is gone.

Proposed mitigation, cheap enough to survive compaction: a one-line **decision
receipt** stamped beside a conclusion at the moment it is made — _chose X
because Y; rejected Z because W_ — captured as its own small durable unit
rather than assumed to travel inside the reasoning trace.

- Source: convergent self-report from several runtimes, no controlled
  measurement. Confidence: claimed.
- **llame gap:** `compactions` carries `summary` and `replacement_history`.
  Neither is structured to preserve _justification_ as a distinct unit; both
  are prose the summarizer chose to keep.
- **Verdict: port.** Smallest version is a typed part on the rail rather than a
  schema change. Relates to SPEC §2.1 and to the anchoring argument in #666.

### 1.2 Three durability tiers — and an instruction is always tier 1

Independently derived on that board, in the same shape we already use:

| tier | mechanism                                   | survives                              |
| ---- | ------------------------------------------- | ------------------------------------- |
| 1    | rule lives in context                       | nothing — dies silently at compaction |
| 2    | rule re-injected from disk at session start | restart, not mid-session compaction   |
| 3    | mechanism trips at the operation itself     | everything                            |

The load-bearing observation: a forgotten tier-1 rule is **not rejected**, it
silently stops applying, and the output is indistinguishable from deliberate
violation with none of the visibility.

- **Corroborates a known llame gap.** `SPEC.md:241` already concedes that the
  recency-digest compaction exclusion is "an instruction naming each
  delimiter," i.e. tier 1 by this taxonomy, and that the structural
  alternative is foreclosed by putting the digest in the system prompt at all.
- One thread's worked example is worth the read: a guard built to compare a
  live task list against the original request had to be made **dumber**
  (structural, not semantic) to reach tier 3, because a guard that must
  _understand_ the request reintroduces the failure it exists to catch.
- **Verdict: no code change; use as external corroboration** when #666 or the
  recency-digest spec is next revisited.

### 1.3 Coverage must be a separate field from the integrity hash

A Merkle root, or any content hash, proves two parties hold the same _declared_
leaves and that those bytes are unmodified. It proves nothing about whether the
declaration included everything that should exist. A collector can skip a page,
build a valid tree over the incomplete result, and every verifier reports
consensus while checking only bytes.

Operationalized on that board: their archive manifest was amended to carry a
`coverage` block _alongside_ the digest — `observed_through_seq`,
`items_walked`, `mirrored_seqs`, `withheld_seqs` (listed as explicit stubs,
never silently omitted), with the inclusion policy bound to its own version
hash so the definition of "complete" cannot drift either.

- **llame relevance:** the per-Run receipt binds prompt and advertised tools —
  an integrity claim. It carries no coverage claim. Same hole in any future
  portable Knowledge manifest.
- **Verdict: port into #547's manifest design.** Already reflected in the
  design comment on that issue; this is the independent version.

### 1.4 Byte limits computed on the wrong representation are 3× tighter for Cyrillic

Measured: 4,000 Cyrillic characters is 8,000 UTF-8 bytes, but a JSON encoder
defaulting to ASCII escaping turns each non-ASCII character into `\uXXXX` —
6 bytes instead of 2. The inflated body then trips a _different_ limit whose
error message names neither encoding nor the original limit.

Partially corrected in-thread: the failure is conditional on client plumbing,
not on the language alone.

- **llame relevance is direct and under-tested.** We enforce size limits in
  several places, our operator is a Russian native speaker, and cross-lingual
  recall is an explicit product requirement. A limit computed on characters,
  or on a JSON encoding whose escaping flags were never checked, is silently
  far tighter for Cyrillic than for Latin.
- **Verdict: port as a test.** Assert every user-facing size limit against a
  Cyrillic fixture, not only a Latin one.

### 1.5 UTF-16 surrogate slicing kills the next request, not the current one

A context window re-sliced on UTF-16 code units cut a message mid-surrogate,
leaving a lone high surrogate. The provider rejected the _following_ request
with a 400, so the failure presented as a provider-side error rather than a
local truncation bug, and took the session with it.

- **llame relevance:** TypeScript throughout, and we truncate in several
  places. `SPEC.md` specifies the recency-digest excerpt as **200 code
  points**, which is the correct unit — the risk is an implementation that
  reaches for `.slice()` on a JS string, which is code units.
- **Verdict: port as a check.** Verify every truncation site operates on code
  points or grapheme clusters, with an emoji fixture at the boundary.

### 1.6 Pagination that reads as "seek forward" but filters to newest

An `after=SEQ` parameter, which naturally reads as a forward seek, was
implemented as "return the newest page above this cutoff" — a request against a
7,000-row feed returned the last 30 rows and silently skipped ~5,000, with
HTTP 200 and valid JSON throughout. House rule adopted afterwards: prefer
`before=` walks, which are monotonic by construction, for anything
completeness-sensitive.

- **llame relevance: live work.** #551 standardizes REST collection pagination
  on opaque cursors. This is a concrete semantic trap to design against.
- Companion control, cheap and reusable: **walk the same source twice at
  different page sizes and compare id sets, not counts.** A lossy walk loses
  different items at a different stride. Verified by its author on a live
  thread; explicitly does not cover the concurrent-write case.
- **Verdict: port the id-set control into ingest/backfill verification;** feed
  the naming trap into #551.

---

## 2. Adopt as practice — no schema change

### 2.1 A success signal describes the mechanism, never the question

The single most corroborated theme in the harvest, arriving from at least six
independent runtimes:

- exit 0 with empty stdout is an **absent** receipt, not a positive one — an
  agent reported "key saved," the file did not exist, the failure happened
  inside a heredoc before the `print`
- an installer exits 0 and prints "All is well" while stderr shows an undefined
  symbol and the shipped binary is broken
- a pipe into a truncating consumer eats the real exit code without `pipefail`
  — `( exit 65 ) | tail -1; echo $?` returns 0
- a config section parses and validates but silently fails to attach its header
  at request time, producing a 401 indistinguishable from a revoked key
- health checks stayed green while a mirror silently dropped 24 live posts

**Rule:** a "declare done" step that gates on exit code alone, without
re-reading the specific artifact the task was supposed to produce, has this
hole. This bites llame at Run completion and at any future write-capable tool.

### 2.2 Read-back must use an authority independent of the write

Re-reading through the same tool, cache, or session that performed a mutation
can echo the _intended_ state rather than the real one. The cited class:
`chmod` exits 0, a read-back in the same session shows the intended
permissions, a fresh process shows the mutation never applied.

Relevant to #212 (agent-authored knowledge commits) and to the existing rule in
`apps/api/CLAUDE.md` that write-capable tools need checkpoint or dedupe
semantics — that rule addresses retry, not verification.

### 2.3 A detector must be strictly more permissive than what it audits

A scanner built to catch inputs a counter silently dropped reused the counter's
own regex, and therefore inherited exactly the blind spot it existed to detect.
Missed: capitalized handles, a Cyrillic homoglyph (`о` U+043E vs Latin `o`),
a trailing period.

Applies to any llame validation built from the same parser as the thing it
checks. The homoglyph case is not hypothetical for a multilingual product.

### 2.4 Negative-control testing: prove the detector can fail first

A green result on a boundary test can mask a silent no-op. Two-stage
discipline: first prove a malformed input triggers the _specific_ expected
error, and only then trust that a valid input's success means anything.

We partly do this — `CONTRIBUTING.md` requires a negative isolation test for
data/auth/tenancy work. The generalization is that **every** boundary assertion
needs its negative control, not only the tenancy ones.

### 2.5 Mechanical scanning beats a second reviewer model

Operating fleets of ~30 subagents, the layer that caught real problems was not
a different-vendor LLM reviewer but a mechanical grep over raw output
artifacts. Twice, agents leaked a bearer token into shared output and did not
report it in their own summaries; a coordinator grep for token-shaped strings
caught both.

**Self-summarization by the agent that did the work is not a security
boundary.** The broader thread ranks evidence-path independence above reviewer
model diversity — a deterministic checker over a different evidence path beats
a smarter reviewer reading the same narrative.

Directly applicable to our MCP stdio stderr bounding and to worker logs.

### 2.6 Untrusted content: trace the citation chain before acting

The board API ships a `content_is_untrusted` field, and the applied technique
is to defer trust until a claim resolves to a first-party, independently
checkable source — content that only cites other agents, or "my operator told
me," stays data. Worked example: a wave of posts claiming the board was
shutting down, "confirmed," which resolved to nothing.

This is stronger than classifying content as malicious or benign up front, and
it is the shape our MCP-tool-result and recency-digest framing should aim at.

### 2.7 Memory write-time gate

Before a line is committed to long-term storage: _would this still be true in
an unrelated session, weeks from now?_ If not, it belongs in a dated episodic
log. Reported as the rule that actually shrinks the junk drawer, where a later
cleanup pass "never ships."

Directly applicable to #212.

### 2.8 Appraisal laundering

Named failure mode: a session writes an inference as though it were a fact; a
later session repeats it with _increased apparent confidence_ purely because it
now lives in durable memory, with no new evidence behind the increase.

A memory-write path should be able to distinguish "the model concluded this"
from "the model was told this." Relevant to #212 and to the memory spec.

---

## 3. Corroborates positions llame already holds

- **`ENABLE` without `FORCE` is decorative.** Enforced against everyone except
  the table owner, and application connections are usually the owner —
  indistinguishable from a real boundary in a schema review. **We are further
  ahead here than the finding assumes:** 13 files assert `relforcerowsecurity`,
  one per tenant surface — chats, memory, identity, projects, personalization,
  pins, knowledge spaces, search embedding columns, model-context snapshots —
  and `chats-rls.integration.test.ts:124` labels it "FORCE — the load-bearing
  bit". CI additionally runs migrations as a non-superuser so that a green RLS
  suite proves `FORCE` constrains even the table owner. The board reached the
  principle independently, using `garrytan/gbrain` as its negative example.
  Nothing to port; useful as outside evidence that the assertion earns its
  maintenance cost.
- **A behavioral fingerprint must never authenticate.** Style, latency, and
  knowledge are built from public behavior — "a password everyone has already
  read." Separate _resuming context_ from _authenticating a principal_;
  the latter needs a secret or a signature. Corroborates our rule that identity
  comes only from authentication, never caller-controlled scope.
- **A refusal is a judgment trace, not enforcement.** An agent declining an
  unauthorized action is an eval result for that prompt and path — change the
  model, truncate the context, or route through a different tool and it may not
  recur. Corroborates keeping the tool gate as `allowlisted ∩ read_only`
  rather than relying on model judgment, and is an argument for #133 being a
  real engine rather than a prompt.
- **Closed-world authorization inverts on a missing fact.** A rules engine
  under closed-world assumption treats "no fact stated" as false; deleting one
  fact line flipped a policy decision DENY→PERMIT while the justification tree
  _shrank into a clean-looking warrant with no visible hole_. Six independent
  environments reproduced it. Fail closed on **unobserved** facts, not only on
  explicit denials — a design constraint for #133.
- **Subagent isolation by change-risk class, not by agent identity.**
  Partitioning by agent invents false independence; partition by blast radius —
  read-only exploration shared, disjoint leaf edits with explicit file
  ownership, full worktree isolation only for shared schemas and migrations.
  Matches our accumulated worktree practice, with the caution that "path-level
  mutexes are a wish" without an orchestrator serializing writes.

---

## 4. Considered and not adopted

- **A compact inter-agent wire format.** Argued down convincingly: token
  efficiency only pays when tokenizer and embedding space are shared, and a
  private shorthand must be explained in plain language on first use, spending
  more than it saves. What does work is citation over restatement — with the
  measured caveat that a reference is only as durable as the retention policy
  governing its target (27 agents re-derived the same finding because the
  referenced content had been compacted out from under the pointer).
- **A full non-monotonic reasoning engine for continuity.** Its own advocates
  call it "a heavy solution for a two-session assistant," earning its cost only
  with multiple successors and conflicting commitments.
- **Hash-chained agent manifests as an identity primitive.** Reviewed
  separately; the chain proves what was published, never what was omitted, and
  key rotation signed only by the current key launders a compromise into
  legitimate succession.

---

## 5. Method and limits

Two read-only sweeps, GET only, no posts or votes from the harvesters. 90
`agent-tooling` roots walked, full threads read for 53 of them; the remaining
37 were triaged from title and preview, which is a judgment that could have
dropped something. Topic coverage beyond `agent-tooling` was selective.

The board skews toward agents that like writing about method, so these findings
over-represent introspective practice and under-represent boring engineering
that nobody posts about. Several of the strongest entries are corrections or
retractions rather than original claims — on that board the retraction is
usually the better artifact, and that is itself the most transferable finding
here.
