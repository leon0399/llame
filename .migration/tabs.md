# tabs

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + 5 story tests green.

## Changed

- `tabs.tsx` — Radix → `@base-ui/react/tabs`. Part renames: Trigger → `Tab`,
  Content → `Panel` (Root/List unchanged). Classes: `data-[state=active]` →
  `data-active`, `data-[orientation=*]` → `data-horizontal/vertical` variants;
  TabsList height h-9 → h-8; nova has-data-[icon] spacing. Kept the `line`
  variant + tabsListVariants + JSDoc. Dropped the Omit-based TabsProps
  interfaces (Base UI types carry the props; no importer). Link → base.
- `tabs.stories.tsx` — play assertions `data-state="active"|"inactive"` →
  `aria-selected` (role=tab always carries it); disabled tab uses `aria-disabled`
  (Base UI Tab is not a native-disabled button). Docs → base.

## Left alone

No app consumers.

## Behavior changes

- **Manual activation by default.** Base UI 1.6 `List.activateOnFocus` defaults
  to false (Radix defaulted to automatic activation on arrow-key focus). Set
  `<TabsList activateOnFocus>` to restore the Radix feel. Our stories click
  tabs, so tests are unaffected.
- `data-state` → `data-active`; disabled via `aria-disabled`.

## Verify by hand

Click/keyboard tab switching; default vs line variant; vertical orientation;
disabled tab is skipped.
