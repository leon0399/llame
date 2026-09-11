---
type: Reference
title: "SoL-Pi"
description: "NVIDIA's standalone Pi extension for evidence-preserving efficiency mechanisms"
resource: "https://github.com/NVlabs/SoL-Pi"
observed:
  date: "2026-09-11"
  revision: "22277b7e0c3c46ba1259a6687f31fe39ade421a5"
sources:
  - id: readme-mechanisms-l14-l47
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/README.md#L14-L47"
    title: "Standalone extension and mechanism contracts"
  - id: readme-storage-security-l107-l121
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/README.md#L107-L121"
    title: "Storage and security boundaries"
  - id: readme-license-l145-l157
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/README.md#L145-L157"
    title: "Project status and license"
  - id: security-l3-l10
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/SECURITY.md#L3-L10"
    title: "Security policy and remote reduction warning"
  - id: observation-pack-l98-l156
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/observation-pack/observation.ts#L98-L156"
    title: "Observation archive and integrity checks"
  - id: observation-pack-l213-l251
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/observation-pack/observation.ts#L213-L251"
    title: "Bounded exact recall"
  - id: observation-pack-extension-l137-l209
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/observation-pack/index.ts#L137-L209"
    title: "Context projection and fail-open behavior"
  - id: reducer-receipt-l77-l176
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/evidence-preserving-reducer/receipt.ts#L77-L176"
    title: "Receipt validation and source binding"
  - id: reducer-runtime-l64-l176
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/evidence-preserving-reducer/index.ts#L64-L176"
    title: "Reducer candidate, fallback, and journal flow"
  - id: reducer-provider-l105-l163
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/evidence-preserving-reducer/provider.ts#L105-L163"
    title: "Pi-managed reducer model call"
  - id: online-compact-plan-l36-l74
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/plan.ts#L36-L74"
    title: "Structural plan validation and reported progress"
  - id: online-compact-economics-l122-l220
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/economics.ts#L122-L220"
    title: "Compaction horizon and breakeven decision"
  - id: online-compact-extension-l202-l312
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/extension.ts#L202-L312"
    title: "Completed-plan boundary trigger"
  - id: online-compact-extension-l314-l415
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/extension.ts#L314-L415"
    title: "Compaction and automatic continuation"
  - id: action-fusion-l70-l126
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/action-fusion/then-run.ts#L70-L126"
    title: "Mutation and follow-up command sequence"
  - id: action-fusion-queue-l53-l73
    resource: "https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/action-fusion/file-queue.ts#L53-L73"
    title: "Canonical per-file queue"
  - id: sol-pi-site-method-results
    resource: "https://nvlabs.github.io/SoL-Pi/#method"
    title: "Auto-research method and capability floor"
  - id: sol-pi-site-results
    resource: "https://nvlabs.github.io/SoL-Pi/#results"
    title: "Reported EdgeBench and efficiency results"
---

# SoL-Pi

- **Stack:** TypeScript/Node extension for Pi; Node >=22.19. The package keeps Pi as a peer runtime and leaves every mechanism disabled unless configured.[^readme-mechanisms-l14-l47] License: MIT.[^readme-license-l145-l157]

High-confidence source reference for context-efficiency mechanisms; moderate confidence in transferability to llame. SoL-Pi extends Pi rather than providing a session or tenancy system. It contributes four efficiency mechanisms through Pi's public extension APIs: Action Fusion, ObservationPack, Evidence-Preserving Reducer, and Online Context Compact. Its state and archives derive from a Pi session directory or session log, and its own security policy says it runs with the host Pi process's filesystem, process, network, and credential permissions; it is not a sandbox or permission boundary.[^readme-storage-security-l107-l121]

**Study**

1. **F60 — ObservationPack: projection-layer handles with exact recall.** Large pure-text tool results above 10 KiB are archived under an observation id derived from tool, call, and content hashes, sent in full for two provider requests, then projected as a stable handle plus head/tail excerpt. `obs_recall` reads bounded UTF-8-safe byte pages and returns `nextOffset`/`eof`; the stored session history is left intact because only the provider-context projection changes.[^observation-pack-l98-l156][^observation-pack-l213-l251][^observation-pack-extension-l137-l209] This is useful prior art for llame's canonical tool events plus a compact model-view projection: preserve the owner-authorized source artifact, expose an exact bounded recall tool, and record the projection decision as Run provenance. Reimplement it under llame's owner/RLS and durable Run authority; SoL-Pi's session-directory identity does not provide tenant isolation. Its optimization fallback preserves evidence: storage or archive failure leaves the original result in context.[^observation-pack-extension-l137-l209]

2. **F61 — Evidence-Preserving Reducer: model-assisted log reduction with quote verification.** For eligible long diagnostic results, SoL-Pi archives the raw body by SHA-256, sends it to a configured reducer model, and accepts a receipt only when the schema, source hash, observed success/failure status, and every quoted evidence fragment validate against the archived bytes. It rejects unverifiable or non-smaller receipts and journals fallback/applied decisions; a failed nested call leaves the original result unchanged.[^reducer-receipt-l77-l176][^reducer-runtime-l64-l176] This maps directly to a future llame tool-observation projection: model-derived summaries remain untrusted, source hashes and exact quotes make the receipt auditable, and the raw owner-scoped event remains available for readback. The reducer is narrow (diagnostic commands and Pi tool-result shapes), archives locally, and can send eligible logs to a remote model; the repository explicitly calls its likely-secret detector incomplete.[^security-l3-l10][^reducer-provider-l105-l163] Any llame adoption needs immutable Run binding, tenant authorization, and the existing no-secret model-context rules. The reducer call must also have an explicitly authorized provider and data-egress policy; permission to execute the source tool does not grant permission to send its output to an additional model.

