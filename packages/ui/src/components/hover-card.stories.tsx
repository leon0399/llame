import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { Button } from "./button.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.js";

const meta = {
  component: HoverCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof HoverCard>;

export default meta;

type Story = StoryObj<typeof meta>;

async function findVisibleHoverCard() {
  let hoverCard: HTMLElement | null = null;

  await waitFor(() => {
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
  });

  if (!hoverCard) {
    throw new Error("Expected an open hover card");
  }

  return hoverCard;
}

async function waitForHoverCardToClose() {
  await waitFor(() =>
    expect(
      document.querySelector("[data-slot='hover-card-content']"),
    ).not.toBeInTheDocument(),
  );
}

export const Default: Story = {
  render: () => (
    <HoverCard openDelay={10} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button variant="link">Hover Here</Button>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-0.5">
        <div className="font-semibold">@nextjs</div>
        <div>The React Framework – created and maintained by @vercel.</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Joined December 2021
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Hover Here" });

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

export const Sides: Story = {
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
