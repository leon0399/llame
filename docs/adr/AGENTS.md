# Architecture decision records

An ADR records a hard-to-reverse, surprising decision that came from a real
trade-off, and why it was made. OpenSpec owns capability behavior and
[SPEC.md](../../SPEC.md) owns the current architecture. An ADR owns only the
reasoning behind a choice that a future reader would otherwise undo. Write one
when all three hold, and skip it otherwise.

## Names, not numbers

ADRs carry no sequence numbers. Parallel branches each pick "the next number"
and collide on merge, and a renumbering breaks every reference.

- **File name:** `YYYY-MM-DD-<slug>.md`, dated the day the decision was
  accepted. The slug names the decision in a few kebab-case words, such as
  `2026-11-18-chat-addresses-are-uuids.md`. If the same name already exists,
  pick another slug. Never append a counter.
- **Identity:** the slug, without the date. It is unique across `docs/adr/`.
  Reuse of a slug is refused even on a different date.
- **References:** a relative Markdown link whose text is the ADR's title, for
  example `[Chat addresses are UUIDs](2026-11-18-chat-addresses-are-uuids.md)`.
  Never write `ADR-7`, `ADR 0007`, or a bare number, in code, specs, issues,
  or commit messages.
- **Order:** the date prefix sorts the directory chronologically. Two
  decisions on the same day have no defined order, and none is implied.

## Format

```markdown
---
status: accepted
---

# <Short title of the decision>

<1-3 sentences: the context, what was decided, and why.>
```

`status` is `proposed`, `accepted`, `deprecated`, or
`superseded by [<title>](<file>.md)`. Add **Considered options** or
**Consequences** sections only when they carry information a reader needs.

## Rules

- An ADR is never renamed or deleted once merged. A changed decision gets a
  new ADR, and the old one's status links to it. A wording fix that leaves the
  decision unchanged is an edit, not a new decision.
- Link the ADR from the OpenSpec change or `SPEC.md` section the decision
  shaped, and link that source from the ADR.
- An ADR is explanation, so it may say "we" and weigh counterfactuals. It
  still follows the [prose rules](../AGENTS.md#prose).
- Before publishing, run `pnpm lint:markdown`, `pnpm exec oxfmt --check` on
  the changed files, and `git diff --check`. `pnpm lint:markdown` also runs
  `scripts/check-prose.mjs` over this directory.
