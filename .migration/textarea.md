# textarea

2026-07-21 · golden pair via CLI (base-nova stock) · pure-class (plain `<textarea>`, no Base UI primitive); typecheck + 5 story tests green.

## Changed

- `packages/ui/src/components/textarea.tsx` — nova class refresh only (Base UI
  has no textarea primitive; stays a plain `<textarea>`): `rounded-md`→
  `rounded-lg`, `px-3`→`px-2.5`, dropped `shadow-xs`, `transition-[color,box-shadow]`
  →`transition-colors`, `ring-[3px]`→`ring-3`, added `disabled:bg-input/50` +
  `dark:disabled:bg-input/80` + `dark:aria-invalid:border-destructive/50`. Docs
  link → base.
- `packages/ui/src/components/textarea.stories.tsx` — docs anchors → base;
  bodies unchanged (native props, drop-in).

## Left alone

- No consumer changes: `prompt-input.tsx` composes `<Textarea>` via native
  props (no `asChild`), unaffected.

## Behavior changes

None functional — nova sizing only (rounded-lg, tighter padding, no shadow).

## Verify by hand

- Focus ring, invalid ring, disabled dimming, and `field-sizing-content`
  auto-grow render correctly.
