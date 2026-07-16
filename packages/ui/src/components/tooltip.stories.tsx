import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { InfoIcon, SaveIcon } from "lucide-react";
import { expect, waitFor } from "storybook/test";

import { Button } from "./button.js";
import { Kbd } from "./kbd.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

const meta = {
  component: Tooltip,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

async function findVisibleTooltip() {
  let tooltip: HTMLElement | null = null;

  await waitFor(() => {
    tooltip = document.querySelector<HTMLElement>(
      "[data-slot='tooltip-content']",
    );
    expect(tooltip).toBeVisible();
  });

  if (!tooltip) {
    throw new Error("Expected an open tooltip");
  }

  return tooltip;
}

async function waitForTooltipToClose() {
  await waitFor(() =>
    expect(
      document.querySelector("[data-slot='tooltip-content']"),
    ).not.toBeInTheDocument(),
  );
}

export const Basic: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" className="w-fit">
          Show Tooltip
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Add to library</p>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Show Tooltip" });

    await userEvent.hover(trigger);
    await findVisibleTooltip();

    await userEvent.unhover(trigger);
    await waitForTooltipToClose();
  },
};

export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className="w-fit capitalize style-sera:uppercase"
            >
              {side}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>
            <p>Add to library</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      await userEvent.hover(canvas.getByRole("button", { name: side }));
      await findVisibleTooltip();
      await userEvent.unhover(canvas.getByRole("button", { name: side }));
      await waitForTooltipToClose();
    }
  },
};

export const WithIcon: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon">
          <InfoIcon />
          <span className="sr-only">Info</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Additional information</p>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "Info" }));
    await findVisibleTooltip();
  },
};

export const LongContent: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" className="w-fit">
          Show Tooltip
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        To learn more about how this works, check out the docs. If you have any
        questions, please reach out to us.
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "Show Tooltip" }));
    await findVisibleTooltip();
  },
};

export const Disabled: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block w-fit">
          <Button variant="outline" disabled>
            Disabled
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>This feature is currently unavailable</p>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Disabled" });
    await expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement as HTMLElement);
    await findVisibleTooltip();
  },
};

export const WithKeyboardShortcut: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Save changes">
          <SaveIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Save Changes <Kbd>S</Kbd>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "Save changes" }));
    await findVisibleTooltip();
  },
};

export const OnLink: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href="#"
          className="w-fit text-sm text-primary underline-offset-4 hover:underline"
          onClick={(event) => event.preventDefault()}
        >
          Learn more
        </a>
      </TooltipTrigger>
      <TooltipContent>
        <p>Click to read the documentation</p>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("link", { name: "Learn more" }));
    await findVisibleTooltip();
  },
};

export const FormattedContent: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" className="w-fit">
          Status
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Active</p>
          <p className="text-xs opacity-80">Last updated 2 hours ago</p>
        </div>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "Status" }));
    const tooltip = await findVisibleTooltip();
    await expect(tooltip).toHaveTextContent("Last updated 2 hours ago");
  },
};
