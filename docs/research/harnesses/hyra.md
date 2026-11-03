---
type: Reference
title: "Hyra 2.0"
description: "Tencent Hunyuan research post that describes an Overall, Mission, and Worker harness; the public repository ships result artifacts, and the orchestrator source is absent."
resource: "https://hy.tencent.com/research/hyra2"
tags: [harness, research-agent, closed-source, artifacts]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "8443f9a9aae1a0b72c79e0b2908c79026b8e1555"
sources:
  - id: hyra-page
    resource: "https://hy.tencent.com/research/hyra2"
    title: "Hyra 2.0 research page, Chinese article read on 2026-11-03"
  - id: hyra-results-readme
    resource: "https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/README.md#L1-L10"
    title: "The repository collects solution artifacts and points at the Hyra 1.0 launch post"
  - id: hyra-results-license
    resource: "https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/LICENSE#L1-L5"
    title: "Tencent-authored materials are Apache-2.0 unless a third-party notice says otherwise"
  - id: hyra-hyinv-readme
    resource: "https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/AI4Science/hyinv/README.md#L1-L10"
    title: "HyInv README attributes training to Hyra 2.0 and describes the sampler"
  - id: hyra-hyplm-readme
    resource: "https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/AI4Science/hyplm_flash/README.md#L1-L6"
    title: "HyPLM-Flash README attributes training to Hyra 2.0"
  - id: hyra-design
    resource: "https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/AI4Science/hyinv/hyinv/sampler.py#L77-L112"
    title: "design samples sequences for a backbone and returns them"
---

# Hyra 2.0

- **Stack:** The research page is a client-rendered article. The linked code found from that page's results promise is [Tencent-Hunyuan/Hyra-results](https://github.com/Tencent-Hunyuan/Hyra-results) at `8443f9a9aae1a0b72c79e0b2908c79026b8e1555`, a tree of papers, Lean snippets, and model inference packages.[^hyra-results-readme] **License:** the results README's companion `LICENSE` says Tencent-authored materials are Apache-2.0 unless a file says otherwise.[^hyra-results-license] No license was found for an orchestrator, because that source was not in the tree.

Hyra 2.0 (Hunyuan Research Agent) is described by Tencent Hunyuan as a harness that builds reusable scientific tools. The page dated 2026-11-01 was read as rendered Chinese text on 2026-11-03 from `https://hy.tencent.com/research/hyra2`.[^hyra-page] That URL is not a git object, so the paragraphs below are the article's claims, and the file citations are the public tree. The article's English shell at `https://hy.tencent.ai/research/hyra2` was not compared sentence by sentence. No Hyra process was run. Accuracy, speed, and proof claims on the page and in the result READMEs were not reproduced.

**Study**

