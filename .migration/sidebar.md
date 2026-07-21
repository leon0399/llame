# sidebar

2026-07-21 · golden pair via URL (base-nova reference) + engine · The **last** Radix wrapper. Five `Slot`-based `asChild` sites → Base UI `useRender` + `mergeProps`, keeping the `asChild`→`render` compat shim so consumers are unchanged. Also fixes a dropdown-migration edge that surfaced here.

## Changed

- **`packages/ui/src/components/sidebar.tsx`** — the only Radix usage was `Slot.Root` (the `Comp = asChild ? Slot.Root : "tag"` idiom) in 5 components: `SidebarGroupLabel` (div), `SidebarGroupAction` (button), `SidebarMenuButton` (button), `SidebarMenuAction` (button), `SidebarMenuSubButton` (a). Each rewritten with `useRender({ defaultTagName, render, props: mergeProps<T>(…), state })`:
  - `asChild`→`render` compat shim (`asChild && isValidElement(children) ? children : render`) — consumers keep `<SidebarMenuButton asChild><Link/></SidebarMenuButton>` unchanged.
  - `data-slot`/`data-sidebar`/`data-size`/`data-active` emitted via `useRender`'s `state` (each key → a `data-*` attribute), matching base-nova.
  - **Boolean `data-active`:** state emits `data-active=""` (present) when active, not Radix's `data-active="true"`. So the cva/consumer selectors changed `data-[active=true]:`→`data-active:` and `peer-data-[active=true]/menu-button`→`peer-data-active/menu-button` (custom variant matches `[data-active]:not([="false"])`). `data-size` stays a string value (`data-[size=default]:` unchanged).
  - `SidebarMenuButton` tooltip integration follows base-nova: `render: !tooltip ? render : <TooltipTrigger render={render} />`, then wrapped in `<Tooltip>…<TooltipContent/></Tooltip>`.
  - Preserved the earlier compat sweep's `aria-expanded:` hooks (menu-trigger open state) and all JSDoc. Dropped the `radix-ui` import. Docs URL `radix/sidebar`→`base/sidebar`. Leftover scan clean.
- **`packages/ui/src/components/dropdown-menu.tsx`** — **dropdown-migration fallout fixed here:** `DropdownMenuLabel` was `Menu.GroupLabel`, which **throws when not inside a `Menu.Group`**. `app-sidebar-user` uses the label standalone as a menu header (avatar + name + email), which crashed `AppSidebar` (caught by `index.test.tsx`). Reverted `DropdownMenuLabel` to a plain styled `<div>` (matching Radix's flexible `DropdownMenu.Label`), so it works both inside a group and as a bare header. No consumer edits.
- **`app-sidebar-admin-entry.test.tsx` / `admin-section-nav.test.tsx`** — `expect(link.getAttribute("data-active")).toBe("true")` → `.not.toBeNull()` (Base UI's boolean state emits `data-active=""`; these files use raw `getAttribute`, no jest-dom `toHaveAttribute`).

Typecheck green (`@workspace/ui` + `web` exit 0). Verified: `sidebar.stories` **12/12**, `dropdown-menu`/`avatar` stories, and the **entire `apps/web` unit suite — 326/326** — pass.

## Left alone

- Non-Slot sidebar parts (`SidebarProvider`, `Sidebar`, `SidebarMenuBadge`, etc.) are plain elements — untouched. The `Sidebar` component's own `data-state={state}` (its expanded/collapsed state, set by this component, not a Radix primitive) stays.
- **Visual baselines** — sidebar class output is largely unchanged (attribute mechanism moved to `state`, values equivalent). Re-baseline only if the panel reports a diff.

## Behavior changes

- `data-active` is now a presence attribute (`data-active=""`) rather than `data-active="true"` — selectors + tests updated accordingly. No visible behavior change.
- `DropdownMenuLabel` no longer wires Base UI group `aria-labelledby` (it's a plain div again) — same as the original Radix behavior; grouped labels still render visually.

## Finalization remaining (project-level, deferred for Leo)

**All UI wrappers are now off Radix — sidebar was the last.** No `radix-ui`/`@radix-ui` imports remain in `packages/ui` or `apps/web` source (only two stale test _comments_ reference it). The remaining whole-project finalization is a distinct, heavier change worth Leo's review — do NOT bury it in a component commit:

1. Flip `packages/ui/components.json` style `radix-nova` → `base-nova` (so future `shadcn add` delivers base variants).
2. Remove the `radix-ui` dependency from `package.json` + `pnpm install` (lockfile).
3. Full `pnpm build` + `pnpm test:e2e` against the baseline.
4. Update the two stale ResizeObserver test comments (they say "Radix's Tooltip"; it's Base UI now — the mock is still needed).
5. Write `.migration/project.md` (dependency swap + final build result) and update ROADMAP/CHANGELOG.

## Verify by hand

- Collapse the sidebar to icon mode: hovering a `SidebarMenuButton` with a `tooltip` shows the label tooltip on the right.
- A `SidebarMenuButton asChild` wrapping a `<Link>` (e.g. the admin entry) highlights (`data-active`) when its route is active.
- The user menu opens with the identity header (standalone `DropdownMenuLabel`) rendering, then the action groups below.
