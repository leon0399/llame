---
type: Reference
title: "jegrep"
description: "Standalone staged semantic source search, typed Jev judgments and a code-retrieval benchmark harness"
resource: "https://github.com/can1357/jegrep/tree/e6d5b842e5e88e576c3fcab9e2aa25081cb643af"
observed:
  date: "2026-09-24"
  revision: "e6d5b842e5e88e576c3fcab9e2aa25081cb643af"
sources:
  - id: jegrep-cascade
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/cascade.rs"
    title: "Reference cascade"
  - id: jegrep-client
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/jev.rs"
    title: "Endpoint, retry and question-chunking client"
  - id: jegrep-results
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/benches/RESULTS.md"
    title: "Reported retrieval comparisons and limitations"
  - id: llame-semantic-find
    resource: "../tool-harness/2026-09-24-semantic-find-judge/report.md"
    title: "OMP find, jegrep and general llame applications"
---

# jegrep

A standalone Rust search CLI and the reference for [OMP's semantic `find`](../harnesses/oh-my-pi.md#semantic-find-and-jegrep).
It combines local lexical ranking, filename judgments, extractive source
sketches and bounded full-window verification. Jev evaluates candidates; host
code chooses the reads and returns source coordinates. It does not generate the
answer or operate an autonomous filesystem agent.[^jegrep-cascade]

The CLI also exposes alternative strategies and configurable budgets. Its local
endpoint mode requires an external System One-compatible server, not bundled
Jev weights. Hosted endpoint preference can still fail over to another
credentialed provider; llame must retain explicit data-destination
policy.[^jegrep-client]

The [full study](../tool-harness/2026-09-24-semantic-find-judge/report.md) compares
actual source boundaries, audits the benchmark and executes the unchanged Python
scorer on synthetic outputs. Published quality/latency results were not rerun;
positive-only labels, overlap-based region recall and missing linked raw-run
artifacts limit what they establish. No automatic transfer to OMP or llame is
claimed.[^jegrep-results][^llame-semantic-find]

**Confidence:** high in the inspected control flow and scorer mechanics;
moderate in application fit. Use the report's U13-U20 candidates for chat,
code, tools, skills, documents and future Run/artifact evidence.

[^jegrep-cascade]: [Reference cascade](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/cascade.rs)

[^jegrep-client]: [Endpoint, retry and question-chunking client](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/jev.rs)

[^jegrep-results]: [Reported retrieval comparisons and limitations](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/benches/RESULTS.md)

[^llame-semantic-find]: [OMP find, jegrep and general llame applications](../tool-harness/2026-09-24-semantic-find-judge/report.md)
