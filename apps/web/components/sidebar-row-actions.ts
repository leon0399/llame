import { cva } from "class-variance-authority";

import { cn } from "@workspace/ui/lib/utils";

// The layout contract between a sidebar row and the actions pinned to it, in
// one place: how much room the row holds back, where each action sits, and how
// both move when hover reveals them. A row asks for the whole bundle or none
// of it — the parts are not separately importable, because a row that applied
// the padding but not the pin's slot shift (or the reverse) would silently run
// its title under a button, which is exactly how the mobile overlap regression
// happened.
//
// Every value below is a complete literal. Tailwind's extractor is lexical
// over file text, so a class survives being defined here and used elsewhere,
// but NOT being assembled from parts (`pr-${n}`) — hence whole strings per
// variant rather than a computed suffix.

/**
 * Right padding the row holds for the actions showing WITHOUT hover. Measured
 * from the row's right edge, two `w-5` actions occupy 4–48px and one occupies
 * 4–24px; `pr-13` and `pr-7` clear those with 4px to spare, and `pr-2` is the
 * row's own resting padding.
 */
const restPadding = cva("", {
  variants: {
    restActions: {
      0: "group-has-data-[sidebar=menu-action]/menu-item:pr-2",
      1: "group-has-data-[sidebar=menu-action]/menu-item:pr-7",
      2: "group-has-data-[sidebar=menu-action]/menu-item:pr-13",
    },
  },
  defaultVariants: { restActions: 0 },
});

/**
 * What the row opens up to once both actions show. `!` because the resting
 * rule shares this one's specificity, so source order would otherwise decide.
 *
 * Below `md` this is unconditional: `SidebarMenuAction`'s `showOnHover` hides
 * only through `md:opacity-0`, so both actions are permanently visible there
 * (the chat list renders inside the mobile sheet) and the row must always hold
 * their full width.
 */
const hoverPadding =
  "group-hover/menu-item:pr-13! group-focus-within/menu-item:pr-13! group-has-[[aria-expanded=true]]/menu-item:pr-13! max-md:pr-13!";

/**
 * One motion for everything the hover reveals: the actions fade and slide over
 * the same 150ms the row's padding takes to open, so the text's edge, the pin
 * and the kebab all move together instead of at three different speeds. (The
 * primitive only transitions `transform`, which pops the opacity.)
 */
const actionMotion = "transition-[transform,opacity] duration-150 ease-out";

const action = cva(actionMotion, {
  variants: {
    /** The row's own height: a two-line row re-centers its actions. */
    twoLine: {
      // `top-1/2!` outweighs the primitive's per-size compound selectors
      // (`peer-data-[size=…]:top-*`).
      true: "top-1/2! -translate-y-1/2",
      false: "",
    },
    slot: {
      pin: "right-7",
      menu: "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
    },
    /**
     * A pinned row shows its pin at rest while the kebab stays hidden — sit at
     * the row's edge instead of holding the kebab's slot empty, and give the
     * slot back when hover reveals it. `md:`-only: below that the kebab is
     * always visible, so the slot is never free.
     */
    takesKebabSlot: {
      true: "md:translate-x-6 md:group-hover/menu-item:translate-x-0 md:group-focus-within/menu-item:translate-x-0 md:group-has-[[aria-expanded=true]]/menu-item:translate-x-0",
      false: "",
    },
  },
  defaultVariants: { twoLine: false, slot: "pin", takesKebabSlot: false },
});

/**
 * sidebarRowActions resolves the classes a sidebar row and its two actions need
 * for the row to hold space only while the actions are actually showing. Spread
 * the returned `row`/`pin`/`menu` onto the `SidebarMenuButton` and the two
 * `SidebarMenuAction`s; the call site supplies handlers and icons, never
 * layout classes.
 *
 * Not prefixed `use` on purpose: it reads no state and calls no hook, so the
 * prefix would claim semantics it does not have.
 *
 * @summary the row + action classes for a sidebar row's hover actions
 */
export function sidebarRowActions({
  isPinned,
  isActive,
  twoLine = false,
}: {
  /** Pinned rows keep their pin visible without hover. */
  isPinned: boolean;
  /** The open row keeps its kebab visible without hover. */
  isActive: boolean;
  /** True for rows that are two lines tall (a title over an excerpt). */
  twoLine?: boolean;
}): { row: string; pin: string; menu: string } {
  // Only what stays visible without hover holds space back.
  const restActions = ((isPinned ? 1 : 0) + (isActive ? 1 : 0)) as 0 | 1 | 2;

  return {
    row: cn(restPadding({ restActions }), hoverPadding),
    pin: action({
      twoLine,
      slot: "pin",
      // The kebab's slot is only free while the kebab itself is hidden.
      takesKebabSlot: isPinned && !isActive,
    }),
    menu: action({ twoLine, slot: "menu" }),
  };
}
