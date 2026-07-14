# 2026-07-05 memory-landscape run — what's frozen vs. maintained

**[CROSS-REPORT.md](CROSS-REPORT.md) is the only maintained, canonical document in this directory.** It records the corrected verdicts and the build plan, and it supersedes anything that disagrees with it in the inputs below (including the main report's polymorphic scope-schema sketch — the cross-report's nullable-FK shape is the one to build).

Everything else is a **frozen artifact of the research run**, kept verbatim for provenance and auditability — quirks included:

- `LLM_Assistant_Long-Term_Memory_Research.md` — the main synthesized report as produced (its `[n]` markers refer to the in-document bibliography by number; they are plain-text notation, not markdown reference links). Corrections the cross-review forced are recorded in CROSS-REPORT §5, not retro-edited here.
- `agent_finals/` — the five investigating agents' final reports, unedited. Known warts stand as shipped: the MemPalace dive quotes an explicitly-labeled unverified rumor as color; some claims lack per-line evidence IDs.
- `cross-review/` — the three independent reviewer analyses. These are _inputs_ to CROSS-REPORT; where a reviewer's sketch differs from the cross-report (e.g. RLS predicate details), the cross-report's version is current.
- `evidence.jsonl` / `sources.jsonl` / `run_manifest.json` — the run's evidence corpus as captured. Schema is loose by design of the run, not curated after the fact: `confidence` mixes rubric strings (`high`/`moderate`/`low`) with per-agent numeric scores; a few records carry redundant fields; local checkout paths are as-of the run date. Rewriting these post-hoc would degrade their value as a record. Reproducibility standard for **future** runs (noted from PR #200 review): pin prompts, model versions, retrieval timestamps, and checkout SHAs in the manifest.

Later per-system deep dives (baro, gbrain, beads, Copilot Memory) live one directory up and fold into CROSS-REPORT §7.
