import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";
import { Button } from "./button.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.js";

// This file is mixed provenance: `shadcn-example` (the meta default below)
// for `Basic`, adapted from the shadcn Hover Card docs default example
// (https://ui.shadcn.com/docs/components/radix/hover-card#basic) — the only
// addition is an `alt` on the avatar image, which upstream's example omits,
// to satisfy our a11y gate. `Sides` (overrides the tag itself) covers the
// docs' "Sides" placement section as `ai-generated`: upstream's
// `hover-card-sides` example no longer exists as a `new-york-v4` registry
// file (only under the incompatible `radix-nova` style), so we keep our own
// coverage instead of transcribing the incompatible version. Upstream
// example we intentionally skip: RTL (excluded by convention).
const meta = {
  component: HoverCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "shadcn-example"],
} satisfies Meta<typeof HoverCard>;

export default meta;

type Story = StoryObj<typeof meta>;

async function findVisibleHoverCard() {
  let hoverCard: HTMLElement | null = null;

  await waitFor(
    () => {
      hoverCard = document.querySelector<HTMLElement>(
        "[data-slot='hover-card-content']",
      );
      expect(hoverCard).toHaveAttribute("data-state", "open");
      expect(hoverCard).toHaveClass("data-[state=open]:animate-in");
      expect(hoverCard).toBeVisible();
      if (!hoverCard) {
        throw new Error("Expected an open hover card");
      }
      const styles = window.getComputedStyle(hoverCard);
      expect(styles.animationName).not.toBe("none");
      expect(parseFloat(styles.animationDuration)).toBeGreaterThan(0);
    },
    // Radix's default openDelay (700ms) leaves little headroom under the
    // testing-library default (1000ms) once browser rendering is factored
    // in; this story intentionally doesn't override openDelay to stay
    // verbatim, so extend the wait instead.
    { timeout: 2000 },
  );

  if (!hoverCard) {
    throw new Error("Expected an open hover card");
  }

  return hoverCard;
}

async function waitForHoverCardToClose() {
  await waitFor(
    () =>
      expect(
        document.querySelector("[data-slot='hover-card-content']"),
      ).not.toBeInTheDocument(),
    { timeout: 2000 },
  );
}

/**
 * Use for pointer-hover previews of a linked entity (profile, reference) so
 * users can preview it without navigating away; the play function verifies
 * the open/close cycle and entry animation.
 *
 * Adapted from [shadcn Hover Card › Basic](https://ui.shadcn.com/docs/components/radix/hover-card#basic)
 * (adds `alt` on the avatar image, which upstream's example omits, to
 * satisfy our a11y gate).
 *
 * @summary for hover-triggered entity previews
 */
export const Basic: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link">@nextjs</Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex justify-between gap-4">
          <Avatar>
            <AvatarImage src="https://github.com/vercel.png" alt="@nextjs" />
            <AvatarFallback>VC</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">@nextjs</h4>
            <p className="text-sm">
              The React Framework – created and maintained by @vercel.
            </p>
            <div className="text-xs text-muted-foreground">
              Joined December 2021
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "@nextjs" });

    await userEvent.hover(trigger);
    const hoverCard = await findVisibleHoverCard();
    await expect(hoverCard).toHaveTextContent(
      "The React Framework – created and maintained by @vercel.",
    );

    await userEvent.unhover(trigger);
    await waitForHoverCardToClose();
  },
};

const HOVER_CARD_SIDES = ["left", "top", "bottom", "right"] as const;

/**
 * Use `side` to keep the preview inside the viewport when the trigger sits
 * near an edge; the play function verifies each placement. Upstream's
 * `hover-card-sides` example no longer has a `new-york-v4` source file, so
 * this covers the docs' "Sides" section as our own composition.
 *
 * @summary for choosing a placement side
 */
export const Sides: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  render: () => (
    <div className="flex flex-wrap justify-center gap-2">
      {HOVER_CARD_SIDES.map((side) => (
        <HoverCard key={side} openDelay={100} closeDelay={100}>
          <HoverCardTrigger asChild>
            <Button variant="outline" className="capitalize">
              {side}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent side={side}>
            <div className="flex flex-col gap-1">
              <h4 className="font-medium">Hover Card</h4>
              <p>This hover card appears on the {side} side of the trigger.</p>
            </div>
          </HoverCardContent>
        </HoverCard>
      ))}
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    for (const side of HOVER_CARD_SIDES) {
      const trigger = canvas.getByRole("button", { name: side });

      await userEvent.hover(trigger);
      const hoverCard = await findVisibleHoverCard();
      await expect(hoverCard).toHaveTextContent(
        `This hover card appears on the ${side} side of the trigger.`,
      );

      await userEvent.unhover(trigger);
      await waitForHoverCardToClose();
    }
  },
};
