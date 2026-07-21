# alert-dialog

2026-07-21 · golden pair via URL (base-nova) · Migrated to the dedicated `@base-ui/react/alert-dialog` primitive. **Behavior change:** `AlertDialogAction` is now a plain `Button` and no longer auto-closes — verified both consumers are controlled and unaffected.

## Changed

- **`packages/ui/src/components/alert-dialog.tsx`** — rewritten onto `@base-ui/react/alert-dialog`:
  - `AlertDialogOverlay` → `AlertDialogPrimitive.Backdrop`; `AlertDialogContent` → `Portal > Overlay > AlertDialogPrimitive.Popup` (Base UI's Popup carries `role="alertdialog"` — verified via the story's `findByRole("alertdialog")`).
  - `AlertDialogTrigger`: `asChild`→`render` compat shim.
  - **`AlertDialogAction` is now a plain `Button`** (base-nova design; Base UI's alert-dialog namespace has no `Action` part). Radix's `AlertDialog.Action` auto-closed on click; the plain Button does not. Documented in its JSDoc; callers drive closing via controlled `open`/`onOpenChange`.
  - `AlertDialogCancel` → `AlertDialogPrimitive.Close` rendered as `Button` (keeps `variant`/`size`); still dismisses + returns focus.
  - Adopted base-nova styling (muted footer bar `-mx-4 -mb-4 border-t bg-muted/50`, `bg-popover`, `ring-1 ring-foreground/10`, media `size-10`, header `gap-x-4`, `max-w-xs`/`sm:max-w-sm`). Kept our API surface: `size` prop, `AlertDialogMedia`, and all component/prop JSDoc.
  - `AlertDialogTitle` drops the undefined `cn-font-heading` → `text-base font-medium`.
  - Leftover scan clean (`radix-ui\|@radix-ui\|IconPlaceholder\|cn-font-heading\|data-\[state` → none).
- **`packages/ui/src/components/alert-dialog.stories.tsx`** — docs URLs `radix`→`base`. `Small`/`Media` play tests previously asserted the Action click closed the dialog (Radix behavior); rewritten to assert base-nova's actual behavior — clicking Action leaves the dialog **open**, then `Cancel` (a Close) dismisses it. Stories pass **6/6**.
- **`apps/web/app/(admin)/admin/organizations/components/org-unit-dialogs.tsx`** (consumer) — `DeleteOrgUnitDialog` previously used `e.preventDefault()` on the Action's onClick to suppress Radix's auto-close (so it could stay open on failure). base-nova's Action doesn't auto-close, so that `preventDefault` was vestigial and its comment stale — removed both; the controlled `onOpenChange(false)`-on-success path is unchanged.

Typecheck green: `@workspace/ui` and `web` both exit 0.

## Left alone

- **`members-panel.tsx`** (in `admin/components/parked/`) consumes `AlertDialogAction` but is controlled (`open={confirmOwnerGrant}`) and closes itself in `onClick` (`setConfirmOwnerGrant(false)`) — no reliance on auto-close, so no edit needed. Compiles + behaves unchanged.
- **Visual baselines** (`__screenshots__/alert-dialog.stories.tsx.visual/*`) left as the stale radix-era "before"; base-nova restyle (muted footer, ring, sizing, media size). Panel will report `changed` — re-baseline is Leo's interactive step.

## Behavior changes

- **`AlertDialogAction` no longer auto-closes the dialog** (Radix `Action` did; base-nova is a plain `Button`). Both in-repo consumers are controlled and close explicitly, so no functional regression — but any _future_ caller must drive closing itself (documented in the Action JSDoc). This is the one intentional behavior delta of this migration.
- Cancel/Escape/outside-click dismissal + focus return are Base UI defaults.

## Verify by hand

- Trigger each story: dialog opens, `Cancel`/`Don't allow` dismisses and returns focus to the trigger; the affirmative button (`Allow`/`Share`/`Delete`) does **not** dismiss on its own.
- `DeleteOrgUnitDialog` (admin → organizations): confirming a delete closes only on success; on a failing mutation the dialog stays open and shows the error.
- `size="sm"` renders the two-column footer; `AlertDialogMedia` renders the leading icon.
- **Visual: re-baseline the alert-dialog stories in the visual-tests panel** — restyled radix→base-nova.