3. **F62 — Online Context Compact: completed-step boundaries plus economic gating.** The extension accepts a model-authored plan after validating its structure and statuses, then records a boundary when a step transitions to `completed`. This is a model-reported progress signal, not proof of task completeness.[^online-compact-plan-l36-l74] It estimates the remaining request horizon from prior boundary intervals, and compares compaction breakeven against projected future requests, context-window pressure, cache cost, and carried debt.[^online-compact-extension-l202-l312][^online-compact-economics-l122-l220] After a successful native compaction it appends a hidden continuation message, waits for the new turn to settle, and restores versioned state from the Pi session log.[^online-compact-extension-l314-l415] This is useful trigger/economics prior art for llame's explicit compaction contract: consider compaction at an explicit progress boundary backed by llame-owned execution evidence and retain completion evidence/remaining work as a durable context item. Keep the policy separate from SoL-Pi's session-local implementation. llame's compaction and Run state require database-backed ownership, reconnect/replay semantics, immutable receipts, and terminal transaction rules; `context.abort()` plus a hidden Pi continuation message is not a durable Run transition.

4. **F63 — Action Fusion: mutation and validation in one model turn.** `edit`/`write` accept an optional `then_run`, hold a canonical per-file in-memory queue across the mutation and command, hash-check the target before running the command, and return the mutation plus command output as one observation.[^action-fusion-l70-l126][^action-fusion-queue-l53-l73] This identifies a useful latency optimization for llame's native file tools when a validation command is predictable. A llame equivalent must independently authorize the mutation and follow-up command; an allowed file edit cannot grant Bash authority. It must keep their durable attempts/results as separate recoverable events, with replay quarantine and unknown-outcome handling; SoL-Pi preserves a successful mutation when validation fails and has no rollback or cross-worker durable fence. Treat Action Fusion as an optional adapter-level optimization, not a new atomic mutation contract.

**Research/evaluation relevance:** The project page describes 152 proposed directions, four surviving mechanisms, capability and efficiency gates, and held-out validation that excludes test feedback from later search.[^sol-pi-site-method-results] It reports roughly 94% of Pi's average EdgeBench score, 45–49% fewer tokens and about one-third lower cost versus Pi, plus larger reductions versus native harnesses.[^sol-pi-site-results] These figures are vendor-reported website claims and were not independently reproduced in this inspection; the retained-score figure does not establish zero capability loss; use the evaluation discipline as research prior art, not the percentages as llame evidence. The page itself notes that per-mechanism capability losses can accumulate when mechanisms are combined.[^sol-pi-site-method-results]

[^readme-mechanisms-l14-l47]: [Standalone extension and mechanism contracts](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/README.md#L14-L47)

[^readme-storage-security-l107-l121]: [Storage and security boundaries](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/README.md#L107-L121)

[^readme-license-l145-l157]: [Project status and license](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/README.md#L145-L157)

[^security-l3-l10]: [Security policy and remote reduction warning](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/SECURITY.md#L3-L10)

[^observation-pack-l98-l156]: [Observation archive and integrity checks](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/observation-pack/observation.ts#L98-L156)

[^observation-pack-l213-l251]: [Bounded exact recall](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/observation-pack/observation.ts#L213-L251)

[^observation-pack-extension-l137-l209]: [Context projection and fail-open behavior](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/observation-pack/index.ts#L137-L209)

[^reducer-receipt-l77-l176]: [Receipt validation and source binding](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/evidence-preserving-reducer/receipt.ts#L77-L176)

[^reducer-runtime-l64-l176]: [Reducer candidate, fallback, and journal flow](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/evidence-preserving-reducer/index.ts#L64-L176)

[^reducer-provider-l105-l163]: [Pi-managed reducer model call](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/evidence-preserving-reducer/provider.ts#L105-L163)

[^online-compact-economics-l122-l220]: [Compaction horizon and breakeven decision](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/economics.ts#L122-L220)

[^online-compact-extension-l202-l312]: [Completed-plan boundary trigger](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/extension.ts#L202-L312)

[^online-compact-extension-l314-l415]: [Compaction and automatic continuation](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/extension.ts#L314-L415)

[^action-fusion-l70-l126]: [Mutation and follow-up command sequence](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/action-fusion/then-run.ts#L70-L126)

[^action-fusion-queue-l53-l73]: [Canonical per-file queue](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/action-fusion/file-queue.ts#L53-L73)

[^sol-pi-site-method-results]: [SoL-Pi auto-research method and capability floor](https://nvlabs.github.io/SoL-Pi/#method)

[^sol-pi-site-results]: [SoL-Pi reported results](https://nvlabs.github.io/SoL-Pi/#results)

[^online-compact-plan-l36-l74]: [Structural plan validation and reported progress](https://github.com/NVlabs/SoL-Pi/blob/22277b7e0c3c46ba1259a6687f31fe39ade421a5/src/sol-pi/extensions/online-context-compact/plan.ts#L36-L74)
