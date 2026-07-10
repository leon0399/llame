# Prompt templating — fill-in variables for saved prompts

## Objective

The prompt library (just shipped) inserts a saved prompt's body verbatim on
`/name`. Make prompts PARAMETERIZED: a prompt body can contain `{{placeholder}}`
variables (e.g. `/translate` → "Translate to {{language}}: {{text}}"). On insert,
if the prompt has placeholders, a small fill-in dialog collects a value per
unique placeholder, then the substituted text goes into the composer. This
completes the prompt library into genuinely reusable prompts — a productivity
multiplier — well-integrated with what shipped last iteration.

## Why a fill dialog (not inline cursor-jump)

Open WebUI does inline cursor-jump (tab through `[...]` placeholders), which needs
the textarea DOM node + selection/position tracking across edits (a
snippet-expansion problem, fiddly, and the naive "jump to first only" version is
an undisclosed multi-placeholder partial). A fill dialog sidesteps ALL of that:
one field per placeholder, substitute, done — clean, complete for any number of
variables, and fully unit-testable (pure extract/fill), no ref plumbing.

## Design

- Pure (`lib/services/prompts/templating.ts`, unit-tested). Regex
  `/\{\{([^{}]*?)\}\}/g` (fresh per call — no shared `lastIndex`; `[^{}]*?` has no
  overlapping quantifier → no catastrophic backtracking); the name is `.trim()`ed
  and empty names (`{{}}`/`{{ }}`) skipped in CODE, not the regex.
  - `extractPlaceholders(content)` → the UNIQUE placeholder names in first-seen
    order.
  - `fillPlaceholders(content, values)` → implemented as a SINGLE
    `content.replace(regex, callback)` pass over the ORIGINAL string (never
    per-key sequential `replaceAll` — that would re-expand a literal `{{x}}` a
    user typed into an earlier field). Unfilled/missing → empty; duplicates all
    replaced; a no-placeholder body passes through unchanged.
- `usePromptMenu` select branch: on selecting a prompt,
  `extractPlaceholders(content).length > 0` → DISMISS the `/` menu via
  `setDismissedFor(input)` (the SAME primitive Escape uses — `setDismissedFor(
  null)` would leave the menu open behind the dialog and reopen it on Cancel,
  since `input` still holds the `/name` token) + open a `FillPromptDialog`; else
  `onInsert(content)` as today. The dialog: a labelled input per placeholder
  (the field `id`/`htmlFor` is INDEX-based — a placeholder name may contain
  spaces/punctuation, invalid in a DOM id) → "Insert" runs `onInsert(
  fillPlaceholders(content, values))` and closes; Cancel closes (menu stays
  dismissed — no reopen loop). Enter in the last field submits.
- Settings: a one-line hint in the prompt editor that a body may use
  `{{placeholders}}` (no schema/validation change — placeholders are plain text
  in `content`).

## Testability

- `extractPlaceholders`: unique + ordered; trims whitespace; dedupes a repeated
  name; `[]` for a body with none; ignores empty `{{}}`.
- `fillPlaceholders`: substitutes each; fills a duplicate everywhere; unfilled →
  empty; no-placeholder body unchanged; a value containing `{{...}}` is NOT
  re-expanded (single pass).
- The dialog is a thin declarative form over the pure fns (covered by tsc/build,
  consistent with the other UI); the select-branch decision uses the pure
  `extractPlaceholders`.

## Non-goals (named)

- Inline cursor-jump / tab-through templating (the dialog is the chosen UX).
  Typed placeholders, default values, or required-field validation. Magic
  variables (`{{clipboard}}`, `{{date}}`, `{{selection}}`) — a named follow-up.
  Persisting last-used values. Placeholders in the prompt NAME (name stays a
  slug).

## Revision history

- **v2 (2026-07-03):** Round-1 review. Both reviewers verified the pure
  single-pass fill (no double-expansion), the no-schema-change (content is
  unconstrained text), and confirmed the menu/dialog + cancel-reopen handling is
  correct in code (`setDismissedFor(input)` in the placeholder branch). Fixes:
  the adversarial reviewer caught a real code bug — the placeholder NAME was used
  verbatim as a DOM `id`/`htmlFor`, invalid when it contains spaces
  (`{{target language}}`) → now index-based. Doc corrected to cite the actual
  ReDoS-safe regex, mandate single-pass `replace(regex, callback)` (not per-key
  sequential), and pin the `setDismissedFor(input)` dismiss mechanism. Settings
  hint added.
- **v1 (2026-07-03):** Initial.
