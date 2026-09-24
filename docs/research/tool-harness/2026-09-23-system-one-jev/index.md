---
okf_version: "0.2"
---

# System One and Jev research

Noncanonical research on TypeSafe Jev, OMP's JUDGE role, extractive compaction,
community implementations, and applicability to llame. Product behavior remains
owned by [SPEC](../../../../SPEC.md) and OpenSpec; this bundle approves no feature.

Related entry points: [harness index](../../harnesses/index.md),
[OMP JUDGE](../../harnesses/oh-my-pi.md#typed-judgments-and-jev),
[SoL-Pi](../../tools/sol-pi.md), and
[Spotify Shunt](../../tools/spotify-shunt.md).

Follow-on: [question-directed reads and reader-model comparison](../2026-09-23-question-directed-read/index.md)
examines LensVLM, Qwen and cheap/free hosted models for `?q=` source answers and
bounded investigation. Jev can select or judge evidence; a generative reader
produces the source-grounded answer.

Third layer: [semantic find, jegrep and JUDGE](../2026-09-24-semantic-find-judge/index.md)
traces candidate selection and typed judgments, audits the reference benchmark,
and develops applications U13-U20 beyond Knowledge search.

- [Cookbook applicability and ideas](./cookbooks.md) - All 18 TypeSafe recipes,
  direct reuse versus adaptation, and applications U21-U29. A concise,
  separately cited analysis; no additional experiments or review campaign.
- [Source-aware investigation](../2026-09-23-question-directed-read/source-aware-investigation.md) -
  Combines typed judgments with source-native navigation and evidence-carrying
  workers; includes applications U30-U31 and material external-claim corrections.

- [Research report](./report.md) - Findings, the five supplied application
  assessments, six additional llame use cases (U1-U6), counterevidence,
  priorities, and stable source footnotes.
- [Source registry](./sources.jsonl) - Source identities and retrieval metadata.
- [Evidence ledger](./evidence.jsonl) - Source-backed observations and measurement
  qualifications, joined to the report through stable source IDs.
- [Claim ledger](./claims.jsonl) - Factual claims, synthesis and recommendations
  linked to supporting evidence.
- [Run manifest](./run_manifest.json) - Research scope and artifact paths;
  `report_dir` resolves relative to the manifest.
- [Verification record](./verification.json) - Executed checks and their limits.
- [Review record](./review.json) - Independent review findings and dispositions.
- [Adapter experiment](./probes/adapter-probe.mjs) and
  [recorded output](./probes/adapter-probe-result.json) - Installed SDK wire shape
  for `allowedTools` versus `activeTools`, with all HTTP intercepted locally.
- [Adapter source evidence](./probes/adapter-source-evidence.json) - Inspected
  package version, source hash, protocol-term counts and wire-encoding excerpt.
- [Compaction experiment](./probes/compaction-probe.mjs) and
  [recorded output](./probes/compaction-probe-result.json) - Synthetic histories
  prove the upstream selector omits result content. Injected scores; no Jev call.

## Reproduce the offline experiments

From this directory, after installing llame's pinned dependencies:

```bash
node probes/adapter-probe.mjs
pnpm exec tsx probes/compaction-probe.mjs /path/to/fast-jev-compaction
```

The second command requires a checkout at
`e3f262a7f4d42bd8dd32ced30d26176f7cb545b0` and checks that revision before import.
These experiments establish local mechanics, not model quality, remote latency,
or provider cache-hit rates. No controlled live inference benchmark was run.
