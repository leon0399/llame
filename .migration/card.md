# card

2026-07-21 · golden pair via CLI (base-nova stock) · pure-class (styled `<div>`s), no primitive; typecheck + story tests green.

## Changed

- `card.tsx` — nova restyle across all 7 parts:
  - Card: `ring-1 ring-foreground/10` replaces `border shadow-sm`; spacing via
    `--spacing()` (`[--card-spacing:--spacing(4)]`, sm `--spacing(3)`);
    `has-data-[slot=card-footer]:pb-0` (footer flush to edge).
  - CardHeader: `group/card-header`, `gap-1` (was gap-2), `rounded-t-xl`,
    description-driven `grid-rows`.
  - CardTitle: `text-base leading-snug font-medium` + `group-data-[size=sm]/card:text-sm`.
    **Dropped upstream's `cn-font-heading`** — undefined in our single-sans setup
    (a dangling no-op); noted inline.
  - CardFooter: now `rounded-b-xl border-t bg-muted/50 p-(--card-spacing)`
    (was `px-(--card-spacing) [.border-t]:pt-`). Footers get a muted bar.
    Kept our component + size + per-part JSDoc forks; docs link → base.
- `card.stories.tsx` — docs anchors → base.

## Left alone

No `asChild` on Card; no consumer changes. (The `asChild` grep hits are
`HoverCardTrigger`, a different component.)

## Behavior changes

Visual: ring instead of border+shadow; footer now a muted, bordered, rounded
bar. `cn-font-heading` intentionally omitted (see above) — CardTitle uses the
default sans.

## Verify by hand

Card ring + rounded corners; header/action grid; footer muted bar; sm size
tightens spacing; first-child image renders flush.
