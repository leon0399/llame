import { PlusIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { Button } from "./button.js";

const meta = {
  component: Button,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "ai-generated"],
  argTypes: {
    asChild: {
      control: false,
      description: "Whether to render as a Slot component",
    },
  },
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for the primary action in a view. The play function verifies the
 * button is clickable and emits its `onClick` callback.
 *
 * @summary for the default primary action
 */
export const Basic: Story = {
  args: {
    children: "Button",
  },
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole("button");

    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(args.onClick).toHaveBeenCalledOnce();
  },
};

/**
 * Use when a leading icon reinforces the action's meaning; the button sizes
 * and spaces the icon itself, so no extra classes are needed.
 *
 * @summary for a text button with a leading icon
 */
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <PlusIcon />
        Add Item
      </>
    ),
  },
};

/**
 * Use for icon-only actions in toolbars and tight layouts. An `aria-label`
 * is required because there is no visible text.
 *
 * @summary for icon-only actions (requires aria-label)
 */
export const Icon: Story = {
  args: {
    "aria-label": "Add item",
    children: <PlusIcon />,
    size: "icon",
  },
};

/**
 * Reference for picking a variant: default for primary actions, destructive
 * for irreversible ones, outline/secondary for supporting actions, ghost for
 * low-emphasis inline actions, link for navigation styled as text.
 *
 * @summary reference of all variants and when to pick each
 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button>Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};
