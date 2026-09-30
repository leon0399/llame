---
type: Research
title: "Model system prompt research provenance"
description: "Records that the public system_prompts_leaks corpus served only as comparative research provenance for llame's prompt architecture, with no prompt body copied into runtime assets."
tags: [system-prompts, provenance, licensing, prior-art, prompt-architecture]
status: stable
---

# Model system prompt research provenance

The public [`system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks)
corpus served only as comparative research provenance while defining llame's
model-specific prompt architecture. No prompt body from it is copied into llame's
runtime assets. The shipped default is a deliberately moderate, project-owned
baseline; concrete production-grade per-model prompt authoring and evaluation remain
follow-up work.
