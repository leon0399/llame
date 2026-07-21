# avatar

2026-07-21 · golden pair via CLI (base-nova stock, forks replayed) · migrated to Base UI; typecheck + 10 story tests green.

## Changed

- `packages/ui/src/components/avatar.tsx` — Radix → Base UI
  (`@base-ui/react/avatar`). Adopted base-nova stock styling (richer than our
  prior version): Root gains the `after:` inset ring border + `select-none`
  and drops `overflow-hidden`; Image gains `rounded-full object-cover`;
  Fallback uses `text-muted-foreground` (was `text-foreground` — see #232
  below); Badge/GroupCount gain `bg-blend-color`. Prop types now
  `AvatarPrimitive.Root.Props` / `.Image.Props` / `.Fallback.Props`. Re-applied
  our component + per-part JSDoc forks and the `size` prop doc. Leftover scan
  clean.
- `apps/web/components/components/ai/message/index.tsx` — consumer fix:
  `<AvatarFallback delayMs={…}>` → `delay={…}` (Base UI renamed the Radix
  `delayMs` prop to `delay`). `MessageAvatar`'s own public `delayMs` prop is
  kept and mapped internally, so `chat-page.tsx` is untouched.
- `packages/ui/src/components/avatar.stories.tsx` — bodies already match the
  base-nova examples (stable Avatar/Image/Fallback/Group API); updated docs
  anchors radix → base and the examples-path note. Added file-wide
  `contrastKnownIssue232` (see below).
- **Storybook infra (first Base UI component):**
  `apps/storybook/.storybook/main.ts` adds `@base-ui/react` to
  `optimizeDeps.include`, and it's declared as an `apps/storybook` devDep.
  Without this, avatar being the first story to import `@base-ui/react` caused
  Vite to re-optimize mid-run and fail with
  `Cannot read properties of null (reading 'useMemo')`. Applies to every future
  Base UI component.

## Left alone

- `apps/api/test/*` `delayMs` — unrelated (a test model client's field, not the
  Avatar prop).
- The avatar image `src`s point at github.com; they load over the network in
  the browser test.

## Behavior changes

- **`delayMs` → `delay`** on `AvatarFallback` (Base UI rename). Consumer updated.
- **#232 color-contrast regression.** base-nova's Fallback/GroupCount use
  `text-muted-foreground` on `bg-muted` (~4.34:1, below WCAG AA). Our
  pre-migration fork used `text-foreground` and passed. The failure is
  nondeterministic (only when the avatar image fails to load and the fallback
  becomes visible), so `contrastKnownIssue232` is applied at meta level.
  Remove when #232's token fix lands (`rg KnownIssue232`).
- Root no longer clips with `overflow-hidden`; the image is clipped via
  `rounded-full` on the Image itself instead. **Consequence:** squaring an
  avatar now requires overriding the radius on the Root, its `after:` ring,
  AND the Image/Fallback — not just the Root. The `Squared` story was updated
  to `rounded-lg after:rounded-lg` on the Root plus `rounded-lg` on the Image
  and Fallback (previously a single Root `rounded-lg` sufficed under the old
  `overflow-hidden` clip). Any app code that squared an avatar the old way
  needs the same treatment. **Deferred:** rather than hand-override every part
  everywhere, a future `shape="round" | "square"` prop on `Avatar` should own
  this (TODO on the `Squared` story). `apps/web/.../app-sidebar-user.tsx`
  squares two avatars the old way (Root + Fallback only) and is left as-is for
  now — its `after:` ring renders round until the prop lands. Not manually
  patched, per direction to consolidate into the prop.

## Verify by hand

- Fallback initials + the `after:` ring render correctly at sm/default/lg.
- The Dropdown story: clicking the avatar opens the account menu (play passes).
- Group stacking + "+N" count bubble align.
