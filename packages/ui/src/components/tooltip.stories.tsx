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

// This file is mixed provenance: `shadcn-example` (the meta default below)
// for stories transcribed from the shadcn Tooltip docs
// (https://ui.shadcn.com/docs/components/base/tooltip); each such story
// overrides nothing and links its docs anchor. `ai-generated` stories (each
// overrides the tag itself) cover our own compositions upstream doesn't
// document — keyboard/icon/link/structured-content variants and long
// content. Upstream example we intentionally skip: RTL (excluded by
// convention). Note: upstream has since split its docs into several parallel
// "style" registries (`radix-nova`, `base-nova`, etc.); our `new-york-v4`
// target only still hosts the top ("Default") example as a standalone
// registry file, so the Side/Keyboard/Disabled examples below were pulled
// from the equivalent `radix-nova`-styled example files instead — their
// rendered markup is unchanged from what those examples looked like under
// `new-york-v4` previously.
// Annotated (not `satisfies`) because Base UI's Tooltip props reference
// package-internal types it doesn't export (TooltipHandle,
// PayloadChildRenderFunction), which makes the inferred `satisfies` type
// unnameable (tsgo TS2883).
const meta: Meta<typeof Tooltip> = {
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
};

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

/**
 * Use for a short text hint on hover/focus; the play function verifies the
 * open/close cycle.
 *
 * Verbatim from [shadcn Tooltip](https://ui.shadcn.com/docs/components/base/tooltip)
 * (the default example at the top of the page).
 *
 * @summary for the standard text tooltip
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // The play hovers then unhovers, so the tooltip is closed by the time the
  // visual snapshot is captured — the screenshot would only show the trigger.
  // Skip screenshot capture; the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover</Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Add to library</p>
      </TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Hover" });

    await userEvent.hover(trigger);
    await findVisibleTooltip();

    await userEvent.unhover(trigger);
    await waitForTooltipToClose();
  },
};

/**
 * Use `side` to keep the tooltip inside the viewport when the trigger sits
 * near an edge; the play function verifies each placement.
 *
 * Verbatim from [shadcn Tooltip › Side](https://ui.shadcn.com/docs/components/base/tooltip#side).
 *
 * @summary for choosing a placement side
 */
export const Sides: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Same as Basic — the play closes each tooltip before the snapshot, so skip
  // screenshot capture; the interaction test still verifies each placement.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["left", "top", "bottom", "right"] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger asChild>
            <Button variant="outline" className="w-fit capitalize">
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
    for (const side of ["left", "top", "bottom", "right"] as const) {
      await userEvent.hover(canvas.getByRole("button", { name: side }));
      await findVisibleTooltip();
      await userEvent.unhover(canvas.getByRole("button", { name: side }));
      await waitForTooltipToClose();
    }
  },
};

/**
 * Use icon-only buttons so the tooltip supplies the visible label the
 * button lacks (paired with an sr-only text fallback).
 *
 * @summary for labelling icon-only buttons
 */
export const WithIcon: Story = {
  tags: ["ai-generated"],
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

/**
 * Use sentence-length content only when a short label cannot carry the
 * hint; the tooltip wraps at its max width.
 *
 * @summary for longer sentence-length hints
 */
export const LongContent: Story = {
  tags: ["ai-generated"],
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

/**
 * Wrap a disabled trigger in a span so the tooltip can still explain why
 * the control is unavailable — disabled elements emit no pointer events.
 *
 * Verbatim from [shadcn Tooltip › Disabled Button](https://ui.shadcn.com/docs/components/base/tooltip#disabled-button).
 *
 * @summary for tooltips on disabled controls
 */
export const Disabled: Story = {
  tags: ["shadcn-example", "ai-generated"],
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

/**
 * Use Kbd inside the content to advertise the shortcut alongside the action
 * name. Upstream's example omits an accessible name on the icon-only
 * trigger; we add `aria-label` to satisfy the a11y gate.
 *
 * Adapted from [shadcn Tooltip › With Keyboard Shortcut](https://ui.shadcn.com/docs/components/base/tooltip#with-keyboard-shortcut).
 *
 * @summary for action + keyboard shortcut hints
 */
export const WithKeyboardShortcut: Story = {
  tags: ["shadcn-example", "ai-generated"],
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

/**
 * Use on inline links when the destination needs a clarifying hint; the
 * trigger works on any focusable element, not just buttons.
 *
 * @summary for tooltips on text links
 */
export const OnLink: Story = {
  tags: ["ai-generated"],
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

/**
 * Use structured content (title + secondary line) when a single phrase
 * cannot convey the status details.
 *
 * @summary for multi-line structured tooltips
 */
export const FormattedContent: Story = {
  tags: ["ai-generated"],
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
