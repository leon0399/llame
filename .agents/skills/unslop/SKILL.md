---
name: unslop
description: Cut generated-prose patterns from llame documentation, ADRs, PR bodies, and commit messages. Use when writing or editing prose under docs/, or when reviewing it.
---

# Unslop

Edit text to remove patterns typical of generated prose. Scan for the patterns
below, then rewrite. Preserve meaning and match the intended tone.

Rule numbers are stable ids that other documents cite. A removed rule leaves a
gap.

## llame adaptation

Adapted from `pstack/skills/unslop/SKILL.md` in
[cursor/plugins](https://github.com/cursor/plugins/blob/2f87c854fe3e2fcda44ca86b46ede35aad3c46b7/pstack/skills/unslop/SKILL.md),
MIT License, copyright 2026 Lauren Tan. The notice is in [LICENSE](LICENSE).
Changes from upstream:

- The skill can load on its own. Upstream disables model invocation.
- A term that `docs/product/glossary.md` or `README.md` defines overrides rules
  7, 26, and 31. "Meta-harness" stays, because the README names llame with it.
- `docs/AGENTS.md` owns the page-level prose rules and cites these numbers.
  `scripts/check-prose.mjs` enforces rules 7, 13, and 19 on `docs/adr/`.

## Rules

3. No trailing "-ing" phrases that add no fact ("highlighting...", "ensuring...").
5. No vague attributions ("experts believe"). Name the source or delete.
7. No AI vocabulary: additionally, crucial, delve, enhance, foster, landscape, pivotal, showcase, testament, underscore, vibrant.
8. Say "is" or "has", not "serves as", "stands as", "boasts", "features".
9. No "not just X, but Y". State the point.
10. Don't force ideas into threes.
11. One name per thing. Repeat it.
12. No "from X to Y" unless X and Y sit on a real scale.
13. No em dashes, en dashes, or hyphens used as dashes, and no parentheses in their place. Use a period or a comma.
14. A colon goes before a list or an example, never mid-sentence as a connector.
15. Don't bold every proper noun or acronym.
16. No bold label and colon that restates its line ("**Performance:** Performance improved..."). A bold lead-in that ends in a period and adds new detail is fine.
17. Sentence case headings.
18. No decorative emojis.
19. Straight quotes.
20. No chatbot phrases ("I hope this helps!", "Let me know if...").
22. No praise or agreement openers. Respond directly.
23. Cut filler. "In order to" becomes "to". Delete "it is important to note that".
24. One hedge at most: "may".
25. No generic conclusions. State specific plans or facts.
26. No abstract metaphor nouns: substrate, wedge, vector, nexus, primitive, harness, surface, scaffolding, paradigm, ratchet, north star, flywheel. Use the concrete word.
27. Say what it does, not how it feels. Name the mechanism or the number. Cut a sentence that could appear unchanged in another project's docs.
28. One idea per sentence. Split a sentence the reader has to reread.
29. Active voice. Name the actor unless it is unknown or doesn't matter.
30. Cut adverbs or use a stronger verb. Give the number.
31. Use the plain word: "use", not "utilize" or "leverage".
32. No metaphor, aphorism, personified code, or figurative verb where a literal phrase exists.
33. Write whole sentences with their articles and verbs. Spell out arrows and abbreviations.