1. **The page describes three roles and three stores. That description is the article, not a program.** The section "为升级工具而生的 Harness" says research work is split into Overall, Mission, and Worker. Overall talks to people and sets priority. A Mission owns one research question for a long time. Workers read code, run experiments, and may disagree with the Mission; different workers may use different models. Tasks enter a persistent queue. An agent can set a next wake time. A Research Board holds ideas, experiments, evidence, and decisions. Completion reports must attach a code version, a result, a log, or a raw trace. A Review Worker is started on the original problem and the evidence, and the article says that is meant to reduce the effect of the executor's own conclusion. Project state, each agent's layered memory, and a shared library called Books are separate. Books entries are labeled 观察 (a single-run observation), 已验证 (independently reproduced), or 约定 (a convention a human confirms). Transferable methods are later written up as skills. Expensive compute and shared-knowledge updates need a human approval; already approved work continues. The same page says the system is wired to WeCom, an internal compute platform, and repositories. None of those sentences were found as code. A search of `Hyra-results` for the role names and for `HyProver` or `HyQEC` did not find an agent loop. Python files in that commit do use the word worker for process pools and GPU collectives, including `hyplm/engine/multi.py`, the PARP1 docking scripts, and `hyff`'s launcher. Those are numeric jobs. None of them is the Overall, Mission, and Worker harness the article names.
2. **What the tree actually contains is the output the page says will be published.** The results README calls the repository companion artifacts and says each folder holds a final solution and, where relevant, scripts that reproduce it. The launch link in that README is the Hyra 1.0 post, `https://hy.tencent.com/research/hyra`.[^hyra-results-readme] HyInv's README says the model was trained by Hyra 2.0 and documents a draft-then-rewrite sampler.[^hyra-hyinv-readme] `design` in `sampler.py` expands a backbone, calls `sample` or `fast_sample`, and returns sequences. The function takes a model, a structure, a count, and temperatures. It does not take a tool list or a queue.[^hyra-design] HyPLM-Flash's README makes the same training attribution.[^hyra-hyplm-readme] HyFF is a force-field package in the same commit. Those packages are callable models. They are the kind of reusable tool the article says the harness should leave behind, and they do not show how the harness decided to build them.
3. **Several page results have a paper in the tree, and several have no directory.** `AI4Science/petty_dimension_five/` and `AI4Science/yau_circle_action_conjecture/` contain PDFs. The article attributes those proofs to a workflow it names HyProver. The workflow's prompts, queue, and review worker are not in the folders. The article also describes HyQEC (a quantum-code constructor), a dexterous-hand search, and XiangShan performance and fuzz work. Those names have no directory in this commit. The HyInv technical report PDF in the same folder repeats that Hyra 2.0 trained the model. This note did not audit the proofs, the Lean snippets, or the reported metrics.
4. **The article's splits map onto llame only as proposals.** [Memory has distinct stores](../../../VISION.md#memory-has-distinct-stores): Knowledge is curated Markdown, episodic memory is the Chat and Run record, and semantic facts stay optional and deferred. Books' three labels would be a proposal for how a later Knowledge write is graded, and the article's human confirmation for 约定 matches the rule that the harness, not the model, accepts a standing change. A Review Worker that sees the evidence before the executor's conclusion is a proposal for a child Run with a fresh context. [Child Runs are the same architecture as a parent Run](../../../VISION.md#runs-are-the-unit-of-execution), and [child-agent orchestration is an explicit deferral](../../../VISION.md#explicit-deferrals). A wake time on a queue is a proposal in the same family as a schedule, and llame does not ship that scheduler. None of these are decided by this note.

**llame fit**

- Moderate: item 4's separation of project state, per-agent memory, and graded shared notes, read against the memory section that already exists. Adopting the labels would be a new proposal.
- Low: item 2, as an example of publishing the tool and withholding the agent. Useful as a boundary, and there is no loop to port.
- Low: item 1's approval-before-expensive-work sentence, which restates [the harness owns execution](../../../VISION.md#the-harness-owns-execution) without a mechanism to inspect.
- Avoid: treating the page's solved-problem counts, speedups, or proof claims as measurements made here.

**Caution:** The orchestrator, prompts, queue, and approval records are unpublished. The page is a blog post.[^hyra-page] The Apache-2.0 grant covers the results tree that was cloned, and third-party files in that tree keep their own notices.[^hyra-results-license] Uncertainty remains on any sentence that exists only in the article, including the WeCom and compute-platform integration and the results that have no directory in `8443f9a`.

[^hyra-page]: [Hyra 2.0 research page, Chinese article read on 2026-11-03](https://hy.tencent.com/research/hyra2)

[^hyra-results-readme]: [The repository collects solution artifacts and points at the Hyra 1.0 launch post](https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/README.md#L1-L10)

[^hyra-results-license]: [Tencent-authored materials are Apache-2.0 unless a third-party notice says otherwise](https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/LICENSE#L1-L5)

[^hyra-hyinv-readme]: [HyInv README attributes training to Hyra 2.0 and describes the sampler](https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/AI4Science/hyinv/README.md#L1-L10)

[^hyra-hyplm-readme]: [HyPLM-Flash README attributes training to Hyra 2.0](https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/AI4Science/hyplm_flash/README.md#L1-L6)

[^hyra-design]: [design samples sequences for a backbone and returns them](https://github.com/Tencent-Hunyuan/Hyra-results/blob/8443f9a9aae1a0b72c79e0b2908c79026b8e1555/AI4Science/hyinv/hyinv/sampler.py#L77-L112)
