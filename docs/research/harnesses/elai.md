---
type: Reference
title: "ELAI"
description: "Archived architecture and measurement discipline"
resource: "https://github.com/DITlieD/ELAI-archive/tree/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1"
sources:
  - id: benchmarks-md-l60-l70
    resource: "https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/BENCHMARKS.md#L60-L70"
    title: "benchmark guide"
  - id: elai-cc-crates-orchestrator-src-governance-coverage-rs-l133-l145
    resource: "https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/.elai_cc/crates/orchestrator/src/governance_coverage.rs#L133-L145"
    title: "ViewStatus::Unmeasured"
  - id: elai-cc-wire-dark-allowlist-toml-l1-l28
    resource: "https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/.elai_cc/wire-dark-allowlist.toml#L1-L28"
    title: "wire-dark flag schema"
  - id: postmortem-md-l26-l42
    resource: "https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/POSTMORTEM.md#L26-L42"
    title: "postmortem"
---

# ELAI

- **Stack:** Rust workspace with Python and Svelte/Tauri components; MIT; abandoned
- **Observed:** 2026-09-10 @ `26bf2bc72d030a2d5ec022f04e1f9603bb285ae1`

ELAI is an archive of an abandoned harness experiment. Its value is accounting discipline: the author separates design goals, existing source, recorded fixtures, and claims that were never rebuilt or rerun. The README explicitly says its enforcement model is a goal, not proof that every path enforced it. This makes ELAI a negative reference for llame's evidence and completion contracts, not a runtime architecture to adopt.

**Study**

1. **F25: Reproducible evidence.** The benchmark guide[^benchmarks-md-l60-l70] requires the chain harness -> exact fixture -> saved result -> limitations and rejects registry or plan state as measurement. Use that evidence chain when evaluating llame changes.
2. **F26: Explicit unmeasured state.** `ViewStatus::Unmeasured`[^elai-cc-crates-orchestrator-src-governance-coverage-rs-l133-l145] makes missing producers and unreadable or empty evidence an explicit state instead of a synthetic score.
3. **F27: Default-off feature ownership.** The wire-dark flag schema[^elai-cc-wire-dark-allowlist-toml-l1-l28] requires an owner, expiry, promotion plan, and smoke test for default-off paths.

**Applicability:** High for evidence vocabulary and honest unmeasured states; low for adopting its orchestration. **Confidence:** High for the archive's stated limitations; low for any historical runtime claim. **Caution:** the postmortem[^postmortem-md-l26-l42] says no application build or historical benchmark was rerun for the archive. Treat the patterns as source evidence and its historical runtime claims as unverified.

[^benchmarks-md-l60-l70]: [benchmark guide](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/BENCHMARKS.md#L60-L70)

[^elai-cc-crates-orchestrator-src-governance-coverage-rs-l133-l145]: [`ViewStatus::Unmeasured`](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/.elai_cc/crates/orchestrator/src/governance_coverage.rs#L133-L145)

[^elai-cc-wire-dark-allowlist-toml-l1-l28]: [wire-dark flag schema](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/.elai_cc/wire-dark-allowlist.toml#L1-L28)

[^postmortem-md-l26-l42]: [postmortem](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/POSTMORTEM.md#L26-L42)
