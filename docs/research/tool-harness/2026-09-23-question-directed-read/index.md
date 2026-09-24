---
okf_version: "0.2"
---

# Question-directed read research

Second research layer after the [System One/Jev study](../2026-09-23-system-one-jev/index.md),
covering [issue #849](https://github.com/leon0399/llame/issues/849), Apple LensVLM,
interchangeable local/hosted reader models and explicitly scoped read-only
investigation. Noncanonical: this bundle does not implement or approve `?q=`.

- [Report](./report.md) - Model/license comparison, bounded-source versus
  expanded investigation, concrete applications, economics and evaluation plan.
- [Source-aware investigation](./source-aware-investigation.md) - Integrated
  additions from the supplied analysis: OKF/code navigation, evidence intents,
  bounded area workers and visual-reader source mappings, with claim corrections.
- [Sources](./sources.jsonl) and [evidence](./evidence.jsonl) - Dated primary
  sources, pinned code observations and qualified measurements.
- [Claims](./claims.jsonl) - Typed claims and their evidence links.
- [Manifest](./run_manifest.json) - Research scope; paths resolve from the bundle.
- [Verification](./verification.json) - Executed checks, review outcomes and limits.
- [LensVLM mechanics probe](./probes/lens-preprocessing.py) and
  [recorded result](./probes/lens-preprocessing-result.json) - Normalization,
  page-call parsing and bounded expansion; no model or full renderer execution.
- [Economics script](./probes/economics.py) and
  [recorded scenarios](./probes/economics-result.json) - Explicit token/rate
  assumptions; not measured inference latency or task quality.
- [Locator-policy probe](./probes/locator-policy.mjs) and
  [recorded result](./probes/locator-policy-result.json) - Shows why a future
  question suffix must be separated before resource policy matching.

Related prior art: [harness index](../../harnesses/index.md),
[OMP](../../harnesses/oh-my-pi.md), [Spotify Shunt](../../harnesses/spotify-shunt.md),
and [SoL-Pi](../../harnesses/sol-pi.md). Source-selection judgments from Jev and
generative source answers from a reader are different operations.

The [semantic find/JUDGE layer](../2026-09-24-semantic-find-judge/index.md)
examines the selection stage in detail, including jegrep's implementation and
benchmarks. It complements this layer's generated answers with source ranking,
typed control hints and applications beyond Knowledge.

## Reproduce the offline checks

Requires Python 3.10+ and Git. From this directory:

```bash
python3 probes/lens-preprocessing.py /path/to/ml-lensvlm
python3 probes/economics.py
```

The first command requires a source checkout at
`10709a7e2a80bdf971628359d47e4bd35fce3d95` and verifies its revision. It executes
only named, unchanged pure-function ASTs; it needs no PyTorch, Transformers,
vLLM, Pillow, GPU or model weights. The second uses only the Python standard
library. Neither command makes an inference request or reads private Knowledge.

The additional policy probe requires llame's installed Node/pnpm development
dependencies:

```bash
pnpm exec tsx probes/locator-policy.mjs
```

It checks synthetic strings against the recommended operator-policy fixture,
not runtime defaults, and opens no credential target. Review corrections and
superseded draft evidence are recorded in [review.json](./review.json).
