# Message regex tester — design

Status: implemented in this change. Noncanonical design record; behavior
shipped per this doc unless the code says otherwise.

## What it is

An inline affordance in chat messages (both roles, streaming and shared
read-only views): any regex literal that appears in message content — prose,
inline code, or a fenced code block — gets a dotted underline. Clicking it
opens a small floating menu with a single option, **Test regex**. Selecting it
morphs the surface into a floating tester: a borderless input
("Enter text to match…") that evaluates live against the pattern. Non-matching
input shows a muted **No match** row; matching input highlights the matched
span(s) in green inside the input, shows a check mark, and lists the matched
value(s) under a **Match** heading (all matches for a `g` pattern, the first
otherwise — the reference shows match values only, no capture-group listing).

Behavioral/visual reference: Linear's regex tester
(https://x.com/TimZolleis/status/2083074169244164559) and the re-implementation
at https://x.com/ieeeedan/status/2085008493354885424. Frame-by-frame findings:

- Dotted underline under the whole literal (`/…/flags`), token syntax colors
  preserved in code blocks; underline inherits the token color.
- Division (`width / height / 2`), file paths, URLs, comments are _not_
  underlined — precision over recall.
- The menu item shows a regex glyph + "Test regex", anchored at the literal.
- The tester panel is one rounded floating card: input row, hairline divider,
  result row(s). Results appear only once the input is non-empty.
- Match state: green rounded highlight behind the matched substring inside the
  input, trailing check mark in the input row, muted "Match" label above the
  matched value(s).

## Detection rules (`packages/ui/src/lib/regex-detect.ts`)

Pure, per-line scanner for slash-delimited JS regex literals. A candidate at
`/…/flags` is accepted only if all of:

- The char before the opening `/` is none of: word char, `.`, `)`, `]`, `/`,
  `:` (kills `and/or`, `foo()/2`, URLs, `//` path segments).
- Body is non-empty, contains no newline, and is closed by an unescaped `/`
  outside a character class (escape- and `[…]`-aware scan).
- Body has no leading or trailing whitespace (kills infix division).
- Flags are unique chars from `[dgimsuvy]`, not followed by a word char
  (kills `/path/to`).
- Body contains at least one _strong_ metachar (`\ ^ $ | ? * + ( ) [ { }`) —
  a lone `.` is not evidence (kills `/example.com/`, `/4.5/`).
- `new RegExp(pattern, flags)` compiles (invalid regexes get no affordance).

Detection never _executes_ untrusted patterns; execution happens only in the
tester, on viewer-typed input, capped in length.

## Integration — two mechanisms, one interaction layer

Rendering is Streamdown (`MessageResponse`); the LaTeX rewrite in
`streamdown-plugins.tsx` is the architectural precedent.

1. **Prose + inline code** — a remark tree-rewrite plugin appended via
   Streamdown's `remarkPlugins`. Each phrasing container (paragraph, heading,
   table cell) is rescanned at the _source_ level via position offsets — not
   per text node — because CommonMark both resolves escapes (`\.` → `.`) and
   shreds literals whose `*`/`_` trip emphasis parsing (remend may even append
   a synthetic closing delimiter mid-stream). Candidates overlapping protected
   inline nodes (links, math, inline code, …) are discarded; the child run a
   candidate overlaps is flattened back to text + a synthesized `regex-token`
   element (`data.hName`), sliced at inner text bounds so emphasis delimiters
   never resurface. Tokens are whitelisted through sanitize via Streamdown's
   `allowedTags` and rendered by a `components["regex-token"]` mapping as an
   inline button with the dotted underline. `inlineCode` values (raw by
   definition) are scanned directly and wrapped inside the rendered `<code>`.
   Containers with positionless (synthesized) children fall back to per-node
   value scanning.
2. **Fenced code blocks** — the `@streamdown/code` Shiki plugin is wrapped:
   its `TokensResult` is post-processed per line, tokens are split at
   candidate boundaries, and covered tokens get `htmlAttrs`
   (`data-regex-token`) + dotted-underline `htmlStyle`. Streamdown's token
   renderer spreads both onto the emitted spans, so underlines wrap and theme
   natively — no measured overlay, no DOM mutation.

Both surfaces funnel into one controller: `RegexTesterProvider` (wrapping
Streamdown inside `MessageResponse`) delegates clicks on
`[data-regex-token]`, and renders a single controlled Base UI popover anchored
to the clicked element, staged `menu → tester` (the video shows one surface
morphing). Esc / outside click dismisses; the input autofocuses.

## Alternatives rejected

- **DOM-measured overlay for code blocks** — Range/getClientRects overlay
  rectangles; safe but heavy (Resize/MutationObservers, multi-rect wrapped
  lines). Unnecessary once `htmlAttrs` pass-through was confirmed.
- **Post-render DOM mutation** — wrapping matches in the rendered Shiki DOM
  breaks React reconciliation during streaming re-renders.
- **`plugins.renderers` custom renderer** — takes over whole code blocks and
  loses Shiki + code-block chrome.
- **Per-token React dropdown instances** — one delegated controller is
  cheaper than a menu per token and is required for Shiki spans anyway.

## Testing

- Detector: co-located Vitest unit suite in `packages/ui` (new minimal vitest
  setup; the package previously had lint/typecheck only).
- Behavior: play-function stories (underline present in prose/inline
  code/code block; division, paths, URLs, currency not underlined; menu →
  tester flow; no-match row; match highlight + values; Esc dismiss), run via
  Storybook browser tests.

## Known deviations

- The match highlight uses a local light/dark green not in the OKLCH token
  set — DESIGN.md's palette has no success hue, and the reference behavior is
  explicitly green. Flagged for a future `--success` token if the hue recurs.
- Code-block regex spans are click-only (delegated); keyboard access to the
  tester exists via prose/inline-code tokens, which render as real buttons.
  Shiki token spans cannot become buttons without forking the renderer.
