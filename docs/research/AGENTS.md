---
type: Agent Instructions
title: "Research bundle instructions"
description: "How to add and maintain noncanonical research under docs/research as one Open Knowledge Format v0.2 bundle."
---

# Research bundle

`docs/research/` holds noncanonical evidence: [SPEC.md](../../SPEC.md), OpenSpec
and shipped code win any disagreement. The directory is one
[Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md)
bundle rooted here; the [OKF reference entry](./standards/open-knowledge-format.md)
summarizes it. Author every research document as an OKF concept.

- Every `.md` file except `index.md` and `log.md` starts with YAML frontmatter
  carrying a non-empty `type`: `Research` for studies, `Reference` for
  harness, tool and standard entries. Add `title`, a one-sentence
  `description`, `tags` and `status` (`draft`, `stable` or `deprecated`).
- Record provenance only when it is known: `generated: { by, at }` with an
  actor such as `omp/<model>` or `human:<id>`, and `sources` entries with
  stable `id`s cited by matching `[^id]` footnotes. Pin source URLs to a commit
  or version. Never invent an actor, source or verification.
- `index.md` has no frontmatter; only this directory's root index declares
  `okf_version`. When a concept is added, moved or retired, update its
  directory's `index.md` entry with the concept's description, and give every
  new directory an `index.md`.
- Mark superseded or frozen documents `status: deprecated` instead of deleting
  them.
- Keep dated names (`YYYY-MM-DD-<topic>.md` or a dated bundle directory) and put
  machine evidence (JSON, JSONL, probes) beside the concept that cites it.
- Before publishing, run `pnpm lint:markdown`, `pnpm exec prettier --check` on
  the changed files and `git diff --check`.

## Bundle index

@index.md
