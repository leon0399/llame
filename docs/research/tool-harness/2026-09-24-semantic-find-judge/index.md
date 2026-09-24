---
okf_version: "0.2"
---

# Semantic find, jegrep and JUDGE research

Third research layer after [System One/Jev](../2026-09-23-system-one-jev/index.md)
and [question-directed reads](../2026-09-23-question-directed-read/index.md).
Examines OMP's implementation beyond its tool page, the referenced jegrep
program and benchmarks, and llame applications beyond Knowledge search.
Noncanonical; no feature implementation or scope approval.

- [Report](./report.md) - Pipeline, typed judgment backends, failure and cost
  semantics, reference comparison, benchmark limits and applications U13-U20.
- [Sources](./sources.jsonl) and [evidence](./evidence.jsonl) - Pinned source and
  dated provider documentation, with explicit observation boundaries.
- [Claims](./claims.jsonl) - Typed report claims joined to evidence.
- [Manifest](./run_manifest.json) - Scope and bundle-relative artifact paths.
- [Verification](./verification.json) and [review](./review.json) - Checks,
  independently assessed findings and source-claim corrections.
- [OMP mechanics probe](./probes/omp-find.mjs) and
  [output](./probes/omp-find-result.json) - Unchanged pinned source with explicit
  native-I/O/model/auth/timer doubles. No model-quality claim.
- [jegrep scoring probe](./probes/jegrep-metrics.py) and
  [output](./probes/jegrep-metrics-result.json) - Actual scorer semantics,
  benchmark artifact inventory and bounded-call arithmetic.
- [Session observation](./session-observation.json) - One real exploration call;
  model/endpoint not exposed, reported cost not independently verified billing.

Related references: [OMP](../../harnesses/oh-my-pi.md#semantic-find-and-jegrep),
[jegrep](../../harnesses/jegrep.md), and the [harness index](../../harnesses/index.md).
Source selection, answer generation and execution authorization remain separate.

## Reproduce the offline probes

From the repository root, with llame's installed Node/pnpm dependencies, Python
3.10+ and Git:

```bash
pnpm exec tsx docs/research/tool-harness/2026-09-24-semantic-find-judge/probes/omp-find.mjs /path/to/oh-my-pi
python3 docs/research/tool-harness/2026-09-24-semantic-find-judge/probes/jegrep-metrics.py /path/to/jegrep
```

Required checkout HEADs are OMP
`5fccbd0deee820049afa492dc3112272b163126f` and jegrep
`e6d5b842e5e88e576c3fcab9e2aa25081cb643af`. Scripts check those revisions.
The OMP probe uses the esbuild already supplied by tsx, not a new dependency or
Bun runtime installation. It does not execute the complete prompt engine,
native scanner, auth rotation or model. The Python probe does not compile Rust,
clone benchmark target repositories or rerun the published benchmark.
