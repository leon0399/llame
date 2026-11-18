---
type: Research
title: "Per-call overhead of Machine daemon tools"
description: "Measures today's Node Machine daemon request path against direct calls to the same fs.read and fs.grep operations."
tags: [machines, tools, benchmark, daemon]
status: draft
summary: "Measures the current Node daemon boundary and JSON serialization cost for read and grep operations, not a prediction for Rust or gRPC."
read_when:
  - estimating the cost of routing host native tools through the current Machine daemon
  - deciding what current-stack measurements imply for a future daemon cutover
observed:
  date: "2026-11-18"
---

# Per-call overhead of Machine daemon tools

## Finding

On this host, routing the same read and grep operations through a separate Node daemon and JSON-RPC line frames usually added about 1 ms to sequential calls. For grep, that is a small portion of a roughly 23 ms in-process call; for a quick README read it is a substantial fraction of a roughly 3.6 ms call. At eight concurrent calls, the observed p50 difference ranged from about 1 ms to 8.5 ms across these cases. This is evidence about the current process boundary and serialization path only; it is not a prediction of a Rust/gRPC implementation. Confidence is moderate for these workloads on this machine, and low for generalization to other hosts or workload shapes.

## Method

The TypeScript driver calls `readOperation` and `grepOperation` directly for the in-process path. The comparison path starts the built `llame-machine serve --stdio` executable as a child process, registers the checkout as a temporary root using `LLAME_MACHINE_CONFIG_DIR`, handshakes, and sends the same operation parameters over JSON-RPC line frames. Both paths run the same daemon operations and underlying read/grep engines, including root guard checks. The measured request time includes the operation, daemon dispatch and protocol framing/JSON serialization, plus driver-side child stdio; it excludes one-time build and root registration. The handshake was measured separately. Each case uses five warmup calls followed by 40 measured calls, sequentially and with batches of eight in flight. Percentiles are across individual calls; throughput is total calls divided by measured batch wall time.

The checkout itself was the corpus. Read workloads included a small README, its first 40 lines, three regular project source files (including a ~100 KiB generated text file), and ranged reads; grep searched the checkout with `apps/` and `packages/` content in scope, patterns `export async function` and `TODO`, and bounded output. Grep used the same bounded params in both paths. The temporary large-file fixture was removed by the driver.

Machine facts: AMD Ryzen 7 5800HS with Radeon Graphics; 8 physical cores / 16 logical CPUs; 15 GiB RAM reported by WSL; Linux 6.18.33.2-microsoft-standard-WSL2; Node v22.23.3; checkout commit `efbc39161966daf086c5e4b979605578db79e0d3`.

## Results

Times are milliseconds (ms); throughput is calls per second (calls/s). Delta is daemon minus in-process latency; ratio is daemon / in-process latency. Sequential p50/p95 and throughput are shown, followed by p50/p95 and throughput at concurrency 8.

| Workload                              | Seq p50: in-process → daemon (delta; ratio) | Seq p95: in-process → daemon (delta; ratio) | Seq throughput: in-process → daemon | 8-in-flight p50: in-process → daemon (delta; ratio) | 8-in-flight p95: in-process → daemon (delta; ratio) | 8-in-flight throughput: in-process → daemon |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| Small read (`README.md`)              | 3.42 → 4.52 (+1.10; 1.32×)                  | 4.15 → 5.59 (+1.44; 1.35×)                  | 285.8 → 216.1 (-24.4%)              | 20.17 → 21.94 (+1.77; 1.09×)                        | 24.31 → 30.42 (+6.11; 1.25×)                        | 372.8 → 329.8 (-11.6%)                      |
| Ranged read (`README.md`, lines 1–40) | 2.89 → 4.01 (+1.11; 1.38×)                  | 3.39 → 4.43 (+1.04; 1.31×)                  | 343.2 → 255.5 (-25.6%)              | 18.60 → 21.80 (+3.20; 1.17×)                        | 19.85 → 23.18 (+3.33; 1.17×)                        | 422.0 → 353.4 (-16.3%)                      |
| ~100 KiB read                         | 10.31 → 11.21 (+0.90; 1.09×)                | 11.00 → 11.68 (+0.68; 1.06×)                | 96.6 → 89.0 (-7.9%)                 | 77.07 → 84.23 (+7.16; 1.09×)                        | 81.53 → 85.94 (+4.41; 1.05×)                        | 102.9 → 94.7 (-8.0%)                        |
| Bounded grep (`apps/` + `packages/`)  | 22.68 → 23.70 (+1.02; 1.04×)                | 25.53 → 25.44 (-0.09; 1.00×)                | 43.7 → 42.1 (-3.7%)                 | 160.50 → 162.12 (+1.61; 1.01×)                      | 204.53 → 221.28 (+16.75; 1.08×)                     | 47.3 → 46.1 (-2.4%)                         |

Handshake from before the first operation: 234.32 ms. At the end of the measured run, the daemon child RSS was 187,792 KiB and the driver RSS was 160,128 KiB. These are single-point process snapshots, not per-call memory deltas or startup RSS distributions.

The 100 KiB read response remained below the protocol's 1 MiB frame/message bound; no measured request was capped by it. The bounded grep response also remained within the selected result bounds. This experiment did not measure behavior for results near or above the cap, stream exhaustion, or many concurrent sessions.

## Interpretation and caveats

The per-call boundary matters most when the engine work is small: small reads paid around 1–1.5 ms at the sequential p50, while the sampled grep scan cost was around 23 ms before routing. Throughput differences and tail percentiles were noisy and not uniformly worse for the daemon, particularly under concurrency; this sample does not justify treating every measured delta as a stable constant. The concurrency-8 timings include contention from the shared host and a single daemon process. The direct path invokes the exact daemon operation in-process rather than a separate hub-side native implementation, which intentionally isolates the current daemon/protocol boundary instead of comparing unlike engine behavior.

This is an indicator for the cutover discussion, not a verdict on the later Rust/gRPC daemon. It excludes network transport, remote hosts, hub-side permission/model work, process cold-start distributions, and production traffic. There were 40 calls per case after warmup on one WSL2 host; repeating across machines and larger operation sets could change both tail latency and throughput.

## Reproduction

From the repository root, with dependencies installed:

```sh
pnpm --filter 'machine^...' build
pnpm --filter machine build
pnpm exec tsx docs/research/tool-harness/2026-11-18-daemon-call-overhead/benchmark.ts
```

The driver prints machine-level latency, throughput, handshake, and RSS results as JSON. Its child daemon uses a temporary configuration directory and its generated corpus file is cleaned up after the run. The source is [benchmark.ts](./2026-11-18-daemon-call-overhead/benchmark.ts).
