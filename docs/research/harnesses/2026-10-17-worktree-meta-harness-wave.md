---
type: Research
title: "2026-10 worktree and meta-harness wave"
description: "Comparative map of twenty-one desktop worktree hosts, meta-harnesses, provider proxies and peer coding agents inspected for llame positioning."
tags: [harness, worktrees, meta-harness, comparison, peer-executor]
status: draft
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
sources:
  - id: wave-index
    resource: "./index.md"
    title: "Harnesses index ordering and authority notes"
---

# 2026-10 worktree and meta-harness wave

Source and marketing inspection of twenty-one products listed for this sweep.
Nothing was run. Closed products have no public app revision; open checkouts are
pinned in their Reference entries. SPEC and OpenSpec win any disagreement.

## Why this wave matters

Almost every product in the list sells the same outer shape: BYO coding-agent
CLIs, Git worktree (or container) isolation, a board or tab UI, and review/merge
without leaving the host. That is the **desktop worktree-host** niche already
represented by [Shipyard](./shipyard.md), [Orca](./orca.md), [bb](./bb.md) and
[Zeron](./zeron.md). llame is not competing as another Mac worktree IDE; it is a
server-owned Chat/Run meta-harness with RLS. The useful question is which
mechanisms transfer to peer adapters, approvals, process placement and product
vocabulary — and which are local-desktop dead ends.

## Buckets

| Bucket                           | Members                                                                                                                                                  | Transfer to llame                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Open meta-harness / policy layer | [Omnigent](./omnigent.md)                                                                                                                                | High for policies, sandboxes, multi-harness composition                        |
| Open worktree ADE / daemon       | [Paseo](./paseo.md), [Orchestrator.inc](./orchestrator.md), [Jean](./jean.md), [Emdash](./emdash.md), [Superset](./superset.md) (ELv2)                   | Moderate for ACP adapters, worktree lifecycle, mobile/relay patterns           |
| Native desktop control plane     | [Waku](./waku.md), closed [super.engineering](./super-engineering.md)                                                                                    | Moderate for daemon/RPC split and provider-normalized sessions                 |
| Codex/Desktop embedding          | [CodexHost](./codex-host.md)                                                                                                                             | Low–moderate: adapter packing into a foreign desktop                           |
| Provider proxy                   | [OpenCodex](./opencodex.md)                                                                                                                              | Low for Chat/Run; moderate if llame ever needs multi-provider wire translation |
| Peer coding agent                | [Qwen Code](./qwen-code.md)                                                                                                                              | Moderate as another ACP/CLI executor peer like Gemini CLI                      |
| Closed worktree hosts            | [Conductor](./conductor.md), [Agentastic](./agentastic.md), [MonoCode](./monocode.md) when treated as product, Traycer/Synara/Silo/Ghostex/Tortie/Kandev | Positioning only unless source reveals a novel contract                        |
| Closed meta-harness branding     | [Solo](./solo.md)                                                                                                                                        | High for vocabulary (`solo.yml` shared processes); low for identity            |

## Patterns that recur

1. **Worktree ≠ sandbox.** Nearly every host says agents cannot overwrite each
   other mid-task, then admits merge conflicts and same-user OS privileges
   remain. llame should keep that sentence in every peer-worktree discussion.
2. **ACP is becoming table stakes.** Paseo, Agentastic, Omnigent and several
   others advertise ACP or structured chat for provider-agnostic control. That
   supports llame's peer-adapter direction already recorded against Zeron/Orca.
3. **Mobile is a relay problem.** Paseo, Superset, Orchestrator, Agentastic and
   Conductor Pro all sell phone clients. The interesting contract is
   end-to-end encryption and where the daemon lives, not the UI chrome.
4. **Shared processes vs per-agent processes.** Solo's `solo.yml` is the clearest
   statement that agents should debug the stack that is already running. Most
   worktree hosts still spawn per-worktree setup scripts instead.
5. **Manager / lead agents auto-approve.** Agentastic Manager Agents and several
   orchestrator boards escalate only human-needed events. llame must not import
   unattended auto-approve as a default for owner-scoped Runs.

## Ranking for alpha (relative to this wave only)

Ordered by reusable mechanism density for llame, not by product polish:

1. Omnigent — policies, sandboxes, multi-harness composition
2. Paseo — open ADE, daemon/clients, ACP, plugins, mobile
3. Orchestrator.inc — PR/CI-attached worker lifecycle and status derivation
4. Waku — daemon/RPC, provider-normalized sessions, conversation-aware rewind
5. Jean / Emdash / Superset — mature worktree-host UX checklists (Superset ELv2)
6. Solo — meta-harness vocabulary and shared-process manifests (closed)
7. Qwen Code — peer executor surface
8. CodexHost / OpenCodex — specialized embedding and proxy seams
9. Remaining closed worktree IDEs — positioning and feature checklists only

Existing primary references ([OMP](./oh-my-pi.md), [OpenClaw](./openclaw.md),
Zeron, Orca, bb) stay above this wave for alpha decisions.

## Method

- Open GitHub trees librarized under `~/.cache/checkouts/github.com/...` and
  inspected at the revisions recorded in each Reference entry.
- Closed products: first-party sites and docs only; GitHub orgs checked for
  public app source and recorded when absent or colliding.
- No independent benchmarks. Adoption requires a separate llame decision.

[^wave-index]
