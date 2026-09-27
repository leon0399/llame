---
type: Reference
title: "OKF (Open Knowledge Format)"
description: "Optional authorship, verification, and freshness metadata"
resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format"
observed:
  date: "2026-09-27"
  revision: "ad30107c31c06aec8a7d5636e0d1058118604e6f"
sources:
  - id: spec-md-l736-l764
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L736-L764"
    title: "conformance rules"
  - id: spec-md-l366-l410
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L366-L410"
    title: "Separate fields"
  - id: spec-md-l424-l432
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L424-L432"
    title: "stale_after"
  - id: iodigital-okf-context
    resource: "https://techhub.iodigital.com/articles/using-okf-to-provide-long-term-context-to-your-agent/using-okf-to-provide-long-term-context-to-your-agent"
    title: "Using OKF to provide long term context to your agent"
---

# OKF (Open Knowledge Format)

- **Stack:** Markdown/YAML specification and Python reference agent; Apache-2.0

High-confidence reference for optional Knowledge provenance metadata. Its
conformance rules[^spec-md-l736-l764]
require typed frontmatter in every non-reserved Markdown file. Making that a
Knowledge Space requirement would exclude existing owner notes; retain llame's
arbitrary-file read contract.

**llame fit: study**

1. **Authorship and verification.** Separate fields[^spec-md-l366-l410]
   distinguish content generation from a list of independent verification events.
   Useful vocabulary for future recoverable agent writes, where an edit and a
   factual recheck have different provenance.
2. **Explicit freshness declaration.** `stale_after`[^spec-md-l424-l432]
   is an absolute timestamp. A consumer can compare it with the current time;
   this is an authored expiry rule, not evidence that the content remains true
   before that instant.
3. **Repository context workflow.** A practice report[^iodigital-okf-context]
   (Oscar Reyes, iO Digital, 2026-09-11) keeps an OKF bundle beside the code
   and tells every session, through `AGENTS.md`, to read the root `index.md`
   and then the relevant directory index, updating a concept and its `log.md`
   when a decision changes. It argues that plans are disposable while designs
   carry the reasoning that outlives them, and that MCP can serve a bundle
   without replacing it. This matches how `docs/research` is already
   organized. The author calls it an early report after a few weeks of use; it
   has no comparative evidence.

**Caution:** Trust tiers are derived from declared actor names and are explicitly
advisory. A `human:` label supplies neither authenticated verification nor
access control. llame would still enforce ownership, safe filesystem access,
and model-input trust outside the Markdown metadata. Reserved `index.md` and
`log.md` conventions also prevent treating an arbitrary existing vault as an
already-conformant OKF bundle.

[^spec-md-l736-l764]: [conformance rules](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L736-L764)

[^spec-md-l366-l410]: [Separate fields](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L366-L410)

[^spec-md-l424-l432]: [`stale_after`](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L424-L432)

[^iodigital-okf-context]: [Using OKF to provide long term context to your agent](https://techhub.iodigital.com/articles/using-okf-to-provide-long-term-context-to-your-agent/using-okf-to-provide-long-term-context-to-your-agent)
