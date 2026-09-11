---
type: Reference
title: "Spotify Shunt"
description: "Question-focused bulk-read delegation and cost-routing boundaries"
resource: "https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt"
observed:
  date: "2026-09-11"
  revision: "3c24ca30ff63e1f5bbad1c43fe5324daff579123"
sources:
  - id: read-hook
    resource: "https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/hooks/check-file-size#L5-L33"
    title: "Whole-file read routing"
  - id: bash-hook
    resource: "https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/hooks/check-bash-read#L1-L40"
    title: "Bash read heuristic and exceptions"
  - id: bulk-read
    resource: "https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/scripts/bulk-read#L30-L58"
    title: "Question-focused corpus delegation"
  - id: mode-resolution
    resource: "https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/scripts/lib/aika.sh#L93-L165"
    title: "Mode resolution and response checks"
  - id: benchmark-definition
    resource: "https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/evals/benchmarks.json#L1-L39"
    title: "Claude-context token benchmark definition"
  - id: bulk-reader-skill
    resource: "https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/skills/bulk-reader/SKILL.md#L1-L13"
    title: "Independent calls and exact-read guidance"
  - id: spotify-account
    resource: "https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90"
    title: "Spotify engineering account, 2026-09-03"
---

# Spotify Shunt

- **Stack:** Claude Code plugin with Bash hooks/scripts, skills, and Spotify
  Portal/AiKA worker modes. It delegates work through Portal rather than owning
  a durable agent session.

High confidence in the inspected routing mechanism; moderate confidence in its
value for llame before workload measurements. This complements
[SoL-Pi](./sol-pi.md): Shunt prevents initial bulk reads from entering the primary
model context, while SoL-Pi also reduces already-produced observations and their
repeated replay. No upstream code or benchmark was executed for this assessment.

**Study**

F72 — **Delegate a question before loading its whole corpus.** A `PreToolUse`
hook intercepts whole-file reads above 350 lines by default and directs the
model to a bulk-reader skill. Reads with an offset or limit pass through.
The script checks that files exist and are readable, sends their contents with
an explicit question, and returns the worker's answer.[^read-hook][^bulk-read]
Each call is independent; the skill requires exact-value/line verification
before editing.[^bulk-reader-skill] Spotify's example uses Gemini 2.5 Flash,
but the worker is selected by the configured Portal mode.[^spotify-account]
For llame, study a typed read-only inspection operation accepting a question
and authorized logical locators. Keep exact native reads and range selectors
available; a summary is analysis, not file content suitable for exact editing.
This needs neither a generic hook framework nor a general child-agent runtime
as a prerequisite.

F73 — **Cost routing is separate from permission rejection.** The Read hook
exempts any supplied offset or limit. The Bash heuristic exempts every command
containing a pipe or redirection and recognizes a small command-name set;
these exceptions do not prove that the result is small.[^read-hook][^bash-hook]
For example, a large-file read piped through `cat` still passes the pipe check.
Treat this as a routing heuristic, not a security boundary. In llame, an
optimization redirect must not be reported as `permission_denied`: the latter
explicitly forbids bypass through another execution path. Authorize every
source locator and the worker provider/data egress separately. Worker mode
resolution must also be bound into Run provenance rather than silently changing
with a mutable public mode name. Shunt supports mode-ID selection and rejects
responses without an applied mode, but checking a returned name is not an
immutable instruction/model revision receipt.[^mode-resolution]

F74 — **Measure displaced cost, not only shorter primary context.** Spotify
reports roughly 90% mean bulk-read savings across four Java-monorepo scenarios,
with 10-30-second delegation latency, unreliable summary line numbers, and a
worker missing a subtle thread-safety issue.[^spotify-account] The repository's
benchmark definition measures Claude-context tokens using a characters/4
estimate; its four scenarios do not establish total billed cost or equivalent
completed-task quality.[^benchmark-definition] Repeated calls resend the files
to the worker, so avoiding primary-model tokens does not make those calls free.
For llame, compare primary input/cache costs avoided against worker input/output,
routing overhead, verification rereads, latency, and task correctness. Use
byte/token estimates and measured break-even behavior rather than importing
350 lines as a universal threshold.

F75 — **Preserve evidence and keep the first cut read-only.** A useful llame
inspection result should carry source identity, revision/hash, coverage limits,
and references that can be checked against authorized exact reads. Worker
summaries and retrieved file contents remain untrusted data. If adopting
post-execution reduction later, keep canonical tool status and durable
observations separate from the model-facing projection. The current runner
already truncates oversized results before Run persistence; complete raw-output
retention would need an explicit owner-scoped artifact contract, not a claim
that today's event store preserves every byte. See the
[tool-calling contract](../../../openspec/specs/tool-calling/spec.md) and
[Run execution service](../../../apps/api/src/runs/run-execution.service.ts).
Spotify also describes direct-to-disk boilerplate generation; defer that path
until llame's write authority, verification, and recovery contracts cover it.

**Priority:** First measure large-read/context replay costs. Then evaluate an
explicit question-focused inspector against exact-read baselines. Add automatic
routing only if total cost improves without unacceptable latency or lost task
quality. Keep debugging, security conclusions, and exact edits on verifiable
source evidence.

[^read-hook]: [Whole-file read routing](https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/hooks/check-file-size#L5-L33)

[^bash-hook]: [Bash read heuristic and exceptions](https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/hooks/check-bash-read#L1-L40)

[^bulk-read]: [Question-focused corpus delegation](https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/scripts/bulk-read#L30-L58)

[^mode-resolution]: [Mode resolution and response checks](https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/scripts/lib/aika.sh#L93-L165)

[^benchmark-definition]: [Claude-context token benchmark definition](https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/evals/benchmarks.json#L1-L39)

[^bulk-reader-skill]: [Independent calls and exact-read guidance](https://github.com/spotify/portal-ai-plugins/blob/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt/skills/bulk-reader/SKILL.md#L1-L13)

[^spotify-account]: [Spotify engineering account, 2026-09-03](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)
