# hover-card

2026-07-21 · golden pair via URL (base-nova) · Migrated to `@base-ui/react/preview-card`; the biggest change is that open/close **delay config moved from the Root to the Trigger** (Base UI's model), so the one consumer + one story were updated.

## Changed

- **`packages/ui/src/components/hover-card.tsx`** — rewritten onto `@base-ui/react/preview-card` (Base UI's `PreviewCard`, aliased `HoverCardPrimitive`):
  - `HoverCardContent` → `Portal > Positioner > Popup`; `side`/`sideOffset`/`align`/`alignOffset` are Positioner props (base-nova defaults). Styling adopts base-nova (`rounded-lg bg-popover p-2.5 ring-1 ring-foreground/10`, `data-open`/`data-closed`, `--transform-origin`), replacing the Radix `rounded-md border p-4` + `data-[state=…]` + `--radix-*` origin.
  - `HoverCardTrigger`: `asChild`→`render` compat shim (the consumer + both stories use `asChild`).
  - **Delay API relocation:** Radix put `openDelay`/`closeDelay` on the Root; Base UI's `PreviewCardRoot` has **no delay prop** — `delay`/`closeDelay` live on `PreviewCardTrigger` (verified in `preview-card/trigger/PreviewCardTrigger.d.mts`). Dropped the Root-level `openDelay` alias; the trigger passes `delay`/`closeDelay` through natively via `{...props}`. Documented on the trigger JSDoc.
  - Leftover scan clean (`radix-ui\|@radix-ui\|data-\[state\|--radix` → none).
- **`packages/ui/src/components/hover-card.stories.tsx`** — docs URLs `radix`→`base`. The `findVisibleHoverCard` helper asserted `data-state="open"` + `toHaveClass("data-[state=open]:animate-in")` → `data-open` + `data-open:animate-in`. `Sides` moved `openDelay={100} closeDelay={100}` from `<HoverCard>` to `<HoverCardTrigger delay={100} closeDelay={100}>`. Stories pass **2/2**.
- **`apps/web/app/(chat)/components/message-usage.tsx`** (consumer) — moved `openDelay={0} closeDelay={0}` from `<HoverCard>` to `<HoverCardTrigger delay={0} closeDelay={0}>` (immediate data-disclosure reveal preserved). Consumer test `message-usage.test.tsx` passes **29/29**.

Typecheck green: `@workspace/ui` and `web` both exit 0.

## Left alone

- **Visual baselines** (`__screenshots__/hover-card.stories.tsx.visual/*`) left as the stale radix-era "before"; base-nova restyle (ring vs border, radius, padding). Re-baseline is Leo's panel step.

## Behavior changes

- Open/close delays are now per-**trigger** rather than per-root. Functionally identical for our single-trigger usage; the API surface moved from `<HoverCard openDelay>` to `<HoverCardTrigger delay>`.
- Content surface restyle (ring instead of border, tighter padding) — intentional base-nova adoption.

## Verify by hand

- Hover the message-usage badge: the card reveals **immediately** (delay 0) and dismisses on unhover.
- Hover a `Sides` trigger: the card opens after ~100ms on the chosen side and flips near a viewport edge.
- **Visual: re-baseline the hover-card stories in the visual-tests panel** — restyled radix→base-nova.
