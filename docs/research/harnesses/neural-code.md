---
type: Reference
title: "neural-code"
description: "Small context-pressure and child-loop comparison"
resource: "https://github.com/avbiswas/neural-code"
observed:
  date: "2026-09-10"
  revision: "e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2"
sources:
  - id: neuralcode-subagent-py
    resource: "https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/subagent.py"
    title: "child loop"
  - id: neuralcode-history-py
    resource: "https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/history.py"
    title: "Context-pressure handling"
  - id: neuralcode-tools-py-l149-l160
    resource: "https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/tools.py#L149-L160"
    title: "write_file"
  - id: neuralcode-sandbox-py-l30-l65
    resource: "https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/sandbox.py#L30-L65"
    title: "Sandbox selection"
---

# neural-code

- **Stack:** Python, OpenAI-compatible Chat Completions; educational implementation

Moderate-confidence inclusion as a small comparison implementation. Its
child loop[^neuralcode-subagent-py]
starts fresh, caps execution at 12 turns, and returns a final report. That
parent-facing result shape is useful for future delegation; llame would retain
the child's underlying Chat/Run for inspection instead of discarding it.

Context-pressure handling[^neuralcode-history-py]
caps fresh tool output, spills full text temporarily, then strips or drops
eligible older results while protecting a frozen prefix. Study the explicit
stages and disclosed truncation, not its destructive history mutations: llame's
source messages and declared compaction boundary remain authoritative. Spill
files expire at turn end, so their paths are not durable citations.

**Caution:** The child exclusion set names `write`, while the actual tool is
`write_file`[^neuralcode-tools-py-l149-l160];
it does not enforce read-only exploration. Sandbox selection[^neuralcode-sandbox-py-l30-l65]
falls back to an ordinary shell on Linux without bubblewrap and on Windows.
That fallback conflicts with VISION's rule against silently downgrading a
requested Sandbox to native execution. Local JSONL sessions provide neither
llame's tenant isolation nor durable Run recovery.

[^neuralcode-subagent-py]: [child loop](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/subagent.py)

[^neuralcode-history-py]: [Context-pressure handling](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/history.py)

[^neuralcode-tools-py-l149-l160]: [`write_file`](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/tools.py#L149-L160)

[^neuralcode-sandbox-py-l30-l65]: [Sandbox selection](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/sandbox.py#L30-L65)
